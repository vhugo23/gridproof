"""GET /api/v1/session against the isolated PostgreSQL test database.

Real commits, a fresh session per request (like production) and separate verifying
connections. The application's own engine is never used. Failures are injected with
temporary database triggers, so the service has no test-only hooks.
"""

import hashlib
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from db_helpers import count
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

import app.db.session as app_session
from app.db.session import get_db
from app.main import app
from app.seed.facilities import seed_facilities
from app.services import sessions

URL = "/api/v1/session"
TABLES = ("demo_workspaces", "configurations", "configuration_versions")
TOKEN_RE = re.compile(r"gridproof_demo=([A-Za-z0-9_-]{43})")


def _forbid_application_engine(*args, **kwargs):
    raise AssertionError("the application's own database engine must not be used")


@pytest.fixture
def seeded(committing_engine):
    with Session(committing_engine) as session, session.begin():
        seed_facilities(session)
    return committing_engine


@pytest.fixture
def make_client(seeded, monkeypatch):
    factory = sessionmaker(bind=seeded, autoflush=False, expire_on_commit=False)

    def override():
        with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override
    monkeypatch.setattr(app_session, "SessionLocal", _forbid_application_engine)
    monkeypatch.setattr(app_session.engine, "connect", _forbid_application_engine)

    def build(**kwargs) -> TestClient:
        kwargs.setdefault("base_url", "https://testserver")
        return TestClient(app, **kwargs)

    try:
        yield build
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def client(make_client):
    return make_client()


def counts(engine) -> tuple[int, int, int]:
    with engine.connect() as conn:
        return tuple(count(conn, t) for t in TABLES)


def cookie_of(response) -> str:
    match = TOKEN_RE.search(response.headers["set-cookie"])
    assert match
    return match.group(1)


def with_cookie(token: str) -> dict:
    return {"Cookie": f"gridproof_demo={token}"}


def issue(client) -> tuple[dict, str]:
    client.cookies.clear()
    response = client.get(URL)
    assert response.status_code == 200
    token = cookie_of(response)
    client.cookies.clear()
    return response.json(), token


# ---------- first visit ----------


def test_first_visit_creates_workspace_configuration_and_version(client, seeded):
    response = client.get(URL)

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"workspace_id", "expires_at", "is_new"}
    assert body["is_new"] is True
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", body["expires_at"])
    assert counts(seeded) == (1, 1, 1)
    with seeded.connect() as conn:
        row = conn.execute(
            text(
                "SELECT w.id::text, "
                "to_char(w.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
                "c.latest_version, w.expires_at - w.created_at "
                "FROM demo_workspaces w JOIN configurations c ON c.workspace_id = w.id"
            )
        ).one()
    assert row[0] == body["workspace_id"]
    assert row[1] == body["expires_at"]
    assert row[2] == 1
    assert row[3].days == 7 and row[3].seconds == 0


def test_cookie_attributes_are_exact(client):
    response = client.get(URL)
    header = response.headers["set-cookie"]
    parts = [p.strip() for p in header.split(";")]
    assert parts[0].startswith("gridproof_demo=")
    attrs = {
        p.split("=")[0].lower(): (p.split("=", 1)[1] if "=" in p else True)
        for p in parts[1:]
    }
    assert attrs["httponly"] is True
    assert attrs["secure"] is True
    assert attrs["samesite"].lower() == "lax"
    assert attrs["path"] == "/"
    assert "domain" not in attrs
    assert abs(int(attrs["max-age"]) - 7 * 86400) < 60
    assert len(response.headers.get_list("set-cookie")) == 1


def test_token_is_only_in_the_cookie_and_stored_only_as_a_hash(client, seeded):
    response = client.get(URL)
    token = cookie_of(response)
    assert len(token) == 43
    assert token not in response.text
    assert all(
        token not in value
        for key, value in response.headers.items()
        if key != "set-cookie"
    )
    with seeded.connect() as conn:
        stored = conn.execute(
            text("SELECT token_hash FROM demo_workspaces")
        ).scalar_one()
        dump = conn.execute(
            text(
                "SELECT w::text || c::text || v::text FROM demo_workspaces w, "
                "configurations c, configuration_versions v"
            )
        ).scalar_one()
    assert stored == hashlib.sha256(token.encode()).hexdigest()
    assert token not in dump


def test_headers_on_success(client):
    response = client.get(URL)
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["vary"] == "Cookie"
    assert response.headers["x-request-id"].startswith("req_")


# ---------- reuse ----------


def test_valid_cookie_is_reused_without_new_rows_or_new_cookie(client, seeded):
    first, token = issue(client)
    second = client.get(URL, headers=with_cookie(token))

    assert second.status_code == 200
    assert second.json() == {**first, "is_new": False}
    assert "set-cookie" not in second.headers
    assert second.headers["cache-control"] == "no-store"
    assert second.headers["vary"] == "Cookie"
    assert counts(seeded) == (1, 1, 1)


