"""POST /api/v1/demo/duty-cycle (doc 05 API-18). No database, no session.

The endpoint is a pure computation: it must work without a cookie and with every
database entry point forbidden, and it must never set a cookie.
"""

import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import app.db.session as app_session
from app.core import origin as origin_module
from app.main import app
from app.routes import mining as mining_routes

URL = "/api/v1/demo/duty-cycle"
JSON_HEADERS = {"Content-Type": "application/json"}

SAMPLE = {
    "segments": [
        {"name": "Loading", "power_kw": 120, "duration_min": 3},
        {"name": "Hauling", "power_kw": 300, "duration_min": 12},
        {"name": "Dumping", "power_kw": 90, "duration_min": 2},
        {"name": "Returning", "power_kw": 60, "duration_min": 8},
    ],
    "cycles_per_shift": 18,
}


def _forbid_database(*args, **kwargs):
    raise AssertionError("the duty-cycle analysis must not touch the database")


@pytest.fixture
def origins(monkeypatch):
    def configure(value: str) -> None:
        monkeypatch.setattr(
            origin_module,
            "get_settings",
            lambda: SimpleNamespace(frontend_origins=value),
        )

    configure("")
    return configure


@pytest.fixture
def client(monkeypatch, origins):
    monkeypatch.setattr(app_session, "SessionLocal", _forbid_database)
    monkeypatch.setattr(app_session.engine, "connect", _forbid_database)
    return TestClient(app, base_url="https://testserver")


def post(client, body=None, *, raw=None, headers=None):
    merged = dict(JSON_HEADERS)
    merged.update(headers or {})
    if raw is None:
        raw = json.dumps(body).encode()
    return client.post(URL, content=raw, headers=merged)


def assert_error(response, status, code):
    assert response.status_code == status, response.text
    error = response.json()["error"]
    assert error["code"] == code
    assert error["request_id"] == response.headers["x-request-id"]
    assert "set-cookie" not in response.headers
    return error


def with_cycles(cycles):
    return {**SAMPLE, "cycles_per_shift": cycles}


# ---------- the happy path ----------


def test_hand_calculated_sample_without_a_cookie_or_a_database(client):
    response = post(client, SAMPLE)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"].startswith("req_")
    assert "set-cookie" not in response.headers
    body = response.json()
    assert body["model_version"] == "duty-cycle-v1"
    assert body["cycle"] == {
        "duration_min": 25.0,
        "energy_kwh": 77.0,
        "average_power_kw": 184.8,
        "peak_power_kw": 300.0,
    }
    assert body["shift"] == {"cycles": 18, "duration_min": 450.0, "energy_kwh": 1386.0}
    assert [s["energy_kwh"] for s in body["segments"]] == [6.0, 60.0, 3.0, 8.0]
    assert [s["share_of_cycle_energy_pct"] for s in body["segments"]] == [
        7.79,
        77.92,
        3.9,
        10.39,
    ]
    assert body["dominant_segment_ids"] == ["segment-2"]
    assert body["segments"][1]["name"] == "Hauling"
    assert body["segments"][1]["is_dominant"] is True
    assert body["explanation"].startswith("Hauling uses the most energy")
    assert [a["id"] for a in body["assumptions"]][:2] == ["A1", "A2"]
    assert set(body["segments"][0]) == {
        "id",
        "name",
        "power_kw",
        "duration_min",
        "energy_kwh",
        "share_of_cycle_energy_pct",
        "is_dominant",
    }


def test_the_request_is_parsed_exactly_not_as_a_binary_float(client):
    # 0.10 kW x 6 min and 0.60 kW x 1 min are both exactly 0.01 kWh: a tie that
    # binary floats would break (0.1 * 6 / 60 = 0.010000000000000002).
    raw = (
        b'{"segments": [{"name": "Slow", "power_kw": 0.10, "duration_min": 6},'
        b' {"name": "Fast", "power_kw": 0.60, "duration_min": 1}],'
        b' "cycles_per_shift": 1}'
    )
    response = post(client, raw=raw)
    assert response.status_code == 200
    assert response.json()["dominant_segment_ids"] == ["segment-1", "segment-2"]


def test_the_largest_valid_request_fits_the_body_limit(client):
    body = {
        "segments": [
            {"name": f"{i:02d}" + "n" * 38, "power_kw": 10000.0, "duration_min": 120.0}
            for i in range(12)
        ],
        "cycles_per_shift": 1,
    }
    raw = json.dumps(body).encode()
    assert len(raw) < 4 * 1024
    assert post(client, raw=raw).status_code == 200


def test_the_same_request_gives_byte_identical_output(client):
    first = post(client, SAMPLE)
    second = post(client, SAMPLE)
    assert first.content == second.content


# ---------- validation ----------


def test_shift_over_1440_minutes_is_a_field_error_on_cycles_per_shift(client):
    assert post(client, with_cycles(57)).status_code == 200  # 25 x 57 = 1425
    error = assert_error(post(client, with_cycles(58)), 422, "VALIDATION_ERROR")
    assert error["details"] == [
        {
            "field": "cycles_per_shift",
            "reason": (
                "Cycle duration x cycles per shift must not exceed 1,440 minutes; "
                "at most 57 cycles fit this cycle"
            ),
        }
    ]
    assert (
        post(
            client,
            {
                "segments": [{"name": "Run", "power_kw": 10, "duration_min": 24}],
                "cycles_per_shift": 60,
            },
        ).status_code
        == 200
    )  # exactly 1,440


