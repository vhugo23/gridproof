"""initialize_workspace against the isolated PostgreSQL test database.

These tests use real commits (committing_engine) so that visibility across
separate connections, rollback after failures and savepoint behavior are exercised
for real. Failures are injected with temporary database triggers that raise after
the targeted statement is attempted, so no test-only hooks exist in the service.
"""

import hashlib
import logging

import pytest
from db_helpers import count, insert_facility
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.domain.system_config import (
    DEFAULT_CONFIGURATION_NAME,
    default_system_config,
    load_snapshot,
    to_snapshot,
)
from app.seed.facilities import seed_facilities
from app.services import workspaces
from app.services.workspaces import (
    CatalogNotSeededError,
    TransactionRequiredError,
    initialize_workspace,
)

TABLES = ("demo_workspaces", "configurations", "configuration_versions")


def counts(db) -> tuple[int, int, int]:
    return tuple(count(db, table) for table in TABLES)


def committed_counts(engine) -> tuple[int, int, int]:
    with engine.connect() as conn:  # a separate connection and transaction
        return counts(conn)


@pytest.fixture
def seeded(committing_engine):
    with Session(committing_engine) as session, session.begin():
        seed_facilities(session)
    return committing_engine


@pytest.fixture
def fail_on(committing_engine):
    """Install triggers that raise on the given table/event; always removed."""
    installed: list[tuple[str, str]] = []

    def install(table: str, event: str) -> None:
        with committing_engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE OR REPLACE FUNCTION test_injected_failure() RETURNS trigger "
                    "LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$"
                )
            )
            name = f"test_fail_{table}_{event.lower()}"
            conn.execute(
                text(
                    f"CREATE TRIGGER {name} BEFORE {event} ON {table} "
                    "FOR EACH ROW EXECUTE FUNCTION test_injected_failure()"
                )
            )
        installed.append((name, table))

    def remove_all() -> None:
        with committing_engine.begin() as conn:
            for name, table in installed:
                conn.execute(text(f"DROP TRIGGER IF EXISTS {name} ON {table}"))
            conn.execute(text("DROP FUNCTION IF EXISTS test_injected_failure()"))
        installed.clear()

    install.remove_all = remove_all
    yield install
    remove_all()


def create_workspace(engine):
    with Session(engine) as session, session.begin():
        return initialize_workspace(session)


# ---------- success ----------


def test_creates_exactly_one_workspace_configuration_and_version(seeded):
    result = create_workspace(seeded)

    assert committed_counts(seeded) == (1, 1, 1)
    with seeded.connect() as conn:
        configuration = conn.execute(
            text("SELECT * FROM configurations WHERE workspace_id = :w"),
            {"w": result.workspace_id},
        ).one()
        version = conn.execute(
            text("SELECT * FROM configuration_versions WHERE configuration_id = :c"),
            {"c": configuration.id},
        ).one()

    assert configuration.id == result.configuration_id
    assert configuration.facility_id == "fridley"
    assert configuration.name == DEFAULT_CONFIGURATION_NAME
    assert configuration.latest_version == 1
    assert configuration.updated_at >= configuration.created_at
    assert version.id == result.version_id
    assert version.version_number == 1
    assert version.schema_version == "config-v1"
    assert version.snapshot_json == to_snapshot(default_system_config())
    assert load_snapshot(version.schema_version, version.snapshot_json) == (
        default_system_config()
    )


def test_expiry_is_exactly_seven_days_after_creation_by_the_database_clock(seeded):
    result = create_workspace(seeded)

    with seeded.connect() as conn:
        row = conn.execute(
            text(
                "SELECT expires_at - created_at = interval '7 days' AS exact, "
                "expires_at > now() AS future, expires_at FROM demo_workspaces "
                "WHERE id = :i"
            ),
            {"i": result.workspace_id},
        ).one()

    assert row.exact is True
    assert row.future is True
    assert result.expires_at == row.expires_at


def test_only_the_sha256_hash_of_the_token_is_stored(seeded):
    result = create_workspace(seeded)
    expected_hash = hashlib.sha256(result.token.encode()).hexdigest()

    with seeded.connect() as conn:
        stored = conn.execute(
            text("SELECT token_hash FROM demo_workspaces WHERE id = :i"),
            {"i": result.workspace_id},
        ).scalar_one()
        assert stored == expected_hash
        assert stored != result.token
        for table in TABLES:
            hits = conn.execute(
                text(f"SELECT count(*) FROM {table} t WHERE t::text LIKE :p"),
                {"p": f"%{result.token}%"},
            ).scalar_one()
            assert hits == 0, table


def test_two_initializations_are_independent(seeded):
    first, second = create_workspace(seeded), create_workspace(seeded)

    assert first.token != second.token
    assert len({first.workspace_id, second.workspace_id}) == 2
    assert len({first.configuration_id, second.configuration_id}) == 2
    assert len({first.version_id, second.version_id}) == 2
    assert committed_counts(seeded) == (2, 2, 2)
    with seeded.connect() as conn:
        owners = dict(
            conn.execute(text("SELECT id, workspace_id FROM configurations")).all()
        )
        parents = dict(
            conn.execute(
                text("SELECT id, configuration_id FROM configuration_versions")
            ).all()
        )
    assert owners[first.configuration_id] == first.workspace_id
    assert owners[second.configuration_id] == second.workspace_id
    assert parents[first.version_id] == first.configuration_id
    assert parents[second.version_id] == second.configuration_id