def test_reuse_does_not_renew_the_fixed_expiry(client, seeded):
    first, token = issue(client)
    with seeded.begin() as conn:
        conn.execute(
            text(
                "UPDATE demo_workspaces SET created_at = created_at - interval '3 days', "
                "expires_at = expires_at - interval '3 days'"
            )
        )
        before = conn.execute(
            text("SELECT expires_at FROM demo_workspaces")
        ).scalar_one()
    second = client.get(URL, headers=with_cookie(token))
    with seeded.connect() as conn:
        after = conn.execute(
            text("SELECT expires_at FROM demo_workspaces")
        ).scalar_one()
    assert after == before
    assert second.json()["is_new"] is False
    assert (
        second.json()["expires_at"] != first["expires_at"]
    )  # reports the unrenewed expiry


def test_the_cookie_jar_round_trip_works_over_https(client):
    first = client.get(URL).json()
    second = client.get(URL).json()
    assert first["is_new"] is True and second["is_new"] is False
    assert first["workspace_id"] == second["workspace_id"]


# ---------- replacement ----------


def test_expired_cookie_gets_a_new_workspace_and_old_rows_remain(client, seeded):
    first, token = issue(client)
    with seeded.begin() as conn:
        conn.execute(
            text(
                "UPDATE demo_workspaces SET created_at = now() - interval '8 days', "
                "expires_at = now() - interval '1 day'"
            )
        )
    second = client.get(URL, headers=with_cookie(token))

    assert second.status_code == 200
    assert second.json()["is_new"] is True
    assert second.json()["workspace_id"] != first["workspace_id"]
    assert cookie_of(second) != token
    assert counts(seeded) == (2, 2, 2)


def test_unknown_token_gets_a_new_workspace(client, seeded):
    response = client.get(URL, headers=with_cookie("Z" * 43))
    assert response.json()["is_new"] is True
    assert counts(seeded) == (1, 1, 1)


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
def test_malformed_or_missing_cookie_gets_a_new_workspace(client, seeded, cookie):
    response = client.get(URL, headers={"Cookie": cookie})
    assert response.status_code == 200
    assert response.json()["is_new"] is True
    assert counts(seeded) == (1, 1, 1)


def test_non_ascii_cookie_does_not_crash(client):
    raw = ("gridproof_demo=" + "A" * 42 + "é").encode("utf-8")
    response = client.get(URL, headers={"Cookie": raw})
    assert response.status_code == 200
    assert response.json()["is_new"] is True


def test_duplicate_cookie_is_invalid_even_if_one_value_is_valid(client, seeded):
    first, token = issue(client)
    response = client.get(
        URL, headers={"Cookie": f"gridproof_demo={token}; gridproof_demo={'Q' * 43}"}
    )
    assert response.json()["is_new"] is True
    assert response.json()["workspace_id"] != first["workspace_id"]
    assert counts(seeded) == (2, 2, 2)


def test_two_workspaces_are_independent(client):
    a, token_a = issue(client)
    b, token_b = issue(client)
    assert a["workspace_id"] != b["workspace_id"] and token_a != token_b
    got_a = client.get(URL, headers=with_cookie(token_a)).json()
    got_b = client.get(URL, headers=with_cookie(token_b)).json()
    assert got_a["workspace_id"] == a["workspace_id"]
    assert got_b["workspace_id"] == b["workspace_id"]


# ---------- proxy headers ----------


def test_forwarded_headers_do_not_change_the_cookie(make_client):
    client = make_client(base_url="http://internal-render-host")
    response = client.get(
        URL,
        headers={
            "X-Forwarded-Proto": "http",
            "X-Forwarded-Host": "evil.example",
            "X-Forwarded-For": "203.0.113.9",
        },
    )
    header = response.headers["set-cookie"].lower()
    assert "secure" in header and "httponly" in header and "samesite=lax" in header
    assert "domain" not in header and "evil.example" not in header


def test_cookie_forwarded_by_a_proxy_is_accepted(client):
    first, token = issue(client)
    response = client.get(
        URL, headers={**with_cookie(token), "X-Forwarded-For": "198.51.100.4"}
    )
    assert response.json()["workspace_id"] == first["workspace_id"]
    assert response.json()["is_new"] is False


# ---------- failures: rollback, commit, catalog ----------


