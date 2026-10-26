"""POST /api/v1/demo/engine-test-plan (doc 05 API-20). No database, no session.

The endpoint is a pure computation: it must work without a cookie and with every
database entry point forbidden, and it must never set a cookie. Expected numbers are
the hand-calculated golden plan documented in test_engine_test_plan.py.
"""

import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import app.db.session as app_session
from app.core import origin as origin_module
from app.main import app
from app.routes import seymour as seymour_routes

URL = "/api/v1/demo/engine-test-plan"
JSON_HEADERS = {"Content-Type": "application/json"}

GOLDEN = {
    "objective": "Synthetic mid-speed coverage check",
    "requirements": [
        {
            "label": "R1 Low-speed",
            "rpm_min": 800,
            "rpm_max": 1200,
            "torque_min_nm": 400,
            "torque_max_nm": 600,
            "min_points": 1,
            "min_dwell_min": 10,
        },
        {
            "label": "R2 Mid-speed",
            "rpm_min": 1400,
            "rpm_max": 1600,
            "torque_min_nm": 900,
            "torque_max_nm": 1100,
            "power_min_kw": 150,
        },
        {
            "label": "R3 Rated-speed",
            "rpm_min": 1750,
            "rpm_max": 1850,
            "torque_min_nm": 700,
            "torque_max_nm": 900,
            "min_points": 2,
            "min_dwell_min": 20,
        },
        {
            "label": "R4 Peak torque",
            "rpm_min": 1100,
            "rpm_max": 1300,
            "torque_min_nm": 1350,
            "torque_max_nm": 1500,
        },
    ],
    "points": [
        {"label": "Point A", "rpm": 1000, "torque_nm": 500, "dwell_min": 10},
        {"label": "Point B", "rpm": 1500, "torque_nm": 1000, "dwell_min": 20},
        {"label": "Point C", "rpm": 1800, "torque_nm": 800, "dwell_min": 15},
        {"label": "Point D", "rpm": 1200, "torque_nm": 1300, "dwell_min": 15},
    ],
}


def _forbid_database(*args, **kwargs):
    raise AssertionError("the engine test-plan workbench must not touch the database")


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


def one_plan(rpm="1500", torque="1000", power="null", extra="", dwell="10"):
    """A raw request with one requirement and one point (to send odd JSON numbers)."""
    return (
        '{"objective": "O", "requirements": [{"label": "R", "rpm_min": 1000, '
        '"rpm_max": 2000, "torque_min_nm": 100, "torque_max_nm": 1100, '
        f'"power_min_kw": {power}}}], "points": [{{"label": "P", "rpm": {rpm}, '
        f'"torque_nm": {torque}, "dwell_min": {dwell}{extra}}}]}}'
    ).encode()


# ---------- the happy path ----------


def test_golden_plan_without_a_cookie_or_a_database(client):
    response = post(client, GOLDEN)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"].startswith("req_")
    assert "set-cookie" not in response.headers
    body = response.json()
    assert body["model_version"] == "engine-test-plan-v1"
    assert [p["power_kw"] for p in body["points"]] == [52.36, 157.08, 150.8, 163.36]
    assert [r["status"] for r in body["requirements"]] == [
        "covered_by_plan",
        "covered_by_plan",
        "partly_covered",
        "not_covered",
    ]
    assert body["summary"] == {
        "requirements_total": 4,
        "covered_by_plan": 2,
        "partly_covered": 1,
        "not_covered": 1,
        "points_total": 4,
        "distinct_conditions": 4,
        "repeated_conditions": [],
        "planned_hold_min": 60,
        "min_power_kw": 52.36,
        "max_power_kw": 163.36,
        "unmatched_point_ids": ["point-4"],
    }
    assert body["verification"]["status"] == "not_verified"
    assert len(body["evidence_checklist"]) == 18
    assert body["points"][0]["step_from_previous"] is None
    assert body["points"][1]["step_from_previous"] == {
        "delta_rpm": 500,
        "delta_torque_nm": 500.0,
    }
    assert set(body) == {
        "model_version",
        "inputs",
        "points",
        "requirements",
        "summary",
        "verification",
        "evidence_checklist",
        "explanation",
        "assumptions",
    }
    assert body["requirements"][3]["point_checks"][3]["torque"] == {
        "met": False,
        "value": 1300.0,
        "minimum": 1350.0,
        "maximum": 1500.0,
        "outside_by": -50.0,
    }
    assert [a["id"] for a in body["assumptions"]][:2] == ["A1", "A2"]


