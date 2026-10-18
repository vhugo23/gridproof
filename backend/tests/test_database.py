from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app


def test_database_health():
    mock_db = MagicMock()
    mock_db.execute.return_value.scalar_one.return_value = 1

    def override_db():
        yield mock_db

    app.dependency_overrides[get_db] = override_db

    try:
        with TestClient(app) as client:
            response = client.get("/api/v1/health/database")

        assert response.status_code == 200
        assert response.json() == {
            "status": "connected",
            "database": "postgresql",
        }
        mock_db.execute.assert_called_once()
    finally:
        app.dependency_overrides.clear()
