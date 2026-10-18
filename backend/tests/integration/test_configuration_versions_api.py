"""POST /api/v1/configurations/{id}/versions against the isolated PostgreSQL database.

Sessions come from the real GET /api/v1/session. Failures are injected with temporary
database triggers; the application's own engine is never used.
"""

import copy
import hashlib
import json
import logging
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from db_helpers import count
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

import app.db.session as app_session
from app.db.session import get_db
from app.domain.system_config import default_system_config
from app.main import app
from app.routes import configurations as routes
from app.seed.facilities import seed_facilities
from app.services import configurations as service
from app.services.sessions import resolve_session

SESSION_URL = "/api/v1/session"
CURRENT_URL = "/api/v1/configurations/current"
TABLES = ("demo_workspaces", "configurations", "configuration_versions")
TOKEN_RE = re.compile(r"gridproof_demo=([A-Za-z0-9_-]{43})")
ORIGIN = "https://app.example.com"
DEFAULT_NAME = "Fridley Test Configuration"

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


def snapshot(delay: int = 15) -> dict:
    data = copy.deepcopy(BASE_SNAPSHOT)
    data["equipment"]["g1"]["startup_delay_s"] = delay
    return data


def body(expected: int = 1, delay: int = 15, name: str = DEFAULT_NAME) -> dict:
    return {"expected_version": expected, "name": name, "snapshot": snapshot(delay)}


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
            routes, "get_settings", lambda: SimpleNamespace(frontend_origins=value)
        )

    configure("")
    return configure


@pytest.fixture
def make_client(seeded, monkeypatch, origins):
    factory = sessionmaker(bind=seeded, autoflush=False, expire_on_commit=False)

    def override():
        with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override
    monkeypatch.setattr(app_session, "SessionLocal", _forbid_application_engine)
    monkeypatch.setattr(app_session.engine, "connect", _forbid_application_engine)

    def build() -> TestClient:
        return TestClient(app, base_url="https://testserver")

    try:
        yield build
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def client(make_client):
    return make_client()


def counts(engine) -> tuple[int, ...]:
    with engine.connect() as conn:
        return tuple(count(conn, t) for t in TABLES)


def with_cookie(token: str) -> dict:
    return {"Cookie": f"gridproof_demo={token}"}


class Workspace:
    def __init__(self, client, token, configuration_id, version_id):
        self.client = client
        self.token = token
        self.configuration_id = configuration_id
        self.version_id = version_id

    @property
    def url(self) -> str:
        return f"/api/v1/configurations/{self.configuration_id}/versions"

    def post(self, payload=None, headers=None, url=None, **kwargs):
        merged = with_cookie(self.token)
        merged.update(headers or {})
        if payload is not None and "content" not in kwargs:
            kwargs["json"] = payload
        return self.client.post(url or self.url, headers=merged, **kwargs)

    def current(self) -> dict:
        return self.client.get(CURRENT_URL, headers=with_cookie(self.token)).json()


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


def assert_error(response, status, code):
    assert response.status_code == status, response.text
    error = response.json()["error"]
    assert error["code"] == code
    assert error["request_id"] == response.headers["x-request-id"]
    assert_headers(response)
    return error


# ---------- success ----------


def test_save_creates_version_two_and_moves_the_pointer(client, seeded):
    ws = new_workspace(client)
    response = ws.post(body(1, delay=15, name="Renamed Config"))

    assert response.status_code == 201
    out = response.json()
    assert set(out) == {
        "configuration_id",
        "version_id",
        "version_number",
        "schema_version",
        "saved_at",
    }
    assert out["configuration_id"] == ws.configuration_id
    assert out["version_number"] == 2 and out["schema_version"] == "config-v1"
    assert out["version_id"] != ws.version_id
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", out["saved_at"])
    assert_headers(response)
    assert counts(seeded) == (1, 1, 2)

    current = ws.current()
    assert current["latest_version"] == 2
    assert current["version_id"] == out["version_id"]
    assert current["name"] == "Renamed Config"
    assert current["snapshot"] == snapshot(15)
    assert current["saved_at"] == out["saved_at"]
    assert type(current["snapshot"]["equipment"]["g1"]["startup_delay_s"]) is int


def test_version_row_stores_the_normalized_snapshot_and_server_schema_version(
    client, seeded
):
    ws = new_workspace(client)
    ws.post(body(1, delay=15))
    with seeded.connect() as conn:
        row = conn.execute(
            text(
                "SELECT version_number, schema_version, snapshot_json::text FROM "
                "configuration_versions WHERE configuration_id = :c ORDER BY version_number"
            ),
            {"c": ws.configuration_id},
        ).all()
    assert [r[0] for r in row] == [1, 2]
    assert [r[1] for r in row] == ["config-v1", "config-v1"]
    assert json.loads(row[1][2]) == snapshot(15)


