"""GET /api/v1/configurations/current against the isolated PostgreSQL test database.

Sessions are issued through the real GET /api/v1/session endpoint, so the cookie,
hash and workspace rows are exactly what production code creates. The application's
own engine is never used.
"""

import copy
import hashlib
import json
import logging
import re

import pytest
from db_helpers import count
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

import app.db.session as app_session
from app.db.session import get_db
from app.main import app
from app.seed.facilities import seed_facilities
from app.services import workspace_auth

SESSION_URL = "/api/v1/session"
URL = "/api/v1/configurations/current"
TABLES = ("demo_workspaces", "configurations", "configuration_versions")
TOKEN_RE = re.compile(r"gridproof_demo=([A-Za-z0-9_-]{43})")

# Written independently of the application's default (docs 04/05, D-18).
EXPECTED_SNAPSHOT = {
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


def _forbid_application_engine(*args, **kwargs):
    raise AssertionError("the application's own database engine must not be used")


@pytest.fixture
def seeded(committing_engine):
    with Session(committing_engine) as session, session.begin():
        seed_facilities(session)
    return committing_engine


@pytest.fixture
def client(seeded, monkeypatch):
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


def counts(engine) -> tuple[int, ...]:
    with engine.connect() as conn:
        return tuple(count(conn, t) for t in TABLES)


def with_cookie(token: str) -> dict:
    return {"Cookie": f"gridproof_demo={token}"}


def new_session(client) -> tuple[str, str]:
    """(workspace_id, token) from the real session endpoint."""
    client.cookies.clear()
    response = client.get(SESSION_URL)
    assert response.status_code == 200
    token = TOKEN_RE.search(response.headers["set-cookie"]).group(1)
    client.cookies.clear()
    return response.json()["workspace_id"], token


def assert_protected_headers(response):
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["vary"] == "Cookie"
    assert "set-cookie" not in response.headers


def assert_error(response, status, code):
    assert response.status_code == status
    error = response.json()["error"]
    assert error["code"] == code
    assert error["request_id"] == response.headers["x-request-id"]
    assert_protected_headers(response)


# ---------- success ----------


def test_returns_the_default_configuration_exactly(client, seeded):
    workspace_id, token = new_session(client)
    response = client.get(URL, headers=with_cookie(token))

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "configuration_id",
        "name",
        "latest_version",
        "version_id",
        "schema_version",
        "snapshot",
        "saved_at",
    }
    assert body["name"] == "Fridley Test Configuration"
    assert body["latest_version"] == 1
    assert body["schema_version"] == "config-v1"
    assert body["snapshot"] == EXPECTED_SNAPSHOT
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", body["saved_at"])
    assert_protected_headers(response)
    assert response.headers["x-request-id"].startswith("req_")
    with seeded.connect() as conn:
        row = conn.execute(
            text(
                "SELECT c.id::text, v.id::text, "
                "to_char(v.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                "FROM configurations c JOIN configuration_versions v "
                "ON v.configuration_id = c.id WHERE c.workspace_id = :w"
            ),
            {"w": workspace_id},
        ).one()
    assert (body["configuration_id"], body["version_id"], body["saved_at"]) == tuple(
        row
    )


def test_integers_and_booleans_keep_their_json_types(client):
    _, token = new_session(client)
    snapshot = client.get(URL, headers=with_cookie(token)).json()["snapshot"]
    g1 = snapshot["equipment"]["g1"]
    assert type(g1["startup_delay_s"]) is int and type(g1["enabled"]) is bool


def test_the_cookie_jar_works_after_session_bootstrap(client):
    assert client.get(SESSION_URL).status_code == 200
    assert client.get(URL).status_code == 200


# ---------- authentication ----------


def test_missing_cookie_is_session_required_and_creates_nothing(client, seeded):
    response = client.get(URL)
    assert_error(response, 401, "SESSION_REQUIRED")
    assert counts(seeded) == (0, 0, 0)


@pytest.mark.parametrize(
    "cookie",
    [
        "gridproof_demo=",
        "gridproof_demo=short",
        "gridproof_demo=" + "A" * 400,
        "gridproof_demo=" + "A" * 42 + "!",
        "other=1",
    ],
)
def test_malformed_cookie_is_session_required(client, seeded, cookie):
    assert_error(client.get(URL, headers={"Cookie": cookie}), 401, "SESSION_REQUIRED")
    assert counts(seeded) == (0, 0, 0)


