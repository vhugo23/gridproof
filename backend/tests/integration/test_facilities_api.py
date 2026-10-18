"""GET /api/v1/facilities against the isolated PostgreSQL test database.

app.main builds (but does not connect) the application's own engine from
DATABASE_URL, which locally may point at Neon. Every test here therefore:
  * overrides get_db with a session bound to the test database, and
  * makes any use of the application's engine or SessionLocal fail the test.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

import app.db.session as app_session
from app.db.session import get_db
from app.main import app
from app.seed.facilities import seed_facilities

CONTRACT_KEYS = {
    "id",
    "name",
    "city",
    "region",
    "country",
    "latitude",
    "longitude",
    "facility_type",
    "is_interactive",
    "description",
    "source_url",
    "source_note",
}

# Independently written expectations (sources: see docs/08-decisions.md D-16).
EXPECTED = {
    "daventry": {
        "name": "Daventry Power Systems Plant",
        "city": "Daventry",
        "region": "Northamptonshire",
        "country": "GB",
        "latitude": 52.25778,
        "longitude": -1.16278,
        "facility_type": "manufacturing_site",
        "is_interactive": False,
        "source_host": "www.cummins.com",
        "description_word": "generator sets",
    },
    "fridley": {
        "name": "Power Integration Center",
        "city": "Fridley",
        "region": "MN",
        "country": "US",
        "latitude": 45.08417,
        "longitude": -93.25667,
        "facility_type": "integration_testing",
        "is_interactive": True,
        "source_host": "www.cummins.com",
        "description_word": "microgrid",
    },
    "seymour": {
        "name": "Seymour Technical Center and Engine Plant",
        "city": "Seymour",
        "region": "IN",
        "country": "US",
        "latitude": 38.95722,
        "longitude": -85.89444,
        "facility_type": "engine_plant_and_technical_center",
        "is_interactive": False,
        "source_host": "investor.cummins.com",
        "description_word": "High-Horsepower",
    },
}


def _forbid_application_engine(*_args, **_kwargs):
    raise AssertionError("the application's own database engine must not be used")


@pytest.fixture
def client(db_session, monkeypatch):
    def override():
        yield db_session

    app.dependency_overrides[get_db] = override
    assert app.dependency_overrides[get_db] is override
    monkeypatch.setattr(app_session, "SessionLocal", _forbid_application_engine)
    monkeypatch.setattr(app_session.engine, "connect", _forbid_application_engine)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def seeded(db_session):
    seed_facilities(db_session)
    return db_session


def test_returns_the_seeded_catalog_with_exact_values(client, seeded):
    response = client.get("/api/v1/facilities")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    body = response.json()
    assert set(body) == {"catalog_version", "facilities"}
    assert body["catalog_version"] == 1
    assert [f["id"] for f in body["facilities"]] == ["daventry", "fridley", "seymour"]

    for facility in body["facilities"]:
        expected = EXPECTED[facility["id"]]
        for key in (
            "name",
            "city",
            "region",
            "country",
            "latitude",
            "longitude",
            "facility_type",
            "is_interactive",
        ):
            assert facility[key] == expected[key], (facility["id"], key)
        assert facility["source_url"].startswith(f"https://{expected['source_host']}/")
        assert expected["description_word"] in facility["description"]


def test_only_the_documented_fields_are_exposed(client, seeded):
    facilities = client.get("/api/v1/facilities").json()["facilities"]
    assert len(facilities) == 3
    for facility in facilities:
        assert set(facility) == CONTRACT_KEYS


def test_only_fridley_is_interactive(client, seeded):
    facilities = client.get("/api/v1/facilities").json()["facilities"]
    assert [f["id"] for f in facilities if f["is_interactive"]] == ["fridley"]


def test_source_attribution_and_approximate_coordinates_are_preserved(client, seeded):
    for facility in client.get("/api/v1/facilities").json()["facilities"]:
        note = facility["source_note"]
        assert "approximate" in note.lower(), facility["id"]
        assert "not the facility's coordinates" in note
        assert "not affiliated with Cummins" in note


def test_success_is_cacheable_and_sets_no_cookie(client, seeded):
    response = client.get("/api/v1/facilities")
    assert response.headers["cache-control"] == "public, max-age=300"
    assert "set-cookie" not in response.headers


def test_requires_no_authentication_cookie_or_origin(client, seeded):
    # TestClient sends no cookie, no Origin, no Authorization header.
    assert "gridproof_demo" not in client.cookies
    response = client.get("/api/v1/facilities")
    assert response.status_code == 200


def test_exposes_nothing_from_workspace_or_configuration_tables(client, seeded):
    seeded.execute(
        text(
            "INSERT INTO demo_workspaces (id, token_hash, expires_at) "
            "VALUES (gen_random_uuid(), 'private-token-hash', now() + interval '1 day')"
        )
    )
    raw = client.get("/api/v1/facilities").text
    assert "private-token-hash" not in raw
    for word in ("workspace", "startup_delay", "snapshot", "token"):
        assert word not in raw.lower()


def test_empty_catalog_is_503_with_the_error_envelope(client, db_session):
    response = client.get("/api/v1/facilities")

    assert response.status_code == 503
    error = response.json()["error"]
    assert error["code"] == "CATALOG_UNAVAILABLE"
    assert error["request_id"].startswith("req_")
    assert response.headers["x-request-id"] == error["request_id"]
    assert response.headers["cache-control"] == "no-store"


def test_endpoint_reflects_reseeded_values(client, seeded):
    seeded.execute(
        text("UPDATE facility_catalog SET name = 'Tampered' WHERE id = 'seymour'")
    )
    names = {
        f["id"]: f["name"]
        for f in client.get("/api/v1/facilities").json()["facilities"]
    }
    assert names["seymour"] == "Tampered"

    seed_facilities(seeded)
    names = {
        f["id"]: f["name"]
        for f in client.get("/api/v1/facilities").json()["facilities"]
    }
    assert names["seymour"] == EXPECTED["seymour"]["name"]


def test_application_engine_is_blocked_without_the_override(client, seeded):
    """Proves the guard: if the override were missing, the request cannot reach
    the application's own engine, it fails the test instead."""
    app.dependency_overrides.pop(get_db, None)
    with pytest.raises(AssertionError, match="application's own database engine"):
        client.get("/api/v1/facilities")