def test_a_chain_of_saves_follows_the_pointer(client):
    ws = new_workspace(client)
    for expected, delay in [(1, 15), (2, 20), (3, 0), (4, 120)]:
        response = ws.post(body(expected, delay=delay))
        assert response.status_code == 201
        assert response.json()["version_number"] == expected + 1
    assert ws.current()["latest_version"] == 5
    assert ws.current()["snapshot"] == snapshot(120)


def test_saving_the_default_content_again_with_a_current_pointer_still_creates_a_version(
    client, seeded
):
    ws = new_workspace(client)
    assert ws.post(body(1, delay=5)).status_code == 201
    assert counts(seeded)[2] == 2


def test_name_is_trimmed(client):
    ws = new_workspace(client)
    ws.post(body(1, name="  Padded Name \t"))
    assert ws.current()["name"] == "Padded Name"


def test_saves_in_two_workspaces_are_independent(client):
    a = new_workspace(client)
    b = new_workspace(client)
    assert a.post(body(1, delay=15)).status_code == 201
    assert b.current()["latest_version"] == 1
    assert b.current()["snapshot"] == snapshot(5)
    assert a.current()["snapshot"] == snapshot(15)


# ---------- ownership ----------


def test_foreign_and_missing_ids_are_the_same_404(client, seeded):
    a = new_workspace(client)
    b = new_workspace(client)
    before = dump_tables(seeded)

    foreign = b.post(body(1), url=a.url)
    missing = b.post(body(1), url=f"/api/v1/configurations/{uuid.uuid4()}/versions")

    for response in (foreign, missing):
        assert_error(response, 404, "CONFIGURATION_NOT_FOUND")
    f, m = foreign.json()["error"], missing.json()["error"]
    assert {k: v for k, v in f.items() if k != "request_id"} == {
        k: v for k, v in m.items() if k != "request_id"
    }
    assert dump_tables(seeded) == before


def test_a_foreign_id_with_a_stale_version_still_gives_404_not_409(client):
    a = new_workspace(client)
    b = new_workspace(client)
    assert_error(b.post(body(99), url=a.url), 404, "CONFIGURATION_NOT_FOUND")


def test_workspace_identifiers_in_the_request_are_rejected_or_ignored(client, seeded):
    a = new_workspace(client)
    b = new_workspace(client)
    payload = body(1)
    payload["workspace_id"] = str(uuid.uuid4())
    assert_error(a.post(payload), 422, "VALIDATION_ERROR")
    response = a.post(
        body(1),
        url=a.url + f"?workspace_id={b.configuration_id}",
        headers={"X-Workspace-Id": "x"},
    )
    assert response.status_code == 201
    assert b.current()["latest_version"] == 1


# ---------- authentication and path ----------


def test_missing_cookie_is_session_required_and_changes_nothing(client, seeded):
    ws = new_workspace(client)
    before = dump_tables(seeded)
    response = client.post(ws.url, json=body(1))
    assert_error(response, 401, "SESSION_REQUIRED")
    assert dump_tables(seeded) == before


def test_malformed_unknown_and_duplicate_cookies_are_session_required(client, seeded):
    ws = new_workspace(client)
    before = dump_tables(seeded)
    for cookie in (
        "gridproof_demo=short",
        "gridproof_demo=" + "Z" * 43,
        f"gridproof_demo={ws.token}; gridproof_demo={ws.token}",
    ):
        assert_error(
            client.post(ws.url, json=body(1), headers={"Cookie": cookie}),
            401,
            "SESSION_REQUIRED",
        )
    assert dump_tables(seeded) == before


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
    assert_error(ws.post(body(1)), 401, "WORKSPACE_EXPIRED")
    assert dump_tables(seeded) == before


@pytest.mark.parametrize(
    "bad", ["not-a-uuid", "123", "00000000-0000-0000-0000-00000000000g", "%20"]
)
def test_invalid_id_is_400(client, seeded, bad):
    ws = new_workspace(client)
    before = dump_tables(seeded)
    assert_error(
        ws.post(body(1), url=f"/api/v1/configurations/{bad}/versions"),
        400,
        "INVALID_ID",
    )
    assert dump_tables(seeded) == before


def test_invalid_id_without_a_session_is_401_first(client):
    assert_error(
        client.post("/api/v1/configurations/nope/versions", json=body(1)),
        401,
        "SESSION_REQUIRED",
    )


# ---------- expected_version ----------


def test_stale_expected_version_is_409_with_current_version(client, seeded):
    ws = new_workspace(client)
    ws.post(body(1, delay=15))
    before = dump_tables(seeded)
    response = ws.post(body(1, delay=20))
    error = assert_error(response, 409, "VERSION_CONFLICT")
    assert error["details"] == [{"field": "current_version", "reason": "2"}]
    assert dump_tables(seeded) == before