def test_non_ascii_cookie_is_session_required(client):
    raw = ("gridproof_demo=" + "A" * 42 + "é").encode("utf-8")
    assert_error(client.get(URL, headers={"Cookie": raw}), 401, "SESSION_REQUIRED")


def test_unknown_token_is_session_required(client, seeded):
    new_session(client)
    assert_error(
        client.get(URL, headers=with_cookie("Z" * 43)), 401, "SESSION_REQUIRED"
    )
    assert counts(seeded) == (1, 1, 1)


def test_duplicate_cookie_is_session_required_even_if_one_is_valid(client):
    _, token = new_session(client)
    response = client.get(
        URL, headers={"Cookie": f"gridproof_demo={token}; gridproof_demo={token}"}
    )
    assert_error(response, 401, "SESSION_REQUIRED")


def test_expired_workspace_is_workspace_expired_and_not_renewed(client, seeded):
    _, token = new_session(client)
    with seeded.begin() as conn:
        conn.execute(
            text(
                "UPDATE demo_workspaces SET created_at = now() - interval '8 days', "
                "expires_at = now() - interval '1 second'"
            )
        )
        before = conn.execute(text("SELECT id, expires_at FROM demo_workspaces")).all()
    response = client.get(URL, headers=with_cookie(token))

    assert_error(response, 401, "WORKSPACE_EXPIRED")
    assert counts(seeded) == (1, 1, 1)
    with seeded.connect() as conn:
        assert (
            conn.execute(text("SELECT id, expires_at FROM demo_workspaces")).all()
            == before
        )


def test_workspace_expiring_in_the_future_is_still_active(client, seeded):
    _, token = new_session(client)
    with seeded.begin() as conn:
        conn.execute(
            text(
                "UPDATE demo_workspaces SET created_at = now() - interval '7 days', "
                "expires_at = now() + interval '5 seconds'"
            )
        )
    assert client.get(URL, headers=with_cookie(token)).status_code == 200


def test_requests_never_change_any_row(client, seeded):
    _, token = new_session(client)
    snapshot_sql = (
        "SELECT (SELECT json_agg(w) FROM demo_workspaces w)::text, "
        "(SELECT json_agg(c) FROM configurations c)::text, "
        "(SELECT json_agg(v) FROM configuration_versions v)::text"
    )
    with seeded.connect() as conn:
        before = conn.execute(text(snapshot_sql)).one()
    for headers in ({}, with_cookie("Z" * 43), with_cookie(token)):
        client.get(URL, headers=headers)
    with seeded.connect() as conn:
        assert conn.execute(text(snapshot_sql)).one() == before


# ---------- workspace isolation ----------


def test_each_workspace_sees_only_its_own_configuration(client, seeded):
    ws_a, token_a = new_session(client)
    ws_b, token_b = new_session(client)
    a = client.get(URL, headers=with_cookie(token_a)).json()
    b = client.get(URL, headers=with_cookie(token_b)).json()

    assert a["configuration_id"] != b["configuration_id"]
    assert a["version_id"] != b["version_id"]
    with seeded.connect() as conn:
        owner = dict(
            conn.execute(
                text("SELECT id::text, workspace_id::text FROM configurations")
            ).all()
        )
    assert owner[a["configuration_id"]] == ws_a
    assert owner[b["configuration_id"]] == ws_b


def test_an_edit_in_one_workspace_is_invisible_to_the_other(client, seeded):
    _, token_a = new_session(client)
    _, token_b = new_session(client)
    a = client.get(URL, headers=with_cookie(token_a)).json()
    edited = copy.deepcopy(EXPECTED_SNAPSHOT)
    edited["equipment"]["g1"]["startup_delay_s"] = 15
    with seeded.begin() as conn:
        conn.execute(
            text(
                "UPDATE configuration_versions SET snapshot_json = CAST(:s AS jsonb) WHERE id = :v"
            ),
            {"s": json.dumps(edited), "v": a["version_id"]},
        )
    assert client.get(URL, headers=with_cookie(token_a)).json()["snapshot"] == edited
    assert (
        client.get(URL, headers=with_cookie(token_b)).json()["snapshot"]
        == EXPECTED_SNAPSHOT
    )


