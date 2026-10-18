"""Fixtures for tests that need the isolated PostgreSQL test database.

Safety rules:
- Only TEST_DATABASE_URL is read. DATABASE_URL is never used as a fallback.
- The URL is validated before an engine is created, and again before every
  destructive operation.
- app.db.session (which builds an engine from DATABASE_URL) is never imported.
"""

import os
import time
from collections.abc import Callable, Generator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from db_safety import UnsafeTestDatabaseError, assert_safe_test_database_url
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, Connection, Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

BACKEND_DIR = Path(__file__).resolve().parents[2]
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"
APP_TABLES = (
    "configuration_versions",
    "configurations",
    "facility_catalog",
    "demo_workspaces",
)

# Bounded waits: a stuck lock or query fails the test instead of hanging CI.
SESSION_OPTIONS = "-c lock_timeout=5000 -c statement_timeout=15000"


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    for item in items:
        if "integration" in item.path.parts and item.path.name != "test_db_safety.py":
            item.add_marker(pytest.mark.integration)


@pytest.fixture(scope="session")
def test_database_url() -> URL:
    raw = os.environ.get("TEST_DATABASE_URL")
    if not raw:
        if os.environ.get("GRIDPROOF_REQUIRE_TEST_DB") == "1":
            pytest.fail(
                "TEST_DATABASE_URL is required in this environment "
                "(GRIDPROOF_REQUIRE_TEST_DB=1) but is not set."
            )
        pytest.skip(
            "TEST_DATABASE_URL is not set; start the Docker test database "
            "(see docs/07-testing-strategy.md) to run integration tests."
        )
    try:
        return assert_safe_test_database_url(raw)
    except UnsafeTestDatabaseError as exc:
        pytest.fail(f"Refusing to run integration tests: {exc}")


@pytest.fixture(scope="session")
def engine(test_database_url: URL) -> Generator[Engine, None, None]:
    assert_safe_test_database_url(
        test_database_url.render_as_string(hide_password=False)
    )
    eng = create_engine(
        test_database_url,
        connect_args={"connect_timeout": 5, "options": SESSION_OPTIONS},
    )
    deadline = time.monotonic() + 15
    while True:
        try:
            with eng.connect() as conn:
                conn.execute(text("SELECT 1"))
            break
        except OperationalError as exc:
            if time.monotonic() > deadline:
                eng.dispose()
                pytest.fail(
                    "Cannot reach the test database. Is Docker running and "
                    "`docker compose -f backend/docker-compose.test.yml up -d --wait` "
                    f"done? ({exc.orig})"
                )
            time.sleep(0.5)
    yield eng
    eng.dispose()


def reset_schema(eng: Engine) -> None:
    """Drop everything in the public schema. Guarded: test database only."""
    assert_safe_test_database_url(eng.url.render_as_string(hide_password=False))
    with eng.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))


def _alembic_config(connection: Connection) -> Config:
    cfg = Config(str(ALEMBIC_INI))
    # Injected connection: migrations/env.py never reads DATABASE_URL.
    cfg.attributes["connection"] = connection
    return cfg


def run_alembic(eng: Engine, action: str, revision: str) -> None:
    """Run `alembic upgrade|downgrade <revision>` on the guarded test engine."""
    assert_safe_test_database_url(eng.url.render_as_string(hide_password=False))
    with eng.begin() as conn:
        cfg = _alembic_config(conn)
        getattr(command, action)(cfg, revision)


@pytest.fixture
def alembic_runner(engine: Engine) -> Callable[[str, str], None]:
    def run(action: str, revision: str) -> None:
        run_alembic(engine, action, revision)

    return run


@pytest.fixture
def blank_engine(engine: Engine) -> Engine:
    """Empty public schema (no tables, no alembic_version)."""
    reset_schema(engine)
    return engine


@pytest.fixture(scope="module")
def migrated_engine(engine: Engine) -> Engine:
    """Schema reset and migrated to head once per test module."""
    reset_schema(engine)
    run_alembic(engine, "upgrade", "head")
    return engine


@pytest.fixture
def db_session(migrated_engine: Engine) -> Generator[Session, None, None]:
    """Session inside an outer transaction that is always rolled back."""
    connection = migrated_engine.connect()
    outer = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        outer.rollback()
        connection.close()


@pytest.fixture
def committing_engine(migrated_engine: Engine) -> Generator[Engine, None, None]:
    """For tests that need real commits; tables are emptied afterwards."""
    yield migrated_engine
    assert_safe_test_database_url(
        migrated_engine.url.render_as_string(hide_password=False)
    )
    with migrated_engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {', '.join(APP_TABLES)} CASCADE"))