def test_expected_version_ahead_of_latest_is_409(client, seeded):
    ws = new_workspace(client)
    before = dump_tables(seeded)
    error = assert_error(ws.post(body(5)), 409, "VERSION_CONFLICT")
    assert error["details"] == [{"field": "current_version", "reason": "1"}]
    assert dump_tables(seeded) == before


def test_expected_version_zero_is_accepted_syntactically_but_conflicts(client, seeded):
    ws = new_workspace(client)
    before = dump_tables(seeded)
    assert_error(ws.post(body(0)), 409, "VERSION_CONFLICT")
    assert dump_tables(seeded) == before


@pytest.mark.parametrize(
    "bad", [-1, True, False, 1.0, 1.5, "1", None, [], {}, 2**31, 10**30]
)
def test_invalid_expected_version_is_422(client, seeded, bad):
    ws = new_workspace(client)
    before = dump_tables(seeded)
    payload = body(1)
    payload["expected_version"] = bad
    error = assert_error(ws.post(payload), 422, "VALIDATION_ERROR")
    assert error["details"][0]["field"] == "expected_version"
    assert dump_tables(seeded) == before


def test_missing_expected_version_is_required(client):
    ws = new_workspace(client)
    payload = body(1)
    del payload["expected_version"]
    error = assert_error(ws.post(payload), 422, "VALIDATION_ERROR")
    assert error["details"] == [{"field": "expected_version", "reason": "Required"}]


# ---------- pointer corruption: never repaired ----------


def test_zero_pointer_is_500_and_expected_zero_does_not_repair_it(
    client, seeded, caplog
):
    ws = new_workspace(client)
    with seeded.begin() as conn:
        conn.execute(text("UPDATE configurations SET latest_version = 0"))
    before = dump_tables(seeded)
    with caplog.at_level(logging.DEBUG):
        for expected in (0, 1):
            assert_error(ws.post(body(expected)), 500, "INTERNAL_ERROR")
    assert "reason=pointer_not_set" in caplog.text
    assert dump_tables(seeded) == before


def test_pointer_to_a_missing_version_is_500(client, seeded):
    ws = new_workspace(client)
    with seeded.begin() as conn:
        conn.execute(text("UPDATE configurations SET latest_version = 4"))
    before = dump_tables(seeded)
    assert_error(ws.post(body(4)), 500, "INTERNAL_ERROR")
    assert dump_tables(seeded) == before


@pytest.mark.parametrize(
    "sql",
    [
        "UPDATE configuration_versions SET schema_version = 'config-v9'",
        'UPDATE configuration_versions SET snapshot_json = \'{"facility_id": "fridley"}\'::jsonb',
        "UPDATE configuration_versions SET snapshot_json = '[]'::jsonb",
    ],
)
def test_corrupt_stored_snapshot_is_500_even_for_a_valid_save_and_a_replay(
    client, seeded, sql
):
    ws = new_workspace(client)
    with seeded.begin() as conn:
        conn.execute(text(sql))
    before = dump_tables(seeded)
    response = ws.post(body(1))
    error = assert_error(response, 500, "INTERNAL_ERROR")
    assert "config-v9" not in response.text and error["details"] == []
    assert dump_tables(seeded) == before


# ---------- request validation ----------


def _bad_bodies():
    def mutate(fn):
        payload = body(1)
        fn(payload)
        return payload

    return {
        "extra_top_level": mutate(lambda p: p.update(schema_version="config-v1")),
        "extra_snapshot": mutate(lambda p: p["snapshot"].update(extra=1)),
        "missing_snapshot": mutate(lambda p: p.pop("snapshot")),
        "snapshot_not_object": mutate(lambda p: p.update(snapshot=[1])),
        "delay_too_high": mutate(
            lambda p: p["snapshot"]["equipment"]["g1"].update(startup_delay_s=121)
        ),
        "delay_negative": mutate(
            lambda p: p["snapshot"]["equipment"]["g1"].update(startup_delay_s=-1)
        ),
        "delay_float": mutate(
            lambda p: p["snapshot"]["equipment"]["g1"].update(startup_delay_s=5.5)
        ),
        "enabled_string": mutate(
            lambda p: p["snapshot"]["equipment"]["g2"].update(enabled="yes")
        ),
        "fixed_rating": mutate(
            lambda p: p["snapshot"]["equipment"]["g1"].update(rated_kw=999)
        ),
        "fixed_min_soc": mutate(
            lambda p: p["snapshot"]["equipment"]["battery"].update(min_soc_pct=10)
        ),
        "soc_below_min": mutate(
            lambda p: p["snapshot"]["equipment"]["battery"].update(initial_soc_pct=10)
        ),
        "load_zero": mutate(
            lambda p: p["snapshot"]["equipment"]["load"].update(critical_kw=0)
        ),
        "switchgear_mode": mutate(
            lambda p: p["snapshot"]["equipment"]["switchgear"].update(mode="manual")
        ),
        "unknown_facility": mutate(
            lambda p: p["snapshot"].update(facility_id="nowhere")
        ),
        "missing_equipment": mutate(
            lambda p: p["snapshot"]["equipment"].pop("battery")
        ),
        "name_missing": mutate(lambda p: p.pop("name")),
        "name_empty": mutate(lambda p: p.update(name="")),
        "name_spaces": mutate(lambda p: p.update(name="   ")),
        "name_tab_only": mutate(lambda p: p.update(name="\t\t")),
        "name_newline": mutate(lambda p: p.update(name="Line\nBreak")),
        "name_control": mutate(lambda p: p.update(name="Bell\x07")),
        "name_101": mutate(lambda p: p.update(name="x" * 101)),
        "name_number": mutate(lambda p: p.update(name=5)),
        "name_null": mutate(lambda p: p.update(name=None)),
    }