def test_workspace_identifiers_in_the_request_are_ignored(client):
    _, token_a = new_session(client)
    ws_b, _ = new_session(client)
    a = client.get(URL, headers=with_cookie(token_a)).json()
    response = client.get(
        f"{URL}?workspace_id={ws_b}",
        headers={**with_cookie(token_a), "X-Workspace-Id": ws_b},
    )
    assert response.json() == a


# ---------- latest-version pointer ----------


def _add_version_two(
    seeded, configuration_id: str, delay: int = 15, point: bool = True
):
    snapshot = copy.deepcopy(EXPECTED_SNAPSHOT)
    snapshot["equipment"]["g1"]["startup_delay_s"] = delay
    with seeded.begin() as conn:
        version_id = conn.execute(
            text(
                "INSERT INTO configuration_versions "
                "(id, configuration_id, version_number, schema_version, snapshot_json) "
                "VALUES (gen_random_uuid(), :c, 2, 'config-v1', CAST(:s AS jsonb)) RETURNING id::text"
            ),
            {"c": configuration_id, "s": json.dumps(snapshot)},
        ).scalar_one()
        if point:
            conn.execute(
                text("UPDATE configurations SET latest_version = 2 WHERE id = :c"),
                {"c": configuration_id},
            )
    return version_id, snapshot


def test_returns_the_version_named_by_the_pointer(client, seeded):
    _, token = new_session(client)
    first = client.get(URL, headers=with_cookie(token)).json()
    version_id, snapshot = _add_version_two(seeded, first["configuration_id"])

    body = client.get(URL, headers=with_cookie(token)).json()
    assert body["latest_version"] == 2
    assert body["version_id"] == version_id != first["version_id"]
    assert body["snapshot"] == snapshot


def test_a_newer_row_the_pointer_does_not_name_is_ignored(client, seeded):
    _, token = new_session(client)
    first = client.get(URL, headers=with_cookie(token)).json()
    _add_version_two(seeded, first["configuration_id"], point=False)

    body = client.get(URL, headers=with_cookie(token)).json()
    assert body["latest_version"] == 1 and body["version_id"] == first["version_id"]


# ---------- stored-data problems ----------


def _stored_error(client, seeded, token, caplog, sql, params=None, reason=""):
    with seeded.begin() as conn:
        conn.execute(text(sql), params or {})
    with caplog.at_level(logging.DEBUG):
        response = client.get(URL, headers=with_cookie(token))
    assert_error(response, 500, "INTERNAL_ERROR")
    assert reason in caplog.text
    return response


def test_pointer_zero_is_a_500_and_nothing_is_repaired(client, seeded, caplog):
    _, token = new_session(client)
    # ck_configurations_latest_version allows 0, so this state is reachable.
    response = _stored_error(
        client,
        seeded,
        token,
        caplog,
        "UPDATE configurations SET latest_version = 0",
        reason="pointer_not_set",
    )
    assert "Fridley" not in response.text
    with seeded.connect() as conn:
        assert (
            conn.execute(text("SELECT latest_version FROM configurations")).scalar_one()
            == 0
        )
        assert count(conn, "configuration_versions") == 1


def test_pointer_to_a_missing_version_is_a_500(client, seeded, caplog):
    _, token = new_session(client)
    _stored_error(
        client,
        seeded,
        token,
        caplog,
        "UPDATE configurations SET latest_version = 7",
        reason="pointer_version_missing",
    )
    with seeded.connect() as conn:
        assert (
            conn.execute(text("SELECT latest_version FROM configurations")).scalar_one()
            == 7
        )


def test_unsupported_schema_version_is_a_500(client, seeded, caplog):
    _, token = new_session(client)
    response = _stored_error(
        client,
        seeded,
        token,
        caplog,
        "UPDATE configuration_versions SET schema_version = 'config-v9'",
        reason="unsupported_schema_version",
    )
    assert "config-v9" not in response.text