def test_the_optional_requirement_fields_may_be_omitted(client):
    body = json.loads(json.dumps(GOLDEN))
    for key in ("min_points", "min_dwell_min", "power_min_kw"):
        for requirement in body["requirements"]:
            requirement.pop(key, None)
    response = post(client, body)
    assert response.status_code == 200
    first = response.json()["inputs"]["requirements"][0]
    assert (first["min_points"], first["min_dwell_min"], first["power_min_kw"]) == (
        1,
        0,
        None,
    )


def test_the_request_is_parsed_exactly_not_as_a_binary_float(client):
    # 157.08 as a JSON number must stay exactly 157.08 (not a binary float) so the
    # 157.0796... kW point is judged below it.
    response = post(client, raw=one_plan(power="157.08"))
    assert response.status_code == 200
    body = response.json()
    assert body["points"][0]["power_kw"] == 157.08
    assert body["requirements"][0]["status"] == "not_covered"
    power = body["requirements"][0]["point_checks"][0]["power"]
    assert power["met"] is False
    assert power["equal_when_rounded"] is True
    assert "-0.0" not in response.text


def test_a_threshold_just_below_the_exact_power_is_met(client):
    body = post(client, raw=one_plan(power="157.07")).json()
    assert body["requirements"][0]["status"] == "covered_by_plan"


def test_repeated_coordinates_count_as_separate_entries_and_are_disclosed(client):
    point = {"label": "A", "rpm": 1500, "torque_nm": 500, "dwell_min": 10}
    body = {
        "objective": "Repeat",
        "requirements": [
            {
                "label": "R",
                "rpm_min": 1000,
                "rpm_max": 2000,
                "torque_min_nm": 100,
                "torque_max_nm": 900,
                "min_points": 2,
            }
        ],
        "points": [point, {**point, "label": "B"}],
    }
    data = post(client, body).json()
    requirement = data["requirements"][0]
    assert requirement["status"] == "covered_by_plan"
    assert requirement["matched_entries"] == 2
    assert requirement["matched_distinct_conditions"] == 1
    assert data["summary"]["distinct_conditions"] == 1
    assert data["summary"]["repeated_conditions"] == [
        {"rpm": 1500, "torque_nm": 500.0, "point_ids": ["point-1", "point-2"]}
    ]


def test_the_largest_valid_request_fits_the_body_limit(client):
    body = {
        "objective": "o" * 80,
        "requirements": [
            {
                "label": f"{i:02d}" + "n" * 38,
                "rpm_min": 6000,
                "rpm_max": 6000,
                "torque_min_nm": 19999.99,
                "torque_max_nm": 19999.99,
                "power_min_kw": 19999.99,
                "min_points": 12,
                "min_dwell_min": 1440,
            }
            for i in range(10)
        ],
        "points": [
            {
                "label": f"{i:02d}" + "n" * 38,
                "rpm": 6000,
                "torque_nm": 19999.99,
                "dwell_min": 120,
            }
            for i in range(12)
        ],
    }
    raw = json.dumps(body).encode()
    assert len(raw) < 4 * 1024
    assert post(client, raw=raw).status_code == 200


def test_the_same_request_gives_byte_identical_output(client):
    assert post(client, GOLDEN).content == post(client, GOLDEN).content


# ---------- validation ----------


def test_cross_field_errors_are_reported_only_with_valid_fields(client):
    body = json.loads(json.dumps(GOLDEN))
    body["requirements"][0]["rpm_max"] = 700
    body["points"][1]["label"] = " point a "
    error = assert_error(post(client, body), 422, "VALIDATION_ERROR")
    assert {d["field"] for d in error["details"]} == {
        "requirements.0.rpm_max",
        "points.1.label",
    }
    body["points"][2]["rpm"] = 0  # a single-field error hides the cross-field ones
    error = assert_error(post(client, body), 422, "VALIDATION_ERROR")
    assert [d["field"] for d in error["details"]] == ["points.2.rpm"]


def test_total_planned_hold_over_1440_minutes_is_a_field_error_on_points(client):
    body = {
        "objective": "Hold",
        "requirements": GOLDEN["requirements"][:1],
        "points": [
            {"label": f"P{i}", "rpm": 1500, "torque_nm": 500, "dwell_min": 121}
            for i in range(12)
        ],
    }
    error = assert_error(post(client, body), 422, "VALIDATION_ERROR")
    assert error["details"] == [
        {
            "field": "points",
            "reason": (
                "Total planned hold time must not exceed 1,440 minutes; "
                "shorten the holds or remove points"
            ),
        }
    ]


