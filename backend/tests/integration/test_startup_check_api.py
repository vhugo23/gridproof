"""POST /api/v1/demo/startup-check against the isolated PostgreSQL database.

Sessions come from the real GET /api/v1/session and versions from the real save
endpoint. The application's own database engine is never used.
"""

import copy
import json
import re
import uuid
from types import SimpleNamespace

import pytest
from db_helpers import count
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, OperationalError
from sqlalchemy.orm import Session, sessionmaker

import app.db.session as app_session
from app.core import origin as origin_module
from app.db.session import get_db
from app.main import app
from app.routes import demo as demo_routes
from app.seed.facilities import seed_facilities
from app.services import startup_check as service

SESSION_URL = "/api/v1/session"
CURRENT_URL = "/api/v1/configurations/current"
URL = "/api/v1/demo/startup-check"
TABLES = ("demo_workspaces", "configurations", "configuration_versions")
TOKEN_RE = re.compile(r"gridproof_demo=([A-Za-z0-9_-]{43})")

BASE_SNAPSHOT = {
    "facility_id": "fridley",
    "equipment": {
        "g1": {"rated_kw": 250, "startup_delay_s": 5, "enabled": True},
        "g2": {"rated_kw": 250, "startup_delay_s": 5, "enabled": True},
        "battery": {
            "inverter_kw": 250,
            "usable_kwh": 500,
            "min_soc_pct": 20,
            "initial_soc_pct": 80,
        },
        "utility": {"available": True},
        "switchgear": {"mode": "auto"},
        "load": {"critical_kw": 180},
    },
}


def snapshot(delay: int = 15, load: int = 180) -> dict:
    data = copy.deepcopy(BASE_SNAPSHOT)
    data["equipment"]["g1"]["startup_delay_s"] = delay
    data["equipment"]["load"]["critical_kw"] = load
    return data


def _forbid_application_engine(*args, **kwargs):
    raise AssertionError("the application's own database engine must not be used")


@pytest.fixture
def seeded(committing_engine):
    with Session(committing_engine) as session, session.begin():
        seed_facilities(session)
    return committing_engine


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
def client(seeded, monkeypatch, origins):
    factory = sessionmaker(bind=seeded, autoflush=False, expire_on_commit=False)

    def override():
        with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override
    monkeypatch.setattr(app_session, "SessionLocal", _forbid_application_engine)
    monkeypatch.setattr(app_session.engine, "connect", _forbid_application_engine)
    try:
        yield TestClient(app, base_url="https://testserver")
    finally:
        app.dependency_overrides.pop(get_db, None)


def with_cookie(token: str) -> dict:
    return {"Cookie": f"gridproof_demo={token}"}


class Workspace:
    def __init__(self, client, token, configuration_id, version_id):
        self.client = client
        self.token = token
        self.configuration_id = configuration_id
        self.version_id = version_id  # version 1

    def save(self, expected: int, delay: int, load: int = 180):
        response = self.client.post(
            f"/api/v1/configurations/{self.configuration_id}/versions",
            headers=with_cookie(self.token),
            json={
                "expected_version": expected,
                "name": "Fridley Test Configuration",
                "snapshot": snapshot(delay, load),
            },
        )
        assert response.status_code == 201, response.text
        return response.json()

    def check(self, version=1, configuration_id=None, headers=None, **kwargs):
        merged = with_cookie(self.token)
        merged.update(headers or {})
        if "content" not in kwargs and "json" not in kwargs:
            kwargs["json"] = {
                "configuration_id": configuration_id or self.configuration_id,
                "version_number": version,
            }
        return self.client.post(URL, headers=merged, **kwargs)


def new_workspace(client) -> Workspace:
    client.cookies.clear()
    response = client.get(SESSION_URL)
    assert response.status_code == 200
    token = TOKEN_RE.search(response.headers["set-cookie"]).group(1)
    client.cookies.clear()
    current = client.get(CURRENT_URL, headers=with_cookie(token)).json()
    return Workspace(client, token, current["configuration_id"], current["version_id"])