@pytest.mark.parametrize(
    "mutate",
    [
        lambda s: s["equipment"]["g1"].update(startup_delay_s=121),
        lambda s: s["equipment"]["g1"].update(startup_delay_s=5.5),
        lambda s: s.update(extra="x"),
        lambda s: s["equipment"].pop("battery"),
        lambda s: s.update(facility_id="seymour"),
    ],
)
def test_invalid_saved_snapshot_is_a_500_and_not_echoed(client, seeded, caplog, mutate):
    _, token = new_session(client)
    snapshot = copy.deepcopy(EXPECTED_SNAPSHOT)
    mutate(snapshot)
    response = _stored_error(
        client,
        seeded,
        token,
        caplog,
        "UPDATE configuration_versions SET snapshot_json = CAST(:s AS jsonb)",
        {"s": json.dumps(snapshot)},
        reason="invalid_snapshot",
    )
    assert "121" not in response.text and "seymour" not in response.text


def test_snapshot_that_is_not_an_object_is_a_500(client, seeded, caplog):
    _, token = new_session(client)
    _stored_error(
        client,
        seeded,
        token,
        caplog,
        "UPDATE configuration_versions SET snapshot_json = '[1,2]'::jsonb",
        reason="invalid_snapshot",
    )


def test_valid_workspace_without_a_configuration_is_404(client, seeded):
    _, token = new_session(client)
    with seeded.begin() as conn:
        conn.execute(text("DELETE FROM configuration_versions"))
        conn.execute(text("DELETE FROM configurations"))
    assert_error(
        client.get(URL, headers=with_cookie(token)), 404, "CONFIGURATION_NOT_FOUND"
    )
    assert counts(seeded) == (1, 0, 0)  # no implicit reset


def test_non_default_facility_configuration_is_still_the_workspaces_current(
    client, seeded
):
    # Retrieval is scoped by workspace only (no facility condition).
    _, token = new_session(client)
    with seeded.begin() as conn:
        conn.execute(text("UPDATE configurations SET facility_id = 'seymour'"))
    assert client.get(URL, headers=with_cookie(token)).status_code == 200


# ---------- dependency failure and secrecy ----------


def test_database_failure_is_a_sanitized_503(client, monkeypatch, caplog):
    _, token = new_session(client)

    def boom(*args, **kwargs):
        raise OperationalError(
            "SELECT secret", {}, Exception("host=db.internal password=hunter2")
        )

    monkeypatch.setattr(workspace_auth, "require_workspace_id", boom)
    with caplog.at_level(logging.DEBUG):
        response = client.get(URL, headers=with_cookie(token))

    assert_error(response, 503, "DATABASE_UNAVAILABLE")
    for leaked in ("hunter2", "db.internal", "SELECT", token):
        assert leaked not in response.text and leaked not in caplog.text


def test_unexpected_error_is_a_sanitized_500(client, monkeypatch, caplog):
    _, token = new_session(client)

    def boom(*args, **kwargs):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(workspace_auth, "require_workspace_id", boom)
    with caplog.at_level(logging.DEBUG):
        response = client.get(URL, headers=with_cookie(token))
    assert_error(response, 500, "INTERNAL_ERROR")
    assert "secret internal detail" not in response.text + caplog.text


def test_logs_never_contain_tokens_hashes_or_cookie_headers(client, seeded, caplog):
    with caplog.at_level(logging.DEBUG):
        _, token = new_session(client)
        client.get(URL, headers=with_cookie(token))
        client.get(URL, headers=with_cookie("Y" * 43))
        with seeded.begin() as conn:
            conn.execute(text("UPDATE configurations SET latest_version = 0"))
        client.get(URL, headers=with_cookie(token))
        with seeded.begin() as conn:
            conn.execute(
                text(
                    "UPDATE demo_workspaces SET created_at = now() - interval '9 days', expires_at = now() - interval '1 day'"
                )
            )
        client.get(URL, headers=with_cookie(token))
    for secret in (
        token,
        "Y" * 43,
        hashlib.sha256(token.encode()).hexdigest(),
        "gridproof_demo=",
    ):
        assert secret not in caplog.text


def test_response_never_contains_the_token_or_its_hash(client):
    _, token = new_session(client)
    response = client.get(URL, headers=with_cookie(token))
    assert token not in response.text
    assert hashlib.sha256(token.encode()).hexdigest() not in response.text
    assert all(token not in v for v in response.headers.values())