@pytest.mark.parametrize("case", sorted(_bad_bodies()))
def test_invalid_requests_are_422_and_change_nothing(client, seeded, case):
    ws = new_workspace(client)
    before = dump_tables(seeded)
    response = ws.post(_bad_bodies()[case])
    error = assert_error(response, 422, "VALIDATION_ERROR")
    assert error["details"] and all(
        set(d) == {"field", "reason"} for d in error["details"]
    )
    assert dump_tables(seeded) == before


def test_boundary_values_are_accepted(client):
    ws = new_workspace(client)
    payload = body(1, delay=120, name="x" * 100)
    payload["snapshot"]["equipment"]["g1"]["startup_delay_s"] = 0
    payload["snapshot"]["equipment"]["g2"]["startup_delay_s"] = 120
    payload["snapshot"]["equipment"]["battery"]["initial_soc_pct"] = 20
    payload["snapshot"]["equipment"]["load"]["critical_kw"] = 500
    assert ws.post(payload).status_code == 201
    payload = body(2, name="A")
    payload["snapshot"]["equipment"]["battery"]["initial_soc_pct"] = 100
    payload["snapshot"]["equipment"]["load"]["critical_kw"] = 1
    assert ws.post(payload).status_code == 201


def test_unicode_name_is_accepted(client):
    ws = new_workspace(client)
    assert (
        ws.post(body(1, name="Pr\u00fcfstand \u2014 Fridley \u26a1")).status_code == 201
    )
    assert ws.current()["name"] == "Pr\u00fcfstand \u2014 Fridley \u26a1"


def test_errors_never_echo_submitted_values(client, caplog):
    ws = new_workspace(client)
    secret_name = "SECRET-NAME-" + "x" * 100
    payload = body(1, name=secret_name)
    payload["snapshot"]["equipment"]["g1"]["startup_delay_s"] = 987654
    with caplog.at_level(logging.DEBUG):
        response = ws.post(payload)
    assert response.status_code == 422
    # Random hex request ids can contain digits, so inspect the text without them.
    for text_ in (response.text, caplog.text):
        cleaned = re.sub(r"req_[0-9a-f]{32}", "", text_)
        assert "SECRET-NAME" not in cleaned and "987654" not in cleaned


def test_facility_mismatch_with_the_configuration_is_422(client, seeded):
    ws = new_workspace(client)
    with seeded.begin() as conn:
        conn.execute(text("UPDATE configurations SET facility_id = 'seymour'"))
    before = dump_tables(seeded)
    error = assert_error(ws.post(body(1)), 422, "VALIDATION_ERROR")
    assert error["details"] == [
        {
            "field": "snapshot.facility_id",
            "reason": "Must match the configuration's facility",
        }
    ]
    assert dump_tables(seeded) == before


# ---------- body and media type ----------


def test_malformed_json_is_422(client, seeded):
    ws = new_workspace(client)
    before = dump_tables(seeded)
    for raw in (
        b"{",
        b"",
        b"not json",
        b"\xff\xfe",
        b'{"a":1}{"b":2}',
        b"[1,2",
        b'{"expected_version": NaN}',
    ):
        response = ws.post(headers={"Content-Type": "application/json"}, content=raw)
        error = assert_error(response, 422, "VALIDATION_ERROR")
        assert error["details"] == [{"field": "(body)", "reason": "Malformed JSON"}]
    assert dump_tables(seeded) == before


def test_duplicate_json_keys_are_rejected(client, seeded):
    ws = new_workspace(client)
    raw = json.dumps(body(1)).replace(
        '"expected_version": 1', '"expected_version": 1, "expected_version": 1'
    )
    response = ws.post(
        headers={"Content-Type": "application/json"}, content=raw.encode()
    )
    assert_error(response, 422, "VALIDATION_ERROR")