def dump_tables(engine) -> tuple:
    with engine.connect() as conn:
        return tuple(
            conn.execute(
                text(
                    f"SELECT coalesce(json_agg(t ORDER BY t::text), '[]')::text FROM {t} t"
                )
            ).scalar_one()
            for t in TABLES
        )


def assert_headers(response):
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["vary"] == "Cookie"
    assert "set-cookie" not in response.headers
    assert response.headers["x-request-id"].startswith("req_")


def assert_error(response, status, code):
    assert response.status_code == status, response.text
    error = response.json()["error"]
    assert error["code"] == code
    assert error["request_id"] == response.headers["x-request-id"]
    assert_headers(response)
    return error


def requirement(body: dict, requirement_id: str) -> dict:
    return next(
        r for r in body["requirements"] if r["requirement_id"] == requirement_id
    )


# ---------- the demonstration: baseline versus modified ----------


def test_baseline_and_modified_versions_give_the_documented_results(client):
    ws = new_workspace(client)
    saved = ws.save(1, delay=15)

    v1 = ws.check(version=1)
    v2 = ws.check(version=2)
    assert v1.status_code == 200 and v2.status_code == 200
    assert_headers(v1) and assert_headers(v2)
    b1, b2 = v1.json(), v2.json()

    # Source identifiers point at the immutable saved versions.
    assert b1["source"] == {
        "configuration_id": ws.configuration_id,
        "version_id": ws.version_id,
        "version_number": 1,
        "schema_version": "config-v1",
    }
    assert b2["source"]["version_id"] == saved["version_id"]
    assert b2["source"]["version_number"] == 2

    # Hand-calculated: 180 kW for 5 s = 0.25 kWh; for 15 s = 0.75 kWh.
    assert b1["inputs"]["g1_startup_delay_s"] == 5
    assert b2["inputs"]["g1_startup_delay_s"] == 15
    assert b1["metrics"]["battery_bridge_energy_kwh"] == 0.25
    assert b2["metrics"]["battery_bridge_energy_kwh"] == 0.75
    assert requirement(b1, "G1_READY_WITHIN_10S")["status"] == "pass"
    assert requirement(b2, "G1_READY_WITHIN_10S")["status"] == "fail"
    assert requirement(b2, "G1_READY_WITHIN_10S")["observed"] == 15000
    for body in (b1, b2):
        assert requirement(body, "CRITICAL_LOAD_CONTINUITY")["status"] == "pass"
        assert body["metrics"]["unserved_energy_kwh"] == 0.0
        assert body["model_version"] == "startup-check-v1"
        assert body["scenario"]["horizon_ms"] == 300000


def test_critical_load_above_the_inverter_limit_leaves_unserved_energy(client):
    """Guided battery challenge: demand above the 250 kW inverter until G1 is ready.

    Hand calculation: (400 - 250) kW x 15 s = 2250 kW*s; 2250 / 3600 = 0.625 kWh.
    """
    ws = new_workspace(client)
    ws.save(1, delay=15, load=400)
    body = ws.check(version=2).json()

    assert body["inputs"]["load_kw"] == 400
    assert body["inputs"]["battery_inverter_kw"] == 250
    assert body["metrics"]["unserved_energy_kwh"] == 0.625
    continuity = requirement(body, "CRITICAL_LOAD_CONTINUITY")
    assert continuity["status"] == "fail"
    assert continuity["observed"] == 0.625
    outage = next(e for e in body["events"] if e["type"] == "utility_outage")
    frame = next(f for f in body["frames"] if f["event_id"] == outage["id"])
    assert frame["power_kw"]["battery_kw"] == 250
    assert frame["power_kw"]["unserved_kw"] == 150
    # Readiness is judged separately: 15 s still fails the 10 s requirement.
    assert requirement(body, "G1_READY_WITHIN_10S")["status"] == "fail"


def test_response_shape(client):
    body = new_workspace(client).check().json()
    assert set(body) == {
        "model_version",
        "source",
        "scenario",
        "assumptions",
        "inputs",
        "events",
        "frames",
        "metrics",
        "requirements",
    }
    assert [e["id"] for e in body["events"]] == [
        f"evt-{i:02d}" for i in range(1, len(body["events"]) + 1)
    ]
    assert [f["event_id"] for f in body["frames"]] == [e["id"] for e in body["events"]]


