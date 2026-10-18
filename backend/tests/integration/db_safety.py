"""Safety guard for the integration-test database.

Integration tests may only talk to the explicitly configured, disposable
PostgreSQL instance (Docker locally, a service container in CI). Everything
else, including Neon and any remote host, is rejected before an engine is
created or a connection is opened.
"""

from sqlalchemy.engine import URL, make_url

ALLOWED_HOSTS = frozenset({"127.0.0.1", "localhost"})
# 55432: local Docker (docker-compose.test.yml); 5432: GitHub Actions service.
ALLOWED_PORTS = frozenset({55432, 5432})
ALLOWED_DATABASE = "gridproof_test"
ALLOWED_USER = "gridproof"
ALLOWED_DRIVERS = frozenset({"postgresql", "postgresql+psycopg"})


class UnsafeTestDatabaseError(Exception):
    """The configured test database is not the approved disposable instance."""


def assert_safe_test_database_url(raw_url: str | None) -> URL:
    """Validate a TEST_DATABASE_URL and return it with the psycopg driver.

    Pure string/URL validation: no engine is created, nothing is connected.
    """
    if not raw_url or not raw_url.strip():
        raise UnsafeTestDatabaseError("TEST_DATABASE_URL is empty.")

    if "neon" in raw_url.lower():
        raise UnsafeTestDatabaseError("Neon connections are never allowed in tests.")

    try:
        url = make_url(raw_url)
    except Exception as exc:
        raise UnsafeTestDatabaseError("TEST_DATABASE_URL cannot be parsed.") from exc

    if url.drivername not in ALLOWED_DRIVERS:
        raise UnsafeTestDatabaseError(
            f"Unsupported driver {url.drivername!r}; expected PostgreSQL."
        )
    if url.host not in ALLOWED_HOSTS:
        raise UnsafeTestDatabaseError(
            f"Host {url.host!r} is not allowed; expected one of {sorted(ALLOWED_HOSTS)}."
        )
    if url.port not in ALLOWED_PORTS:
        raise UnsafeTestDatabaseError(
            f"Port {url.port!r} is not allowed; expected one of {sorted(ALLOWED_PORTS)}."
        )
    if url.database != ALLOWED_DATABASE:
        raise UnsafeTestDatabaseError(
            f"Database {url.database!r} is not allowed; expected {ALLOWED_DATABASE!r}."
        )
    if url.username != ALLOWED_USER:
        raise UnsafeTestDatabaseError(
            f"Role {url.username!r} is not allowed; expected {ALLOWED_USER!r}."
        )

    return url.set(drivername="postgresql+psycopg")
