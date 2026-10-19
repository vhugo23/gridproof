"""POST /api/v1/demo/capacity-check (doc 05 API-17). No database, no session.

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
from app.routes import daventry as daventry_routes

URL = "/api/v1/demo/capacity-check"
JSON_HEADERS = {"Content-Type": "application/json"}


def _forbid_database(*args, **kwargs):
    raise AssertionError("the capacity check must not touch the database")


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


def assert_headers(response):
    assert response.headers["cache-control"] == "no-store"
    assert "set-cookie" not in response.headers
    assert response.headers["x-request-id"].startswith("req_")


def assert_error(response, status, code):
    assert response.status_code == status, response.text
    error = response.json()["error"]
    assert error["code"] == code
    assert error["request_id"] == response.headers["x-request-id"]
    assert "set-cookie" not in response.headers
    return error


def package(body, letter):
    return next(p for p in body["packages"] if p["id"] == f"synthetic-{letter}")


# ---------- the happy path ----------


def test_case_1_without_a_cookie_and_without_a_database(client):
    response = post(client, {"real_power_kw": 400, "power_factor": 0.8})
    assert response.status_code == 200
    assert_headers(response)
    body = response.json()
    assert body["model_version"] == "capacity-check-v1"
    assert body["inputs"] == {
        "real_power_kw": 400,
        "power_factor": 0.8,
        "capacity_margin_pct": 0,
    }
    assert body["demand"] == {
        "real_power_kw": 400,
        "apparent_power_kva": 500.0,
        "required_kw": 400.0,
        "required_kva": 500.0,
    }
    verdicts = {
        p["id"]: [r["status"] for r in p["requirements"]] for p in body["packages"]
    }
    assert verdicts == {
        "synthetic-a": ["fail", "fail"],
        "synthetic-b": ["fail", "fail"],
        "synthetic-c": ["pass", "pass"],
        "synthetic-d": ["pass", "pass"],
    }
    c_kw, c_kva = package(body, "c")["requirements"]
    assert (c_kw["margin"], c_kw["margin_pct_of_required"]) == (80.0, 20.0)
    assert (c_kva["margin"], c_kva["margin_pct_of_required"]) == (100.0, 20.0)
    assert set(c_kw) == {
        "requirement_id",
        "status",
        "comparator",
        "required",
        "capacity",
        "unit",
        "margin",
        "margin_pct_of_required",
        "explanation",
    }
    assert [a["id"] for a in body["assumptions"]][:2] == ["A1", "A2"]


def test_case_2_split_verdict_over_http(client):
    body = post(client, {"real_power_kw": 300, "power_factor": 0.70}).json()
    b_kw, b_kva = package(body, "b")["requirements"]
    assert (b_kw["status"], b_kva["status"]) == ("pass", "fail")
    assert b_kva["margin"] == -28.57
    assert package(body, "b")["both_requirements_pass"] is False


def test_the_request_is_parsed_exactly_not_as_a_binary_float(client):
    # 228 / 0.57 is exactly 400 kVA; floats would give 400.00000000000006 and fail.
    response = post(client, raw=b'{"real_power_kw": 228, "power_factor": 0.57}')
    assert response.status_code == 200
    _, b_kva = package(response.json(), "b")["requirements"]
    assert (b_kva["status"], b_kva["margin"]) == ("pass", 0.0)


def test_integer_power_factor_one_and_margin_default_and_equality(client):
    body = post(
        client,
        {"real_power_kw": 400, "power_factor": 1, "capacity_margin_pct": 20},
    ).json()
    c_kw, _ = package(body, "c")["requirements"]
    assert (c_kw["status"], c_kw["margin"]) == ("pass", 0.0)
    omitted = post(client, {"real_power_kw": 400, "power_factor": 1}).json()
    assert omitted["inputs"]["capacity_margin_pct"] == 0


def test_identical_requests_give_byte_identical_responses(client):
    body = {"real_power_kw": 300, "power_factor": 0.7, "capacity_margin_pct": 5}
    first = post(client, body).content
    assert post(client, body).content == first


def test_no_cookie_is_set_and_a_stray_cookie_is_ignored(client):
    response = client.post(
        URL,
        json={"real_power_kw": 1, "power_factor": 1},
        headers={"Cookie": "gridproof_demo=" + "Z" * 43},
    )
    assert response.status_code == 200
    assert "set-cookie" not in response.headers


# ---------- validation ----------

VALID = '"real_power_kw": 400, "power_factor": 0.8'


@pytest.mark.parametrize(
    "raw, field",
    [
        (b'{"real_power_kw": 0, "power_factor": 0.8}', "real_power_kw"),
        (b'{"real_power_kw": 2001, "power_factor": 0.8}', "real_power_kw"),
        (b'{"real_power_kw": -1, "power_factor": 0.8}', "real_power_kw"),
        (b'{"real_power_kw": 1.5, "power_factor": 0.8}', "real_power_kw"),
        (b'{"real_power_kw": 400.0, "power_factor": 0.8}', "real_power_kw"),
        (b'{"real_power_kw": "400", "power_factor": 0.8}', "real_power_kw"),
        (b'{"real_power_kw": true, "power_factor": 0.8}', "real_power_kw"),
        (b'{"real_power_kw": null, "power_factor": 0.8}', "real_power_kw"),
        (b'{"power_factor": 0.8}', "real_power_kw"),
        (b'{"real_power_kw": 400, "power_factor": 0.49}', "power_factor"),
        (b'{"real_power_kw": 400, "power_factor": 1.01}', "power_factor"),
        (b'{"real_power_kw": 400, "power_factor": 0.855}', "power_factor"),
        (b'{"real_power_kw": 400, "power_factor": "0.8"}', "power_factor"),
        (b'{"real_power_kw": 400, "power_factor": true}', "power_factor"),
        (b'{"real_power_kw": 400, "power_factor": null}', "power_factor"),
        (b'{"real_power_kw": 400, "power_factor": 0}', "power_factor"),
        (b'{"real_power_kw": 400, "power_factor": 2}', "power_factor"),
        (b'{"real_power_kw": 400, "power_factor": 1e400}', "power_factor"),
        (b'{"real_power_kw": 400}', "power_factor"),
        (
            b'{"real_power_kw": 400, "power_factor": 0.8, "capacity_margin_pct": -1}',
            "capacity_margin_pct",
        ),
        (
            b'{"real_power_kw": 400, "power_factor": 0.8, "capacity_margin_pct": 51}',
            "capacity_margin_pct",
        ),
        (
            b'{"real_power_kw": 400, "power_factor": 0.8, "capacity_margin_pct": 10.5}',
            "capacity_margin_pct",
        ),
        (
            b'{"real_power_kw": 400, "power_factor": 0.8, "capacity_margin_pct": "10"}',
            "capacity_margin_pct",
        ),
        (
            b'{"real_power_kw": 400, "power_factor": 0.8, "capacity_margin_pct": true}',
            "capacity_margin_pct",
        ),
        (
            b'{"real_power_kw": 400, "power_factor": 0.8, "capacity_margin_pct": null}',
            "capacity_margin_pct",
        ),
        (b'{"real_power_kw": 400, "power_factor": 0.8, "snapshot": {}}', "snapshot"),
        (
            b'{"real_power_kw": 400, "power_factor": 0.8, "package": "synthetic-a"}',
            "package",
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
        b'{"real_power_kw": 1, "real_power_kw": 2, "power_factor": 1}',
        b'{"real_power_kw": NaN, "power_factor": 1}',
        b'{"real_power_kw": 1, "power_factor": Infinity}',
        b'{"real_power_kw": 1, "power_factor": 1e9999999999999999999}',
        b"\xff\xfe",
    ],
)
def test_malformed_bodies_are_422_not_500(client, raw):
    assert_error(post(client, raw=raw), 422, "VALIDATION_ERROR")


def test_submitted_values_are_never_echoed(client):
    response = post(client, raw=b'{"real_power_kw": "SECRET-VALUE", "power_factor": 1}')
    assert_error(response, 422, "VALIDATION_ERROR")
    assert "SECRET-VALUE" not in response.text


@pytest.mark.parametrize(
    "content_type", ["text/plain", "application/x-www-form-urlencoded"]
)
def test_wrong_content_type_is_415(client, content_type):
    response = post(
        client,
        raw=b'{"real_power_kw": 1, "power_factor": 1}',
        headers={"Content-Type": content_type},
    )
    assert_error(response, 415, "UNSUPPORTED_MEDIA_TYPE")


def test_json_content_type_with_charset_is_accepted(client):
    response = post(
        client,
        raw=b'{"real_power_kw": 1, "power_factor": 1}',
        headers={"Content-Type": "Application/JSON; charset=utf-8"},
    )
    assert response.status_code == 200


def test_oversized_body_is_413_and_the_exact_limit_is_accepted(client):
    raw = b'{"real_power_kw": 1, "power_factor": 1}'
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
    body = {"real_power_kw": 1, "power_factor": 1}
    assert (
        post(client, body, headers={"Origin": "https://app.example.com/"}).status_code
        == 200
    )
    assert post(client, body).status_code == 200


def test_every_browser_origin_is_rejected_when_no_allowlist_is_configured(client):
    response = post(
        client,
        {"real_power_kw": 1, "power_factor": 1},
        headers={"Origin": "https://app.example.com"},
    )
    assert_error(response, 403, "FORBIDDEN")


# ---------- failures ----------


def test_unexpected_failure_is_a_500_that_leaks_nothing(client, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("internal secret")

    monkeypatch.setattr(daventry_routes, "run_capacity_check", boom)
    response = post(client, {"real_power_kw": 1, "power_factor": 1})
    error = assert_error(response, 500, "INTERNAL_ERROR")
    assert error["message"] == "An unexpected error occurred."
    assert "internal secret" not in response.text


def test_existing_routes_are_still_registered():
    paths = set(app.openapi()["paths"])
    assert {
        "/api/v1/demo/startup-check",
        "/api/v1/demo/capacity-check",
        "/api/v1/facilities",
        "/api/v1/session",
        "/api/v1/configurations/current",
    } <= paths