# ---------- stateless, read-only, immutable ----------


def test_check_writes_nothing_and_changes_no_version(client, seeded):
    ws = new_workspace(client)
    ws.save(1, delay=15)
    before = dump_tables(seeded)
    with seeded.connect() as conn:
        counts_before = tuple(count(conn, t) for t in TABLES)

    for version in (1, 2, 1):
        assert ws.check(version=version).status_code == 200
    # Failed checks do not write either.
    assert ws.check(version=99).status_code == 404

    assert dump_tables(seeded) == before
    with seeded.connect() as conn:
        assert tuple(count(conn, t) for t in TABLES) == counts_before
    current = client.get(CURRENT_URL, headers=with_cookie(ws.token)).json()
    assert current["latest_version"] == 2


def test_repeated_checks_are_byte_identical(client):
    ws = new_workspace(client)
    first = ws.check().content
    assert ws.check().content == first
    assert ws.check().content == first


def test_an_old_version_is_still_evaluated_after_later_saves(client):
    ws = new_workspace(client)
    ws.save(1, delay=15)
    ws.save(2, delay=0)
    old = ws.check(version=1).json()
    assert old["inputs"]["g1_startup_delay_s"] == 5
    assert requirement(old, "G1_READY_WITHIN_10S")["status"] == "pass"
    newest = ws.check(version=3).json()
    assert newest["inputs"]["g1_startup_delay_s"] == 0


def test_the_database_transaction_is_read_only(seeded, monkeypatch):
    """Even a write attempted inside the service is rejected by PostgreSQL."""
    factory = sessionmaker(bind=seeded, autoflush=False, expire_on_commit=False)
    with factory() as setup, setup.begin():
        workspace_id = setup.execute(
            text(
                "INSERT INTO demo_workspaces (id, token_hash, expires_at) VALUES "
                "(gen_random_uuid(), 'h', now() + interval '1 day') RETURNING id"
            )
        ).scalar_one()
        facility = setup.execute(
            text("SELECT id FROM facility_catalog LIMIT 1")
        ).scalar_one()
        configuration_id = setup.execute(
            text(
                "INSERT INTO configurations (id, workspace_id, facility_id, name, "
                "latest_version) VALUES (gen_random_uuid(), :w, :f, 'n', 1) RETURNING id"
            ),
            {"w": workspace_id, "f": facility},
        ).scalar_one()
        setup.execute(
            text(
                "INSERT INTO configuration_versions (id, configuration_id, "
                "version_number, schema_version, snapshot_json) VALUES "
                "(gen_random_uuid(), :c, 1, 'config-v1', CAST(:s AS jsonb))"
            ),
            {"c": configuration_id, "s": json.dumps(snapshot(5))},
        )

    def sneaky_write(config, source):
        session.execute(text("DELETE FROM configuration_versions"))

    monkeypatch.setattr(service, "run_startup_check", sneaky_write)
    with factory() as session, pytest.raises(DBAPIError) as excinfo:
        service.startup_check_for_version(session, workspace_id, configuration_id, 1)
    assert "read-only" in str(excinfo.value).lower()
    with seeded.connect() as conn:
        assert count(conn, "configuration_versions") == 1


# ---------- ownership ----------


def test_foreign_missing_and_unknown_version_are_the_same_404(client, seeded):
    a = new_workspace(client)
    b = new_workspace(client)
    before = dump_tables(seeded)

    foreign = b.check(configuration_id=a.configuration_id)
    missing = b.check(configuration_id=str(uuid.uuid4()))
    unknown_version = a.check(version=7)

    for response in (foreign, missing, unknown_version):
        assert_error(response, 404, "CONFIGURATION_NOT_FOUND")
    bodies = [
        {k: v for k, v in r.json()["error"].items() if k != "request_id"}
        for r in (foreign, missing, unknown_version)
    ]
    assert bodies[0] == bodies[1] == bodies[2]
    assert dump_tables(seeded) == before