def test_facility_catalog_is_not_modified(seeded):
    query = text("SELECT * FROM facility_catalog ORDER BY id")
    with seeded.connect() as conn:
        before = [tuple(row) for row in conn.execute(query)]
    create_workspace(seeded)
    with seeded.connect() as conn:
        assert [tuple(row) for row in conn.execute(query)] == before


# ---------- transaction ownership ----------


def test_rejects_a_session_without_an_active_transaction(seeded):
    with Session(seeded) as session:
        assert not session.in_transaction()
        with pytest.raises(TransactionRequiredError):
            initialize_workspace(session)
        assert not session.in_transaction()  # no transaction was started for us
    assert committed_counts(seeded) == (0, 0, 0)


def test_accepts_a_transaction_that_started_implicitly(seeded):
    with Session(seeded) as session:
        session.execute(text("SELECT 1"))  # autobegin
        assert session.in_transaction()
        initialize_workspace(session)
        session.commit()
    assert committed_counts(seeded) == (1, 1, 1)


def test_uncommitted_work_is_invisible_to_other_connections_until_commit(seeded):
    with Session(seeded) as session, session.begin():
        initialize_workspace(session)
        assert counts(session) == (1, 1, 1)  # visible inside the transaction
        assert committed_counts(seeded) == (0, 0, 0)  # the service did not commit
    assert committed_counts(seeded) == (1, 1, 1)  # the caller's commit made it visible


def test_caller_rollback_removes_everything(seeded):
    with Session(seeded) as session:
        session.begin()
        initialize_workspace(session)
        session.rollback()
    assert committed_counts(seeded) == (0, 0, 0)


# ---------- atomic rollback ----------

STAGES = [
    ("workspace", "demo_workspaces", "INSERT"),
    ("configuration", "configurations", "INSERT"),
    ("version", "configuration_versions", "INSERT"),
    ("pointer", "configurations", "UPDATE"),
]


@pytest.mark.parametrize(
    "table,event", [(t, e) for _, t, e in STAGES], ids=[s for s, _, _ in STAGES]
)
def test_failure_at_each_stage_leaves_no_rows_and_keeps_other_work(
    seeded, fail_on, table, event
):
    fail_on(table, event)

    with Session(seeded) as session, session.begin():
        # The caller's own earlier work, in a table the injected trigger does not touch.
        unrelated = insert_facility(session, id="caller-owned-facility")
        with pytest.raises(DBAPIError, match="injected failure"):
            initialize_workspace(session)

        # Inside the same transaction: none of the service's rows remain, and the
        # session is still usable.
        assert counts(session) == (0, 0, 0)
        assert session.in_transaction()
        insert_facility(session, id="added-after-the-failure")

    # The caller then committed: its rows survived, none of the service's did.
    assert committed_counts(seeded) == (0, 0, 0)
    with seeded.connect() as conn:
        ids = conn.execute(text("SELECT id FROM facility_catalog")).scalars().all()
    assert {unrelated, "added-after-the-failure", "fridley"} <= set(ids)


@pytest.mark.parametrize(
    "table,event", [(t, e) for _, t, e in STAGES], ids=[s for s, _, _ in STAGES]
)
def test_a_retry_after_a_failure_succeeds_in_a_new_transaction(
    seeded, fail_on, table, event
):
    fail_on(table, event)
    with Session(seeded) as session, session.begin(), pytest.raises(DBAPIError):
        initialize_workspace(session)
    assert committed_counts(seeded) == (0, 0, 0)

    fail_on.remove_all()
    create_workspace(seeded)

    assert committed_counts(seeded) == (1, 1, 1)


def test_an_unseeded_catalog_is_reported_and_leaves_no_rows(committing_engine):
    with Session(committing_engine) as session, session.begin():
        with pytest.raises(CatalogNotSeededError, match="seed the facility catalog"):
            initialize_workspace(session)
        assert counts(session) == (0, 0, 0)
    assert committed_counts(committing_engine) == (0, 0, 0)


def test_a_duplicate_token_hash_fails_atomically(seeded, monkeypatch):
    monkeypatch.setattr(workspaces, "generate_token", lambda: "fixed-token-for-test")
    first = create_workspace(seeded)

    with Session(seeded) as session, session.begin():
        with pytest.raises(IntegrityError) as error:
            initialize_workspace(session)
        assert "fixed-token-for-test" not in str(
            error.value
        )  # only the hash can appear

    assert committed_counts(seeded) == (1, 1, 1)
    with seeded.connect() as conn:
        survivor = conn.execute(text("SELECT id FROM demo_workspaces")).scalar_one()
    assert survivor == first.workspace_id


# ---------- token exposure ----------


def test_the_plaintext_token_is_never_logged(seeded, fail_on, caplog):
    with caplog.at_level(logging.DEBUG):
        ok = create_workspace(seeded)
        fail_on("configuration_versions", "INSERT")
        with Session(seeded) as session, session.begin(), pytest.raises(DBAPIError):
            initialize_workspace(session)

    assert ok.token not in caplog.text
    assert ok.token not in repr(ok)