def test_duplicate_names_are_a_field_error_on_the_second_segment(client):
    body = json.loads(json.dumps(SAMPLE))
    body["segments"][2]["name"] = " hauling "
    error = assert_error(post(client, body), 422, "VALIDATION_ERROR")
    assert [d["field"] for d in error["details"]] == ["segments.2.name"]


def body_of(segment: str, cycles: str = "1") -> bytes:
    """A raw request with one hand-written segment (to send odd JSON numbers)."""
    return f'{{"segments": [{segment}], "cycles_per_shift": {cycles}}}'.encode()


def seg(name='"A"', power="1", duration="1", extra=""):
    return f'{{"name": {name}, "power_kw": {power}, "duration_min": {duration}{extra}}}'


@pytest.mark.parametrize(
    ("raw", "field"),
    [
        (b'{"segments": [], "cycles_per_shift": 1}', "segments"),
        (b'{"cycles_per_shift": 1}', "segments"),
        (b'{"segments": "x", "cycles_per_shift": 1}', "segments"),
        (body_of(seg(power="-1")), "segments.0.power_kw"),
        (body_of(seg(power='"5"')), "segments.0.power_kw"),
        (body_of(seg(power="1.234")), "segments.0.power_kw"),
        (body_of(seg(duration="0")), "segments.0.duration_min"),
        (body_of(seg(duration="1e400")), "segments.0.duration_min"),
        (body_of(seg(name='""')), "segments.0.name"),
        (body_of(seg(extra=', "fuel": 1')), "segments.0.fuel"),
        (f'{{"segments": [{seg()}]}}'.encode(), "cycles_per_shift"),
        (body_of(seg(), "1.0"), "cycles_per_shift"),
        (body_of(seg(), "501"), "cycles_per_shift"),
        (
            f'{{"segments": [{seg()}], "cycles_per_shift": 1, "shift_hours": 8}}'.encode(),
            "shift_hours",
        ),
    ],
)
def test_invalid_fields_are_422_with_a_field_detail(client, raw, field):
    error = assert_error(post(client, raw=raw), 422, "VALIDATION_ERROR")
    assert field in {d["field"] for d in error["details"]}
    assert all(set(d) == {"field", "reason"} for d in error["details"])


@pytest.mark.parametrize(
    "raw",
    [
        b"not json",
        b"",
        b"[]",
        b'{"segments": [], "segments": [], "cycles_per_shift": 1}',
        body_of(seg(power="NaN")),
        body_of(seg(power="Infinity")),
        bytes([0xFF, 0xFE]),
    ],
)
def test_malformed_bodies_are_422_not_500(client, raw):
    assert_error(post(client, raw=raw), 422, "VALIDATION_ERROR")


def test_submitted_values_are_never_echoed(client):
    body = json.loads(json.dumps(SAMPLE))
    body["segments"][0]["name"] = "SECRET-NAME"
    body["segments"][0]["power_kw"] = "SECRET-VALUE"
    response = post(client, body)
    assert_error(response, 422, "VALIDATION_ERROR")
    assert "SECRET-NAME" not in response.text
    assert "SECRET-VALUE" not in response.text


@pytest.mark.parametrize(
    "content_type", ["text/plain", "application/x-www-form-urlencoded"]
)
def test_wrong_content_type_is_415(client, content_type):
    response = post(client, SAMPLE, headers={"Content-Type": content_type})
    assert_error(response, 415, "UNSUPPORTED_MEDIA_TYPE")


def test_oversized_body_is_413_and_the_exact_limit_is_accepted(client):
    raw = json.dumps(SAMPLE).encode()
    assert_error(
        post(client, raw=raw + b" " * (4 * 1024 + 1 - len(raw))),
        413,
        "PAYLOAD_TOO_LARGE",
    )
    assert post(client, raw=raw + b" " * (4 * 1024 - len(raw))).status_code == 200


# ---------- origin ----------


def test_disallowed_origin_is_forbidden_before_validation(client, origins):
    origins("https://app.example.com")
    for origin in ("https://evil.example", "null", "https://app.example.com.evil"):
        response = post(client, raw=b"not json", headers={"Origin": origin})
        assert_error(response, 403, "FORBIDDEN")


def test_allowed_origin_and_missing_origin_are_accepted(client, origins):
    origins("https://app.example.com, https://other.example")
    assert (
        post(client, SAMPLE, headers={"Origin": "https://app.example.com/"}).status_code
        == 200
    )
    assert post(client, SAMPLE).status_code == 200


def test_every_browser_origin_is_rejected_when_no_allowlist_is_configured(client):
    response = post(client, SAMPLE, headers={"Origin": "https://app.example.com"})
    assert_error(response, 403, "FORBIDDEN")


# ---------- failures and registration ----------


def test_unexpected_failure_is_a_500_that_leaks_nothing(client, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("internal secret")

    monkeypatch.setattr(mining_routes, "run_duty_cycle", boom)
    response = post(client, SAMPLE)
    error = assert_error(response, 500, "INTERNAL_ERROR")
    assert error["message"] == "An unexpected error occurred."
    assert "internal secret" not in response.text


def test_existing_routes_are_still_registered():
    paths = set(app.openapi()["paths"])
    assert {
        "/api/v1/demo/startup-check",
        "/api/v1/demo/capacity-check",
        "/api/v1/demo/duty-cycle",
        "/api/v1/facilities",
        "/api/v1/session",
        "/api/v1/configurations/current",
    } <= paths