def test_a_workspace_never_sees_another_workspaces_values(client):
    a = new_workspace(client)
    b = new_workspace(client)
    a.save(1, delay=15, load=222)
    own = b.check().json()
    assert own["inputs"]["load_kw"] == 180
    assert own["source"]["configuration_id"] == b.configuration_id


def test_workspace_identifiers_are_not_accepted(client):
    ws = new_workspace(client)
    payload = {
        "configuration_id": ws.configuration_id,
        "version_number": 1,
        "workspace_id": str(uuid.uuid4()),
    }
    assert_error(ws.check(json=payload), 422, "VALIDATION_ERROR")


# ---------- the client cannot supply equipment values ----------


def test_client_supplied_equipment_is_rejected(client):
    ws = new_workspace(client)
    for extra in (
        {"snapshot": snapshot(0)},
        {"startup_delay_s": 0},
        {"equipment": BASE_SNAPSHOT["equipment"]},
    ):
        payload = {
            "configuration_id": ws.configuration_id,
            "version_number": 1,
            **extra,
        }
        error = assert_error(ws.check(json=payload), 422, "VALIDATION_ERROR")
        assert error["details"]


# ---------- authentication ----------


def test_missing_cookie_is_session_required(client, seeded):
    ws = new_workspace(client)
    before = dump_tables(seeded)
    response = client.post(
        URL, json={"configuration_id": ws.configuration_id, "version_number": 1}
    )
    assert_error(response, 401, "SESSION_REQUIRED")
    assert dump_tables(seeded) == before


def test_malformed_unknown_and_duplicate_cookies_are_session_required(client):
    ws = new_workspace(client)
    payload = {"configuration_id": ws.configuration_id, "version_number": 1}
    for cookie in (
        "gridproof_demo=short",
        "gridproof_demo=" + "Z" * 43,
        f"gridproof_demo={ws.token}; gridproof_demo={ws.token}",
    ):
        assert_error(
            client.post(URL, json=payload, headers={"Cookie": cookie}),
            401,
            "SESSION_REQUIRED",
        )


def test_expired_workspace_is_workspace_expired_and_not_renewed(client, seeded):
    ws = new_workspace(client)
    with seeded.begin() as conn:
        conn.execute(
            text(
                "UPDATE demo_workspaces SET created_at = now() - interval '8 days', "
                "expires_at = now() - interval '1 second'"
            )
        )
    before = dump_tables(seeded)
    assert_error(ws.check(), 401, "WORKSPACE_EXPIRED")
    assert dump_tables(seeded) == before


# ---------- origin ----------


def test_disallowed_origin_is_forbidden_before_anything_else(client, origins):
    ws = new_workspace(client)
    origins("https://app.example.com")
    for origin in ("https://evil.example", "null", "https://app.example.com.evil"):
        assert_error(ws.check(headers={"Origin": origin}), 403, "FORBIDDEN")
    # Rejected before authentication: no cookie still gives 403, not 401.
    response = client.post(
        URL,
        json={"configuration_id": ws.configuration_id, "version_number": 1},
        headers={"Origin": "https://evil.example"},
    )
    assert_error(response, 403, "FORBIDDEN")


def test_allowed_origin_and_missing_origin_are_accepted(client, origins):
    ws = new_workspace(client)
    origins("https://app.example.com, https://other.example")
    assert ws.check(headers={"Origin": "https://app.example.com/"}).status_code == 200
    assert ws.check().status_code == 200


def test_every_browser_origin_is_rejected_when_no_allowlist_is_configured(client):
    ws = new_workspace(client)
    assert_error(
        ws.check(headers={"Origin": "https://app.example.com"}), 403, "FORBIDDEN"
    )


# ---------- request validation ----------


@pytest.mark.parametrize(
    "content_type", ["text/plain", "application/x-www-form-urlencoded"]
)
def test_wrong_content_type_is_415(client, content_type):
    ws = new_workspace(client)
    response = ws.check(
        headers={"Content-Type": content_type},
        content=json.dumps(
            {"configuration_id": ws.configuration_id, "version_number": 1}
        ).encode(),
    )
    assert_error(response, 415, "UNSUPPORTED_MEDIA_TYPE")