@pytest.mark.parametrize("raw", [b"[]", b"5", b"null", b'"text"', b"true"])
def test_non_object_json_is_422(client, raw):
    ws = new_workspace(client)
    response = ws.post(headers={"Content-Type": "application/json"}, content=raw)
    error = assert_error(response, 422, "VALIDATION_ERROR")
    assert error["details"][0]["reason"] == "Must be an object"


def test_deeply_nested_json_is_422_not_500(client):
    ws = new_workspace(client)
    raw = b"[" * 50000 + b"]" * 50000
    response = ws.post(headers={"Content-Type": "application/json"}, content=raw)
    assert_error(response, 422, "VALIDATION_ERROR")


@pytest.mark.parametrize(
    "content_type",
    ["text/plain", "application/x-www-form-urlencoded", "application/jsonx", ""],
)
def test_wrong_content_type_is_415(client, seeded, content_type):
    ws = new_workspace(client)
    before = dump_tables(seeded)
    response = ws.post(
        headers={"Content-Type": content_type}, content=json.dumps(body(1)).encode()
    )
    assert_error(response, 415, "UNSUPPORTED_MEDIA_TYPE")
    assert dump_tables(seeded) == before


def test_json_content_type_with_charset_is_accepted(client):
    ws = new_workspace(client)
    response = ws.post(
        headers={"Content-Type": "Application/JSON; charset=utf-8"},
        content=json.dumps(body(1)).encode(),
    )
    assert response.status_code == 201


def _padded(size: int) -> bytes:
    raw = json.dumps(body(1)).encode()
    return raw + b" " * (size - len(raw))


def test_body_at_exactly_the_limit_is_processed(client):
    ws = new_workspace(client)
    raw = _padded(256 * 1024)
    assert len(raw) == 256 * 1024
    response = ws.post(headers={"Content-Type": "application/json"}, content=raw)
    assert response.status_code == 201


def test_body_one_byte_over_the_limit_is_413_and_changes_nothing(client, seeded):
    ws = new_workspace(client)
    before = dump_tables(seeded)
    raw = _padded(256 * 1024 + 1)
    response = ws.post(headers={"Content-Type": "application/json"}, content=raw)
    assert_error(response, 413, "PAYLOAD_TOO_LARGE")
    assert dump_tables(seeded) == before


def test_oversize_is_measured_from_actual_bytes_when_streamed(client, seeded):
    ws = new_workspace(client)
    before = dump_tables(seeded)

    def chunks():
        for _ in range(300):  # 300 KiB, sent chunked with no Content-Length
            yield b" " * 1024

    response = ws.post(headers={"Content-Type": "application/json"}, content=chunks())
    assert_error(response, 413, "PAYLOAD_TOO_LARGE")
    assert dump_tables(seeded) == before


def test_understated_content_length_cannot_bypass_the_limit(client, seeded):
    ws = new_workspace(client)
    before = dump_tables(seeded)
    raw = _padded(256 * 1024 + 10)
    response = ws.post(
        headers={"Content-Type": "application/json", "Content-Length": "100"},
        content=raw,
    )
    assert_error(response, 413, "PAYLOAD_TOO_LARGE")
    assert dump_tables(seeded) == before


# ---------- Origin ----------


def test_no_origin_header_is_accepted(client):
    ws = new_workspace(client)
    assert ws.post(body(1)).status_code == 201


def test_allowed_origin_is_accepted(client, origins):
    origins(f"{ORIGIN}, http://localhost:3000/")
    ws = new_workspace(client)
    assert ws.post(body(1), headers={"Origin": ORIGIN}).status_code == 201
    assert (
        ws.post(body(2), headers={"Origin": "http://localhost:3000"}).status_code == 201
    )
    assert (
        ws.post(
            body(3), headers={"Origin": ORIGIN.upper().replace("HTTPS", "https")}
        ).status_code
        == 201
    )


def test_unlisted_origin_is_403_and_changes_nothing(client, seeded, origins):
    origins(ORIGIN)
    ws = new_workspace(client)
    before = dump_tables(seeded)
    for origin in (
        "https://evil.example",
        "null",
        "https://app.example.com.evil.example",
        "http://app.example.com",
        "",
    ):
        response = ws.post(body(1), headers={"Origin": origin})
        assert_error(response, 403, "FORBIDDEN")
        assert origin not in response.text or origin == ""
    assert dump_tables(seeded) == before


def test_without_configuration_every_browser_origin_is_rejected(client, seeded):
    ws = new_workspace(client)
    before = dump_tables(seeded)
    assert_error(ws.post(body(1), headers={"Origin": ORIGIN}), 403, "FORBIDDEN")
    assert_error(
        ws.post(body(1), headers={"Origin": "http://localhost:3000"}), 403, "FORBIDDEN"
    )
    assert dump_tables(seeded) == before


