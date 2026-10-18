"""Unit tests for the test-database guard. They need no database."""

import pytest
from db_safety import UnsafeTestDatabaseError, assert_safe_test_database_url

LOCAL = "postgresql://gridproof:gridproof_test@127.0.0.1:55432/gridproof_test"
CI = "postgresql://gridproof:gridproof_test@localhost:5432/gridproof_test"


@pytest.mark.parametrize("url", [LOCAL, CI])
def test_accepts_approved_instances(url):
    safe = assert_safe_test_database_url(url)
    assert safe.drivername == "postgresql+psycopg"
    assert safe.database == "gridproof_test"


def test_accepts_explicit_psycopg_driver():
    url = LOCAL.replace("postgresql://", "postgresql+psycopg://")
    assert assert_safe_test_database_url(url).host == "127.0.0.1"


@pytest.mark.parametrize(
    "url",
    [
        None,
        "",
        "   ",
        "not a url",
        # Neon and other remote hosts
        "postgresql://u:p@ep-cool-123.us-east-2.aws.neon.tech/gridproof_test",
        "postgresql://gridproof:x@ep-x.neon.tech:5432/gridproof_test?sslmode=require",
        "postgresql://gridproof:x@db.example.com:5432/gridproof_test",
        "postgresql://gridproof:x@10.0.0.5:5432/gridproof_test",
        "postgresql://gridproof:x@0.0.0.0:55432/gridproof_test",
        # right host, wrong details
        "postgresql://gridproof:x@127.0.0.1:55432/gridproof",
        "postgresql://gridproof:x@127.0.0.1:55432/postgres",
        "postgresql://gridproof:x@127.0.0.1:5433/gridproof_test",
        "postgresql://postgres:x@127.0.0.1:55432/gridproof_test",
        "postgresql://gridproof:x@127.0.0.1/gridproof_test",
        # not PostgreSQL
        "mysql://gridproof:x@127.0.0.1:55432/gridproof_test",
        "sqlite:///gridproof_test",
        # a Neon marker hidden in the query string or database name
        "postgresql://gridproof:x@127.0.0.1:55432/gridproof_test?host=x.neon.tech",
    ],
)
def test_rejects_unsafe_urls(url):
    with pytest.raises(UnsafeTestDatabaseError):
        assert_safe_test_database_url(url)


SECRET = "s3cretpw"


@pytest.mark.parametrize(
    "url",
    [
        f"postgresql://gridproof:{SECRET}@ep-x.neon.tech:5432/gridproof_test",
        f"postgresql://gridproof:{SECRET}@db.example.com:5432/gridproof_test",
        f"postgresql://gridproof:{SECRET}@127.0.0.1:55432/other_db",
        f"postgresql://postgres:{SECRET}@127.0.0.1:55432/gridproof_test",
        f"postgresql://gridproof:{SECRET}@127.0.0.1:9999/gridproof_test",
        f"mysql://gridproof:{SECRET}@127.0.0.1:55432/gridproof_test",
        f"postgresql://gridproof:{SECRET}@127.0.0.1:notaport/gridproof_test",
    ],
)
def test_rejection_messages_never_contain_the_password(url):
    with pytest.raises(UnsafeTestDatabaseError) as exc:
        assert_safe_test_database_url(url)
    chain = [exc.value, exc.value.__cause__, exc.value.__context__]
    for item in chain:
        assert SECRET not in str(item)
        assert SECRET not in repr(item)


def test_accepted_url_repr_masks_the_password():
    url = assert_safe_test_database_url(
        f"postgresql://gridproof:{SECRET}@127.0.0.1:55432/gridproof_test"
    )
    assert SECRET not in repr(url)
    assert SECRET not in str(url)