def test_json_content_type_with_charset_is_accepted(client):
    ws = new_workspace(client)
    response = ws.check(
        headers={"Content-Type": "Application/JSON; charset=utf-8"},
        content=json.dumps(
            {"configuration_id": ws.configuration_id, "version_number": 1}
        ).encode(),
    )
    assert response.status_code == 200


@pytest.mark.parametrize(
    "raw",
    [
        b"not json",
        b"",
        b'{"configuration_id": "x", "configuration_id": "y", "version_number": 1}',
        b'{"version_number": NaN, "configuration_id": "a"}',
        b"[]",
    ],
)
def test_malformed_bodies_are_422(client, raw):
    ws = new_workspace(client)
    response = ws.check(headers={"Content-Type": "application/json"}, content=raw)
    assert_error(response, 422, "VALIDATION_ERROR")


@pytest.mark.parametrize("version", [0, -1, 2**31, 1.0, 1.5, "1", True, None])
def test_version_number_must_be_a_strict_positive_integer(client, version):
    ws = new_workspace(client)
    payload = {"configuration_id": ws.configuration_id, "version_number": version}
    assert_error(ws.check(json=payload), 422, "VALIDATION_ERROR")


@pytest.mark.parametrize("configuration_id", ["nope", 5, None, ""])
def test_configuration_id_must_be_a_uuid(client, configuration_id):
    ws = new_workspace(client)
    payload = {"configuration_id": configuration_id, "version_number": 1}
    error = assert_error(ws.check(json=payload), 422, "VALIDATION_ERROR")
    assert "nope" not in json.dumps(error)  # submitted values are never echoed


def test_missing_fields_are_422(client):
    ws = new_workspace(client)
    assert_error(ws.check(json={}), 422, "VALIDATION_ERROR")
    assert_error(
        ws.check(json={"configuration_id": ws.configuration_id}),
        422,
        "VALIDATION_ERROR",
    )


def test_oversized_body_is_413(client):
    ws = new_workspace(client)
    raw = json.dumps(
        {"configuration_id": ws.configuration_id, "version_number": 1}
    ).encode()
    padded = raw + b" " * (4 * 1024 + 1 - len(raw))
    response = ws.check(headers={"Content-Type": "application/json"}, content=padded)
    assert_error(response, 413, "PAYLOAD_TOO_LARGE")
    exact = raw + b" " * (4 * 1024 - len(raw))
    assert (
        ws.check(
            headers={"Content-Type": "application/json"}, content=exact
        ).status_code
        == 200
    )


# ---------- stored-data faults and dependency failures ----------


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE configuration_versions SET schema_version = 'config-v9'",
        'UPDATE configuration_versions SET snapshot_json = \'{"facility_id": "fridley"}\'::jsonb',
        "UPDATE configuration_versions SET snapshot_json = '[]'::jsonb",
    ],
)
def test_invalid_stored_snapshot_is_a_500_that_leaks_nothing(client, seeded, statement):
    ws = new_workspace(client)
    with seeded.begin() as conn:
        conn.execute(text(statement))
    before = dump_tables(seeded)
    response = ws.check()
    error = assert_error(response, 500, "INTERNAL_ERROR")
    assert error["message"] == "An unexpected error occurred."
    assert "fridley" not in response.text and "config-v9" not in response.text
    assert dump_tables(seeded) == before


def test_database_failure_is_a_503(client, monkeypatch):
    ws = new_workspace(client)

    def boom(*args, **kwargs):
        raise OperationalError("SELECT 1", {}, Exception("secret detail"))

    monkeypatch.setattr(demo_routes, "startup_check_for_version", boom)
    response = ws.check()
    assert_error(response, 503, "DATABASE_UNAVAILABLE")
    assert "secret detail" not in response.text


def test_unexpected_failure_is_a_500_that_leaks_nothing(client, monkeypatch):
    ws = new_workspace(client)

    def boom(*args, **kwargs):
        raise RuntimeError("internal secret")

    monkeypatch.setattr(demo_routes, "startup_check_for_version", boom)
    response = ws.check()
    assert_error(response, 500, "INTERNAL_ERROR")
    assert "internal secret" not in response.text