def test_duplicate_origin_headers_are_rejected(client, origins):
    origins(ORIGIN)
    ws = new_workspace(client)
    response = client.post(
        ws.url,
        json=body(1),
        headers=[
            ("Cookie", f"gridproof_demo={ws.token}"),
            ("Origin", ORIGIN),
            ("Origin", ORIGIN),
        ],
    )
    assert_error(response, 403, "FORBIDDEN")


def test_origin_is_checked_before_authentication(client):
    assert_error(
        client.post(
            "/api/v1/configurations/x/versions",
            json=body(1),
            headers={"Origin": ORIGIN},
        ),
        403,
        "FORBIDDEN",
    )


# ---------- replay ----------


def test_identical_retry_returns_200_with_the_existing_version_and_creates_nothing(
    client, seeded
):
    ws = new_workspace(client)
    first = ws.post(body(1, delay=15, name="Replay Name"))
    assert first.status_code == 201
    before = dump_tables(seeded)

    again = ws.post(body(1, delay=15, name="Replay Name"))

    assert again.status_code == 200
    assert again.json() == first.json()
    assert_headers(again)
    assert dump_tables(seeded) == before


def test_retry_with_different_content_is_409(client, seeded):
    ws = new_workspace(client)
    ws.post(body(1, delay=15))
    before = dump_tables(seeded)
    assert_error(ws.post(body(1, delay=16)), 409, "VERSION_CONFLICT")
    assert_error(
        ws.post(body(1, delay=15, name="Different Name")), 409, "VERSION_CONFLICT"
    )
    assert dump_tables(seeded) == before


def test_replay_applies_only_to_the_immediately_previous_version(client, seeded):
    ws = new_workspace(client)
    ws.post(body(1, delay=15))
    ws.post(body(2, delay=20))
    before = dump_tables(seeded)
    assert_error(ws.post(body(1, delay=15)), 409, "VERSION_CONFLICT")
    assert dump_tables(seeded) == before


def test_replay_does_not_match_a_different_workspaces_save(client):
    a = new_workspace(client)
    b = new_workspace(client)
    a.post(body(1, delay=15))
    assert_error(b.post(body(1, delay=15), url=a.url), 404, "CONFIGURATION_NOT_FOUND")


def test_a_failed_attempt_can_be_retried_after_recovery(client, seeded, trigger):
    ws = new_workspace(client)
    name = trigger("configuration_versions", deferred=True)
    assert_error(ws.post(body(1, delay=15)), 503, "DATABASE_UNAVAILABLE")
    trigger.remove(name)
    assert ws.post(body(1, delay=15)).status_code == 201
    assert ws.post(body(1, delay=15)).status_code == 200
    assert counts(seeded) == (1, 1, 2)


# ---------- concurrency and locking ----------


def test_concurrent_saves_with_the_same_expected_version_create_exactly_one(
    make_client, seeded
):
    ws = new_workspace(make_client())
    total = 10
    barrier = threading.Barrier(total)

    def call(index):
        client = make_client()
        barrier.wait()
        # Different content per request, so no request can be a replay of another.
        return Workspace(client, ws.token, ws.configuration_id, ws.version_id).post(
            body(1, delay=10 + index)
        )

    with ThreadPoolExecutor(max_workers=total) as pool:
        responses = list(pool.map(call, range(total)))

    statuses = sorted(r.status_code for r in responses)
    assert statuses == [201] + [409] * (total - 1)
    for r in responses:
        if r.status_code == 409:
            assert r.json()["error"]["details"] == [
                {"field": "current_version", "reason": "2"}
            ]
    assert counts(seeded) == (1, 1, 2)
    winner = next(r for r in responses if r.status_code == 201).json()
    assert ws.current()["version_id"] == winner["version_id"]


def test_concurrent_identical_saves_yield_one_creation_and_the_rest_replay_or_conflict(
    make_client, seeded
):
    ws = new_workspace(make_client())
    total = 8
    barrier = threading.Barrier(total)

    def call(_):
        client = make_client()
        barrier.wait()
        return Workspace(client, ws.token, ws.configuration_id, ws.version_id).post(
            body(1, delay=15)
        )

    with ThreadPoolExecutor(max_workers=total) as pool:
        statuses = sorted(r.status_code for r in pool.map(call, range(total)))
    assert statuses.count(201) == 1
    assert set(statuses) <= {
        200,
        201,
    }  # losers see the identical latest version: replay
    assert counts(seeded) == (1, 1, 2)


