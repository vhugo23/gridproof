"""POST /api/v1/demo/mobile-power (doc 05 API-19). No database, no session.

The endpoint is a pure computation: it must work without a cookie and with every
database entry point forbidden, and it must never set a cookie. Expected numbers are
the hand-calculated sample documented in test_mobile_power.py.
"""

import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import app.db.session as app_session
from app.core import origin as origin_module
from app.main import app
from app.routes import mobile_power as mobile_power_routes

URL = "/api/v1/demo/mobile-power"
JSON_HEADERS = {"Content-Type": "application/json"}

SAMPLE = {
    "loads": [
        {
            "name": "LED floodlights",
            "quantity": 8,
            "rated_kw": 0.4,
            "simultaneity_factor": 1.0,
        },
        {
            "name": "Cabin HVAC",
            "quantity": 2,
            "rated_kw": 7.5,
            "simultaneity_factor": 0.8,
        },
        {
            "name": "Welding machines",
            "quantity": 3,
            "rated_kw": 12.0,
            "simultaneity_factor": 0.5,
        },
        {
            "name": "Air compressor",
            "quantity": 1,
            "rated_kw": 22.0,
            "simultaneity_factor": 0.75,
        },
        {
            "name": "Water pumps",
            "quantity": 2,
            "rated_kw": 5.5,
            "simultaneity_factor": 0.5,
        },
    ],
    "capacity_margin_pct": 25,
}


def _forbid_database(*args, **kwargs):
    raise AssertionError("the mobile-power planner must not touch the database")


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


def one_load(kw="1.00", s="1.00", qty="1", name='"A"', margin="0", extra=""):
    """A raw request with one hand-written load (to send odd JSON numbers)."""
    return (
        f'{{"loads": [{{"name": {name}, "quantity": {qty}, "rated_kw": {kw}, '
        f'"simultaneity_factor": {s}{extra}}}], "capacity_margin_pct": {margin}}}'
    ).encode()


# ---------- the happy path ----------


def test_hand_calculated_sample_without_a_cookie_or_a_database(client):
    response = post(client, SAMPLE)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"].startswith("req_")
    assert "set-cookie" not in response.headers
    body = response.json()
    assert body["model_version"] == "mobile-power-v1"
    assert body["totals"] == {
        "connected_kw": 87.2,
        "demand_kw": 55.2,
        "overall_simultaneity_pct": 63.3,
        "required_kw": 69.0,
        "all_simultaneous_required_kw": 109.0,
    }
    assert body["inputs"]["capacity_margin_pct"] == 25
    assert [l["demand_kw"] for l in body["loads"]] == [3.2, 12.0, 18.0, 16.5, 5.5]
    assert [l["share_of_demand_pct"] for l in body["loads"]] == [
        5.8,
        21.74,
        32.61,
        29.89,
        9.96,
    ]
    assert body["dominant_load_ids"] == ["load-3"]
    assert body["loads"][2]["name"] == "Welding machines"
    assert body["loads"][2]["is_dominant"] is True
    assert set(body["loads"][0]) == {
        "id",
        "name",
        "quantity",
        "rated_kw",
        "simultaneity_factor",
        "connected_kw",
        "demand_kw",
        "share_of_demand_pct",
        "is_dominant",
    }
    assert [p["id"] for p in body["packages"]] == [
        "mobile-m1",
        "mobile-m2",
        "mobile-m3",
        "mobile-m4",
    ]
    assert [p["category"] for p in body["packages"]] == [
        "does_not_meet_modeled",
        "does_not_meet_modeled",
        "meets_modeled_only",
        "meets_modeled_and_all_simultaneous",
    ]
    assert body["packages"][2]["modeled_demand"] == {
        "status": "meets",
        "comparator": "<=",
        "required": 69.0,
        "capacity": 100.0,
        "headroom_kw": 31.0,
        "utilization_pct": 69.0,
    }
    assert body["packages"][2]["all_simultaneous"] == {
        "status": "does_not_meet",
        "comparator": "<=",
        "required": 109.0,
        "capacity": 100.0,
        "headroom_kw": -9.0,
        "utilization_pct": 109.0,
    }
    assert set(body["packages"][0]) == {
        "id",
        "label",
        "rated_kw",
        "modeled_demand",
        "all_simultaneous",
        "category",
        "category_label",
        "explanation",
    }
    assert body["explanation"].startswith(
        "The load with the most modeled demand is Welding machines"
    )
    assert [a["id"] for a in body["assumptions"]][:2] == ["A1", "A2"]


def test_the_margin_is_optional(client):
    body = json.loads(json.dumps(SAMPLE))
    del body["capacity_margin_pct"]
    response = post(client, body)
    assert response.status_code == 200
    assert response.json()["totals"]["required_kw"] == 55.2


def test_the_request_is_parsed_exactly_not_as_a_binary_float(client):
    # 4.83 + 20.30 + 4.87 is exactly 30.00 kW; binary floats give 30.000000000000004
    # and would fail the 30 kW package.
    raw = (
        b'{"loads": ['
        b'{"name": "A", "quantity": 1, "rated_kw": 4.83, "simultaneity_factor": 1.00},'
        b'{"name": "B", "quantity": 1, "rated_kw": 20.30, "simultaneity_factor": 1.00},'
        b'{"name": "C", "quantity": 1, "rated_kw": 4.87, "simultaneity_factor": 1}],'
        b' "capacity_margin_pct": 0}'
    )
    response = post(client, raw=raw)
    assert response.status_code == 200
    m1 = response.json()["packages"][0]
    assert m1["modeled_demand"]["status"] == "meets"
    assert m1["category"] == "meets_modeled_and_all_simultaneous"