@pytest.fixture
def trigger(seeded):
    created: list[tuple[str, str]] = []

    def install(table: str, deferred: bool = False) -> str:
        name = f"test_fail_{table}_{'d' if deferred else 'i'}"
        with seeded.begin() as conn:
            conn.execute(
                text(
                    "CREATE OR REPLACE FUNCTION test_injected_failure() RETURNS trigger "
                    "LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$"
                )
            )
            if deferred:
                conn.execute(
                    text(
                        f"CREATE CONSTRAINT TRIGGER {name} AFTER INSERT ON {table} "
                        "DEFERRABLE INITIALLY DEFERRED FOR EACH ROW "
                        "EXECUTE FUNCTION test_injected_failure()"
                    )
                )
            else:
                conn.execute(
                    text(
                        f"CREATE TRIGGER {name} BEFORE INSERT ON {table} "
                        "FOR EACH ROW EXECUTE FUNCTION test_injected_failure()"
                    )
                )
        created.append((name, table))
        return name

    def remove(name: str) -> None:
        table = dict(created)[name]
        with seeded.begin() as conn:
            conn.execute(text(f"DROP TRIGGER IF EXISTS {name} ON {table}"))

    install.remove = remove
    yield install
    with seeded.begin() as conn:
        for name, table in created:
            conn.execute(text(f"DROP TRIGGER IF EXISTS {name} ON {table}"))
        conn.execute(text("DROP FUNCTION IF EXISTS test_injected_failure()"))


@pytest.mark.parametrize(
    "table", ["demo_workspaces", "configurations", "configuration_versions"]
)
def test_failure_at_each_stage_leaves_no_rows_and_no_cookie(
    client, seeded, trigger, table
):
    trigger(table)
    response = client.get(URL)

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DATABASE_UNAVAILABLE"
    assert "set-cookie" not in response.headers
    assert counts(seeded) == (0, 0, 0)
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["vary"] == "Cookie"
    assert "injected" not in response.text


def test_commit_failure_sets_no_cookie_and_leaves_no_rows(client, seeded, trigger):
    trigger("demo_workspaces", deferred=True)
    response = client.get(URL)

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DATABASE_UNAVAILABLE"
    assert "set-cookie" not in response.headers
    assert counts(seeded) == (0, 0, 0)


def test_service_recovers_after_a_failure(client, seeded, trigger):
    name = trigger("configurations")
    assert client.get(URL).status_code == 503
    trigger.remove(name)
    assert client.get(URL).status_code == 200
    assert counts(seeded) == (1, 1, 1)


def test_unseeded_catalog_is_a_sanitized_503(client, seeded, caplog):
    with seeded.begin() as conn:
        conn.execute(text("DELETE FROM facility_catalog"))
    with caplog.at_level(logging.DEBUG):
        response = client.get(URL)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DATABASE_UNAVAILABLE"
    assert (
        "fridley" not in response.text.lower() and "seed" not in response.text.lower()
    )
    assert "set-cookie" not in response.headers
    assert "reason=catalog_not_seeded" in caplog.text
    assert counts(seeded) == (0, 0, 0)


# ---------- rate limit ----------


@pytest.fixture
def limit(monkeypatch):
    def set_limit(n: int) -> None:
        monkeypatch.setattr(sessions, "ISSUANCE_LIMIT", n)

    return set_limit


def test_cap_blocks_new_sessions_with_429(client, seeded, limit):
    limit(2)
    issue(client)
    issue(client)
    response = client.get(URL)

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "SESSION_RATE_LIMITED"
    assert response.headers["retry-after"] == "60"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["vary"] == "Cookie"
    assert "set-cookie" not in response.headers
    assert counts(seeded) == (2, 2, 2)


def test_cap_never_blocks_reuse(client, limit):
    first, token = issue(client)
    limit(1)
    assert client.get(URL).status_code == 429
    response = client.get(URL, headers=with_cookie(token))
    assert response.status_code == 200
    assert response.json()["workspace_id"] == first["workspace_id"]


def test_rolling_window_counts_only_the_last_sixty_seconds(client, seeded, limit):
    limit(2)
    issue(client)
    issue(client)
    assert client.get(URL).status_code == 429
    with seeded.begin() as conn:  # age the oldest workspace past the window
        conn.execute(
            text(
                "UPDATE demo_workspaces SET created_at = now() - interval '61 seconds', "
                "expires_at = now() + interval '7 days' WHERE id = "
                "(SELECT id FROM demo_workspaces ORDER BY created_at LIMIT 1)"
            )
        )
    assert client.get(URL).status_code == 200
    client.cookies.clear()
    assert client.get(URL).status_code == 429


def test_workspace_created_55_seconds_ago_still_counts(client, seeded, limit):
    limit(1)
    issue(client)
    with seeded.begin() as conn:
        conn.execute(
            text(
                "UPDATE demo_workspaces SET created_at = now() - interval '55 seconds'"
            )
        )
    assert client.get(URL).status_code == 429


def test_window_uses_creation_time_not_expiry(client, seeded, limit):
    limit(1)
    issue(client)
    with seeded.begin() as conn:
        conn.execute(
            text(
                "UPDATE demo_workspaces SET created_at = now() - interval '2 days', "
                "expires_at = now() - interval '1 second'"
            )
        )
    assert client.get(URL).status_code == 200