def test_concurrent_chain_of_clients_produces_a_gapless_sequence(make_client, seeded):
    ws = new_workspace(make_client())
    rounds = 5
    for expected in range(1, rounds + 1):
        barrier = threading.Barrier(4)

        def call(index, expected=expected, barrier=barrier):
            client = make_client()
            barrier.wait()
            return (
                Workspace(client, ws.token, ws.configuration_id, ws.version_id)
                .post(body(expected, delay=expected * 10 + index))
                .status_code
            )

        with ThreadPoolExecutor(max_workers=4) as pool:
            assert sorted(pool.map(call, range(4))) == [201, 409, 409, 409]
    with seeded.connect() as conn:
        numbers = [
            r[0]
            for r in conn.execute(
                text(
                    "SELECT version_number FROM configuration_versions ORDER BY version_number"
                )
            )
        ]
        pointer = conn.execute(
            text("SELECT latest_version FROM configurations")
        ).scalar_one()
    assert numbers == list(range(1, rounds + 2)) and pointer == rounds + 1


def test_saves_to_different_configurations_do_not_block_each_other(make_client, seeded):
    a = new_workspace(make_client())
    b = new_workspace(make_client())
    holder = seeded.connect()
    tx = holder.begin()
    try:
        holder.execute(
            text("SELECT id FROM configurations WHERE id = :c FOR UPDATE"),
            {"c": a.configuration_id},
        )
        started = time.monotonic()
        response = Workspace(
            make_client(), b.token, b.configuration_id, b.version_id
        ).post(body(1))
        elapsed = time.monotonic() - started
    finally:
        tx.rollback()
        holder.close()
    assert response.status_code == 201 and elapsed < 1.5


def test_lock_timeout_is_a_bounded_503_with_retry_after_and_recovers(
    make_client, seeded, monkeypatch, caplog
):
    monkeypatch.setattr(service, "LOCK_TIMEOUT_MS", 300)
    ws = new_workspace(make_client())
    holder = seeded.connect()
    tx = holder.begin()
    try:
        holder.execute(
            text("SELECT id FROM configurations WHERE id = :c FOR UPDATE"),
            {"c": ws.configuration_id},
        )
        started = time.monotonic()
        with caplog.at_level(logging.DEBUG):
            response = Workspace(
                make_client(), ws.token, ws.configuration_id, ws.version_id
            ).post(body(1))
        elapsed = time.monotonic() - started
    finally:
        tx.rollback()
        holder.close()

    assert_error(response, 503, "DATABASE_UNAVAILABLE")
    assert response.headers["retry-after"] == "5"
    assert 0.25 < elapsed < 3
    assert "reason=lock_timeout" in caplog.text
    assert counts(seeded) == (1, 1, 1)
    assert (
        Workspace(make_client(), ws.token, ws.configuration_id, ws.version_id)
        .post(body(1))
        .status_code
        == 201
    )


def test_timeouts_do_not_leak_into_the_connection_and_locks_are_released(seeded):
    factory = sessionmaker(bind=seeded)
    with factory() as session:
        workspace_id = resolve_session(session, None).workspace_id
        configuration_id = session.execute(
            text("SELECT id FROM configurations WHERE workspace_id = :w"),
            {"w": workspace_id},
        ).scalar_one()
    with factory() as session:
        service.save_version(
            session,
            workspace_id,
            configuration_id,
            1,
            DEFAULT_NAME,
            default_system_config(),
        )
        assert session.execute(text("SHOW lock_timeout")).scalar_one() != "2s"
        assert session.execute(text("SHOW statement_timeout")).scalar_one() != "5s"
    with seeded.connect() as conn:  # no row lock remains
        conn.execute(text("SET lock_timeout = '300ms'"))
        conn.execute(text("SELECT id FROM configurations FOR UPDATE"))


# ---------- immutability ----------


@pytest.fixture
def trigger(seeded):
    created: list[tuple[str, str]] = []

    def install(table: str, event: str = "INSERT", deferred: bool = False) -> str:
        name = (
            f"test_fail_{table}_{event.split()[0].lower()}_{'d' if deferred else 'i'}"
        )
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
                        f"CREATE CONSTRAINT TRIGGER {name} AFTER {event} ON {table} "
                        "DEFERRABLE INITIALLY DEFERRED FOR EACH ROW "
                        "EXECUTE FUNCTION test_injected_failure()"
                    )
                )
            else:
                conn.execute(
                    text(
                        f"CREATE TRIGGER {name} BEFORE {event} ON {table} "
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


def test_saves_never_update_or_delete_existing_versions(client, seeded, trigger):
    ws = new_workspace(client)
    with seeded.connect() as conn:
        v1_before = conn.execute(
            text(
                "SELECT id::text, version_number, schema_version, snapshot_json::text, created_at FROM configuration_versions"
            )
        ).all()
    trigger("configuration_versions", "UPDATE OR DELETE")
    ws.post(body(1, delay=15))
    ws.post(body(1, delay=15))  # replay
    ws.post(body(1, delay=99))  # conflict
    ws.post(body(2, delay=20))
    with seeded.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT id::text, version_number, schema_version, snapshot_json::text, created_at FROM configuration_versions ORDER BY version_number"
            )
        ).all()
    assert rows[0] == v1_before[0]
    assert [r[1] for r in rows] == [1, 2, 3]
    assert json.loads(rows[0][3]) == snapshot(5)