def test_80_01_kw_with_25_percent_margin_fails_the_100_kw_package(client):
    response = post(client, raw=one_load(kw="80.01", margin="25"))
    assert response.status_code == 200
    m3 = response.json()["packages"][2]
    assert m3["modeled_demand"]["required"] == 100.01
    assert m3["modeled_demand"]["status"] == "does_not_meet"
    assert m3["category"] == "does_not_meet_modeled"


def test_a_shortfall_that_rounds_to_the_rating_still_fails(client):
    # 320.01 x 0.25 x 1.25 = 100.003125 kW: shown as 100.0, still above 100.
    response = post(client, raw=one_load(kw="320.01", s="0.25", margin="25"))
    assert response.status_code == 200
    m3 = response.json()["packages"][2]
    assert m3["modeled_demand"]["required"] == 100.0
    assert m3["modeled_demand"]["headroom_kw"] == 0.0
    assert "-0.0" not in response.text
    assert m3["modeled_demand"]["status"] == "does_not_meet"


def test_the_largest_valid_request_fits_the_body_limit(client):
    body = {
        "loads": [
            {
                "name": f"{i:02d}" + "n" * 38,
                "quantity": 1,
                "rated_kw": 166.66,
                "simultaneity_factor": 0.99,
            }
            for i in range(12)
        ],
        "capacity_margin_pct": 50,
    }
    raw = json.dumps(body).encode()
    assert len(raw) < 4 * 1024
    assert post(client, raw=raw).status_code == 200


def test_the_same_request_gives_byte_identical_output(client):
    assert post(client, SAMPLE).content == post(client, SAMPLE).content


# ---------- validation ----------


def test_total_connected_load_over_2000_kw_is_a_field_error_on_loads(client):
    assert post(client, raw=one_load(kw="500.00", qty="4")).status_code == 200
    over = (
        b'{"loads": ['
        b'{"name": "Big", "quantity": 4, "rated_kw": 500.00, "simultaneity_factor": 1},'
        b'{"name": "Tiny", "quantity": 1, "rated_kw": 0.01, "simultaneity_factor": 1}]}'
    )
    error = assert_error(post(client, raw=over), 422, "VALIDATION_ERROR")
    assert error["details"] == [
        {
            "field": "loads",
            "reason": (
                "Total connected load must not exceed 2,000 kW; "
                "reduce quantities or rated power"
            ),
        }
    ]


def test_duplicate_names_are_a_field_error_on_the_later_load(client):
    body = json.loads(json.dumps(SAMPLE))
    body["loads"][3]["name"] = " cabin hvac "
    error = assert_error(post(client, body), 422, "VALIDATION_ERROR")
    assert [d["field"] for d in error["details"]] == ["loads.3.name"]


@pytest.mark.parametrize(
    ("raw", "field"),
    [
        (b'{"loads": [], "capacity_margin_pct": 0}', "loads"),
        (b'{"capacity_margin_pct": 0}', "loads"),
        (b'{"loads": "x"}', "loads"),
        (one_load(kw="0"), "loads.0.rated_kw"),
        (one_load(kw="-1"), "loads.0.rated_kw"),
        (one_load(kw='"5"'), "loads.0.rated_kw"),
        (one_load(kw="1.234"), "loads.0.rated_kw"),
        (one_load(kw="500.01"), "loads.0.rated_kw"),
        (one_load(kw="1e400"), "loads.0.rated_kw"),
        (one_load(s="0"), "loads.0.simultaneity_factor"),
        (one_load(s="1.01"), "loads.0.simultaneity_factor"),
        (one_load(s="0.001"), "loads.0.simultaneity_factor"),
        (one_load(s="null"), "loads.0.simultaneity_factor"),
        (one_load(qty="0"), "loads.0.quantity"),
        (one_load(qty="1.0"), "loads.0.quantity"),
        (one_load(qty="101"), "loads.0.quantity"),
        (one_load(qty="true"), "loads.0.quantity"),
        (one_load(name='""'), "loads.0.name"),
        (one_load(extra=', "pf": 0.8'), "loads.0.pf"),
        (one_load(margin="51"), "capacity_margin_pct"),
        (one_load(margin="2.5"), "capacity_margin_pct"),
        (one_load(margin='"5"'), "capacity_margin_pct"),
        (
            (
                b'{"loads": [{"name": "A", "quantity": 1, "rated_kw": 1, '
                b'"simultaneity_factor": 1}], "power_factor": 0.8}'
            ),
            "power_factor",
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
        b'{"loads": [], "loads": []}',
        one_load(kw="NaN"),
        one_load(kw="Infinity"),
        bytes([0xFF, 0xFE]),
    ],
)
def test_malformed_bodies_are_422_not_500(client, raw):
    assert_error(post(client, raw=raw), 422, "VALIDATION_ERROR")


def test_submitted_values_are_never_echoed(client):
    body = json.loads(json.dumps(SAMPLE))
    body["loads"][0]["name"] = "SECRET-NAME"
    body["loads"][0]["rated_kw"] = "SECRET-VALUE"
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

    monkeypatch.setattr(mobile_power_routes, "run_mobile_power", boom)
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
        "/api/v1/demo/mobile-power",
        "/api/v1/facilities",
        "/api/v1/session",
        "/api/v1/configurations/current",
    } <= paths