MIN_POINTS_ZERO = (
    b'{"objective": "O", "requirements": [{"label": "R", "rpm_min": 1, '
    b'"rpm_max": 2, "torque_min_nm": 0, "torque_max_nm": 1, "min_points": 0}], '
    b'"points": [{"label": "P", "rpm": 1, "torque_nm": 0, "dwell_min": 1}]}'
)
EXTRA_TOP_LEVEL = (
    b'{"objective": "O", "requirements": [{"label": "R", "rpm_min": 1, '
    b'"rpm_max": 2, "torque_min_nm": 0, "torque_max_nm": 1}], '
    b'"points": [{"label": "P", "rpm": 1, "torque_nm": 0, "dwell_min": 1}], '
    b'"engine_limit": 5}'
)


@pytest.mark.parametrize(
    ("raw", "field"),
    [
        (b'{"objective": "O", "requirements": [], "points": []}', "requirements"),
        (b'{"objective": "O"}', "requirements"),
        (b'{"requirements": [], "points": []}', "objective"),
        (b'{"objective": "O", "requirements": "x", "points": []}', "requirements"),
        (one_plan(rpm="0"), "points.0.rpm"),
        (one_plan(rpm="6001"), "points.0.rpm"),
        (one_plan(rpm="1500.0"), "points.0.rpm"),
        (one_plan(rpm='"1500"'), "points.0.rpm"),
        (one_plan(rpm="true"), "points.0.rpm"),
        (one_plan(rpm="null"), "points.0.rpm"),
        (one_plan(torque="-1"), "points.0.torque_nm"),
        (one_plan(torque="20000.01"), "points.0.torque_nm"),
        (one_plan(torque="1.234"), "points.0.torque_nm"),
        (one_plan(torque='"5"'), "points.0.torque_nm"),
        (one_plan(torque="1e400"), "points.0.torque_nm"),
        (one_plan(dwell="0"), "points.0.dwell_min"),
        (one_plan(dwell="481"), "points.0.dwell_min"),
        (one_plan(power="0"), "requirements.0.power_min_kw"),
        (one_plan(power="20000.01"), "requirements.0.power_min_kw"),
        (one_plan(power="1.234"), "requirements.0.power_min_kw"),
        (one_plan(power='"5"'), "requirements.0.power_min_kw"),
        (one_plan(extra=', "efficiency": 0.4'), "points.0.efficiency"),
        (MIN_POINTS_ZERO, "requirements.0.min_points"),
        (EXTRA_TOP_LEVEL, "engine_limit"),
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
        b'{"objective": "a", "objective": "b"}',
        one_plan(torque="NaN"),
        one_plan(torque="Infinity"),
        bytes([0xFF, 0xFE]),
    ],
)
def test_malformed_bodies_are_422_not_500(client, raw):
    assert_error(post(client, raw=raw), 422, "VALIDATION_ERROR")


def test_submitted_values_are_never_echoed(client):
    body = json.loads(json.dumps(GOLDEN))
    body["objective"] = "SECRET-OBJECTIVE"
    body["points"][0]["label"] = "SECRET-LABEL"
    body["points"][0]["torque_nm"] = "SECRET-VALUE"
    response = post(client, body)
    assert_error(response, 422, "VALIDATION_ERROR")
    for secret in ("SECRET-OBJECTIVE", "SECRET-LABEL", "SECRET-VALUE"):
        assert secret not in response.text


@pytest.mark.parametrize(
    "content_type", ["text/plain", "application/x-www-form-urlencoded"]
)
def test_wrong_content_type_is_415(client, content_type):
    response = post(client, GOLDEN, headers={"Content-Type": content_type})
    assert_error(response, 415, "UNSUPPORTED_MEDIA_TYPE")


def test_oversized_body_is_413_and_the_exact_limit_is_accepted(client):
    raw = json.dumps(GOLDEN).encode()
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
        post(client, GOLDEN, headers={"Origin": "https://app.example.com/"}).status_code
        == 200
    )
    assert post(client, GOLDEN).status_code == 200


def test_every_browser_origin_is_rejected_when_no_allowlist_is_configured(client):
    response = post(client, GOLDEN, headers={"Origin": "https://app.example.com"})
    assert_error(response, 403, "FORBIDDEN")


# ---------- failures and registration ----------


def test_unexpected_failure_is_a_500_that_leaks_nothing(client, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("internal secret")

    monkeypatch.setattr(seymour_routes, "run_engine_test_plan", boom)
    response = post(client, GOLDEN)
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
        "/api/v1/demo/engine-test-plan",
        "/api/v1/facilities",
        "/api/v1/session",
        "/api/v1/configurations/current",
    } <= paths