def test_the_version_one_snapshot_is_unchanged_after_later_saves(client, seeded):
    ws = new_workspace(client)
    with seeded.connect() as conn:
        v1 = conn.execute(
            text("SELECT snapshot_json::text FROM configuration_versions")
        ).scalar_one()
    for expected in range(1, 5):
        assert ws.post(body(expected, delay=expected * 7)).status_code == 201
    with seeded.connect() as conn:
        again = conn.execute(
            text(
                "SELECT snapshot_json::text FROM configuration_versions WHERE version_number = 1"
            )
        ).scalar_one()
    assert again == v1


# ---------- atomicity ----------


def _state(engine):
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT latest_version, name, updated_at FROM configurations")
        ).one(), count(conn, "configuration_versions")


@pytest.mark.parametrize(
    ("table", "event", "deferred"),
    [
        ("configuration_versions", "INSERT", False),
        ("configurations", "UPDATE", False),
        ("configuration_versions", "INSERT", True),
        ("configurations", "UPDATE", True),
    ],
)
def test_failure_at_any_stage_rolls_everything_back(
    client, seeded, trigger, table, event, deferred
):
    ws = new_workspace(client)
    before = _state(seeded)
    dump_before = dump_tables(seeded)
    name = trigger(table, event, deferred)

    response = ws.post(body(1, delay=15, name="Should Not Persist"))

    assert_error(response, 503, "DATABASE_UNAVAILABLE")
    assert _state(seeded) == before
    assert dump_tables(seeded) == dump_before
    trigger.remove(name)
    assert ws.post(body(1, delay=15, name="Should Not Persist")).status_code == 201


def test_success_response_is_only_sent_after_the_commit(client, seeded):
    ws = new_workspace(client)
    response = ws.post(body(1, delay=15))
    assert response.status_code == 201
    with seeded.connect() as other:  # a separate connection sees the committed rows
        assert (
            other.execute(
                text("SELECT latest_version FROM configurations")
            ).scalar_one()
            == 2
        )
        assert count(other, "configuration_versions") == 2


def test_version_row_and_pointer_agree_in_every_committed_state(client, seeded):
    ws = new_workspace(client)
    for expected in range(1, 4):
        ws.post(body(expected, delay=expected))
        with seeded.connect() as conn:
            pointer = conn.execute(
                text("SELECT latest_version FROM configurations")
            ).scalar_one()
            top = conn.execute(
                text("SELECT max(version_number) FROM configuration_versions")
            ).scalar_one()
        assert pointer == top == expected + 1


# ---------- secrecy ----------


def test_logs_and_responses_never_contain_tokens_hashes_cookies_or_stored_data(
    client, seeded, trigger, caplog
):
    ws = new_workspace(client)
    token_hash = hashlib.sha256(ws.token.encode()).hexdigest()
    responses = []
    with caplog.at_level(logging.DEBUG):
        responses.append(ws.post(body(1, delay=15, name="Visible Secret Name")))
        responses.append(ws.post(body(1, delay=17)))
        responses.append(ws.post(body(1), headers={"Origin": "https://evil.example"}))
        name = trigger("configuration_versions")
        responses.append(ws.post(body(2, delay=18)))
        trigger.remove(name)
        with seeded.begin() as conn:
            conn.execute(text("UPDATE configurations SET latest_version = 0"))
        responses.append(ws.post(body(2, delay=19)))
    for secret in (
        ws.token,
        token_hash,
        "gridproof_demo=",
        "Visible Secret Name",
        "evil.example",
    ):
        assert secret not in caplog.text
        for response in responses:
            assert secret not in response.text
            assert all(secret not in v for v in response.headers.values())


# ---------- round trip ----------


def test_get_current_after_each_save_returns_exactly_what_was_saved(client):
    ws = new_workspace(client)
    for expected, (delay, name) in enumerate(
        [(15, "First"), (30, "Second"), (0, "Third")], start=1
    ):
        out = ws.post(body(expected, delay=delay, name=name)).json()
        current = ws.current()
        assert current["latest_version"] == out["version_number"] == expected + 1
        assert current["version_id"] == out["version_id"]
        assert current["name"] == name and current["snapshot"] == snapshot(delay)
        assert current["configuration_id"] == ws.configuration_id