def test_failed_attempts_do_not_consume_the_cap(client, seeded, limit, trigger):
    limit(1)
    name = trigger("configurations")
    for _ in range(3):
        assert client.get(URL).status_code == 503
    trigger.remove(name)
    assert client.get(URL).status_code == 200


# ---------- concurrency and locking ----------


def test_concurrent_issuance_creates_exactly_the_allowed_number(
    make_client, seeded, limit
):
    limit(3)
    total = 10
    barrier = threading.Barrier(total)

    def call(_):
        client = make_client()
        barrier.wait()
        return client.get(URL).status_code

    with ThreadPoolExecutor(max_workers=total) as pool:
        statuses = list(pool.map(call, range(total)))

    assert sorted(statuses) == [200] * 3 + [429] * 7
    assert counts(seeded) == (3, 3, 3)


def test_concurrent_requests_with_one_valid_cookie_create_nothing(make_client, seeded):
    _, token = issue(make_client())
    total = 8
    barrier = threading.Barrier(total)

    def call(_):
        client = make_client()
        barrier.wait()
        return client.get(URL, headers=with_cookie(token)).json()

    with ThreadPoolExecutor(max_workers=total) as pool:
        bodies = list(pool.map(call, range(total)))

    assert {b["workspace_id"] for b in bodies} == {bodies[0]["workspace_id"]}
    assert all(b["is_new"] is False for b in bodies)
    assert counts(seeded) == (1, 1, 1)


def _hold_issuance_lock(engine):
    holder = engine.connect()
    tx = holder.begin()
    holder.execute(
        text("SELECT pg_advisory_xact_lock(:k)"), {"k": sessions.ISSUANCE_LOCK_KEY}
    )
    return holder, tx


def test_reuse_is_not_blocked_while_the_issuance_lock_is_held(make_client, seeded):
    _, token = issue(make_client())
    holder, tx = _hold_issuance_lock(seeded)
    try:
        started = time.monotonic()
        response = make_client().get(URL, headers=with_cookie(token))
        elapsed = time.monotonic() - started
    finally:
        tx.rollback()
        holder.close()
    assert response.status_code == 200 and response.json()["is_new"] is False
    assert elapsed < 1.5


def test_lock_timeout_is_a_bounded_503_with_retry_after(
    make_client, seeded, monkeypatch, caplog
):
    monkeypatch.setattr(sessions, "LOCK_TIMEOUT_MS", 300)
    holder, tx = _hold_issuance_lock(seeded)
    try:
        started = time.monotonic()
        with caplog.at_level(logging.DEBUG):
            response = make_client().get(URL)
        elapsed = time.monotonic() - started
    finally:
        tx.rollback()
        holder.close()

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DATABASE_UNAVAILABLE"
    assert response.headers["retry-after"] == "5"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["vary"] == "Cookie"
    assert "set-cookie" not in response.headers
    assert 0.25 < elapsed < 3
    assert "reason=lock_timeout" in caplog.text
    assert counts(seeded) == (0, 0, 0)
    assert make_client().get(URL).status_code == 200  # lock released: service recovers


def test_lock_is_released_after_issuance_and_after_rollback(make_client, seeded, limit):
    limit(1)
    client = make_client()
    assert client.get(URL).status_code == 200  # commit path
    client.cookies.clear()
    assert client.get(URL).status_code == 429  # rollback path
    with seeded.connect() as conn:
        got = conn.execute(
            text("SELECT pg_try_advisory_lock(:k)"), {"k": sessions.ISSUANCE_LOCK_KEY}
        ).scalar_one()
        conn.execute(text("SELECT pg_advisory_unlock_all()"))
    assert got is True


def test_timeouts_do_not_leak_into_the_connection(seeded):
    factory = sessionmaker(bind=seeded)
    with factory() as session:
        sessions.resolve_session(session, None)
        assert session.execute(text("SHOW lock_timeout")).scalar_one() != "2s"
        assert session.execute(text("SHOW statement_timeout")).scalar_one() != "5s"


# ---------- secrecy ----------


def test_logs_never_contain_tokens_hashes_or_cookie_headers(
    make_client, trigger, caplog
):
    client = make_client()
    with caplog.at_level(logging.DEBUG):
        _, token = issue(client)
        client.get(URL, headers=with_cookie(token))
        client.get(URL, headers=with_cookie("Y" * 43))
        trigger("configurations")
        client.get(URL, headers=with_cookie("X" * 43))
    secrets_ = (
        token,
        "Y" * 43,
        "X" * 43,
        hashlib.sha256(token.encode()).hexdigest(),
        "gridproof_demo=",
    )
    for secret in secrets_:
        assert secret not in caplog.text
