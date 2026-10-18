"""GET /api/v1/facilities with a mocked session. No database needed."""

import logging
import re
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.db.session import get_db
from app.main import app

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
REQUEST_ID = re.compile(r"^req_[0-9a-f]{32}$")
SECRET = "hunter2-secret"
HOST = "db.secret.internal"


def row(**overrides):
    data = {
        "id": "fridley",
        "name": "Power Integration Center",
        "city": "Fridley",
        "region": "MN",
        "country": "US",
        "latitude": 45.08417,
        "longitude": -93.25667,
        "facility_type": "integration_testing",
        "is_interactive": True,
        "description": "Context text.",
        "source_url": "https://example.invalid/source",
        "source_note": "Marker position is approximate.",
        "catalog_version": 1,
    }
    data.update(overrides)
    return SimpleNamespace(**data)


def call(session):
    def override():
        yield session

    app.dependency_overrides[get_db] = override
    try:
        return TestClient(app).get("/api/v1/facilities")
    finally:
        app.dependency_overrides.clear()


def session_returning(rows):
    session = MagicMock()
    session.scalars.return_value.all.return_value = rows
    return session


def session_raising(exc):
    session = MagicMock()
    session.scalars.side_effect = exc
    return session


def assert_error(response, status, code):
    assert response.status_code == status
    body = response.json()
    assert set(body) == {"error"}
    error = body["error"]
    assert set(error) == {"code", "message", "details", "request_id"}
    assert error["code"] == code
    assert error["details"] == []
    assert REQUEST_ID.match(error["request_id"])
    assert response.headers["x-request-id"] == error["request_id"]
    assert response.headers["cache-control"] == "no-store"
    assert "set-cookie" not in response.headers


def test_success_has_exactly_the_contract_fields_and_is_cacheable():
    response = call(session_returning([row(), row(id="seymour", is_interactive=False)]))

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"catalog_version", "facilities"}
    assert body["catalog_version"] == 1
    assert [f["id"] for f in body["facilities"]] == ["fridley", "seymour"]
    for facility in body["facilities"]:
        assert set(facility) == CONTRACT_KEYS
    assert response.headers["cache-control"] == "public, max-age=300"
    assert "set-cookie" not in response.headers
    assert "x-request-id" not in response.headers


def test_catalog_version_is_the_highest_row_version():
    response = call(session_returning([row(), row(id="seymour", catalog_version=3)]))
    assert response.json()["catalog_version"] == 3


def test_empty_catalog_is_unavailable_not_an_empty_list():
    assert_error(call(session_returning([])), 503, "CATALOG_UNAVAILABLE")


def test_database_error_is_503_and_leaks_nothing(caplog):
    error = OperationalError(
        "SELECT 1", {}, Exception(f"password={SECRET} host={HOST} port=5432")
    )
    with caplog.at_level(logging.DEBUG):
        response = call(session_raising(error))

    assert_error(response, 503, "CATALOG_UNAVAILABLE")
    everything = response.text + str(dict(response.headers)) + caplog.text
    assert SECRET not in everything
    assert HOST not in everything
    assert "OperationalError" in caplog.text  # the type is logged for operators


def test_unexpected_error_is_500_and_leaks_nothing(caplog):
    with caplog.at_level(logging.DEBUG):
        response = call(session_raising(RuntimeError(f"internal {SECRET} {HOST}")))

    assert_error(response, 500, "INTERNAL_ERROR")
    assert response.json()["error"]["message"] == "An unexpected error occurred."
    everything = response.text + str(dict(response.headers)) + caplog.text
    assert SECRET not in everything
    assert HOST not in everything
    assert "Traceback" not in everything


def test_corrupt_row_is_a_500_not_a_partial_response():
    assert_error(call(session_returning([row(latitude=None)])), 500, "INTERNAL_ERROR")


def test_each_error_gets_its_own_request_id():
    first = call(session_returning([])).json()["error"]["request_id"]
    second = call(session_returning([])).json()["error"]["request_id"]
    assert first != second


def test_no_application_wide_exception_handler_was_added():
    assert Exception not in app.exception_handlers


def test_existing_health_routes_are_unchanged():
    client = TestClient(app)
    assert client.get("/api/v1/health").json() == {
        "status": "ok",
        "service": "gridproof-api",
    }


@pytest.mark.parametrize("method", ["post", "put", "delete", "patch"])
def test_endpoint_is_read_only(method):
    response = getattr(TestClient(app), method)("/api/v1/facilities")
    assert response.status_code == 405
