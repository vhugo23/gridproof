"""Transaction behavior on real PostgreSQL.

These tests prove the properties later tasks rely on: atomic multi-table
rollback (A-03) and row locking / unique-conflict behavior (A-06). All waits
are bounded by lock_timeout, so a stuck lock fails a test instead of hanging.
"""

import psycopg.errors as pgerr
import pytest
from db_helpers import (
    count,
    insert_configuration,
    insert_facility,
    insert_version,
    insert_workspace,
)
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, OperationalError

TABLES = ("demo_workspaces", "configurations", "configuration_versions")


def committed_facility(engine) -> str:
    with engine.begin() as conn:
        return insert_facility(conn)


def counts(engine) -> dict[str, int]:
    with engine.connect() as conn:
        return {table: count(conn, table) for table in TABLES}


def test_failure_inside_transaction_rolls_back_every_table(committing_engine):
    facility_id = committed_facility(committing_engine)

    with pytest.raises(RuntimeError, match="boom"), committing_engine.begin() as conn:
        workspace_id = insert_workspace(conn)
        configuration_id = insert_configuration(conn, workspace_id, facility_id)
        insert_version(conn, configuration_id, 1)
        assert count(conn, "configuration_versions") == 1  # visible inside
        raise RuntimeError("boom")

    assert counts(committing_engine) == dict.fromkeys(TABLES, 0)


def test_database_error_on_last_step_rolls_back_earlier_steps(committing_engine):
    facility_id = committed_facility(committing_engine)

    with pytest.raises(IntegrityError) as exc, committing_engine.begin() as conn:
        workspace_id = insert_workspace(conn)
        configuration_id = insert_configuration(conn, workspace_id, facility_id)
        insert_version(conn, configuration_id, 0)  # violates the CHECK
    assert exc.value.orig.diag.constraint_name == "ck_configuration_versions_number"

    assert counts(committing_engine) == dict.fromkeys(TABLES, 0)


def test_successful_transaction_commits_all_rows(committing_engine):
    facility_id = committed_facility(committing_engine)

    with committing_engine.begin() as conn:
        workspace_id = insert_workspace(conn)
        configuration_id = insert_configuration(conn, workspace_id, facility_id)
        insert_version(conn, configuration_id, 1)

    assert counts(committing_engine) == dict.fromkeys(TABLES, 1)


def test_uncommitted_rows_are_invisible_to_other_connections(committing_engine):
    with committing_engine.connect() as writer, committing_engine.connect() as reader:
        tx = writer.begin()
        insert_workspace(writer)
        assert count(reader, "demo_workspaces") == 0
        tx.commit()
        reader.rollback()  # end the reader's snapshot
        assert count(reader, "demo_workspaces") == 1


def test_row_lock_blocks_second_writer_until_commit(committing_engine):
    facility_id = committed_facility(committing_engine)
    with committing_engine.begin() as conn:
        configuration_id = insert_configuration(
            conn, insert_workspace(conn), facility_id
        )

    lock_sql = text("SELECT id FROM configurations WHERE id = :i FOR UPDATE")
    with committing_engine.connect() as first, committing_engine.connect() as second:
        first_tx = first.begin()
        first.execute(lock_sql, {"i": configuration_id})

        second_tx = second.begin()
        second.execute(text("SET LOCAL lock_timeout = '500ms'"))
        with pytest.raises(OperationalError) as exc:
            second.execute(lock_sql, {"i": configuration_id})
        assert isinstance(exc.value.orig, pgerr.LockNotAvailable)
        second_tx.rollback()

        first_tx.commit()

        second_tx = second.begin()
        second.execute(text("SET LOCAL lock_timeout = '500ms'"))
        assert second.execute(lock_sql, {"i": configuration_id}).scalar_one() == (
            configuration_id
        )
        second_tx.commit()


def test_concurrent_duplicate_version_exactly_one_wins(committing_engine):
    facility_id = committed_facility(committing_engine)
    with committing_engine.begin() as conn:
        configuration_id = insert_configuration(
            conn, insert_workspace(conn), facility_id
        )

    with committing_engine.connect() as first, committing_engine.connect() as second:
        first_tx = first.begin()
        insert_version(first, configuration_id, 1)

        # The second writer waits on the first one's uncommitted unique key.
        second_tx = second.begin()
        second.execute(text("SET LOCAL lock_timeout = '500ms'"))
        with pytest.raises(OperationalError) as blocked:
            insert_version(second, configuration_id, 1)
        assert isinstance(blocked.value.orig, pgerr.LockNotAvailable)
        second_tx.rollback()

        first_tx.commit()

        # Once the first commit is visible, the duplicate is a unique violation.
        second_tx = second.begin()
        with pytest.raises(IntegrityError) as dup:
            insert_version(second, configuration_id, 1)
        assert dup.value.orig.diag.constraint_name == "uq_configuration_versions_number"
        second_tx.rollback()

    with committing_engine.connect() as conn:
        assert count(conn, "configuration_versions") == 1


def test_committing_fixture_cleans_up_between_tests_a(committing_engine):
    assert counts(committing_engine) == dict.fromkeys(TABLES, 0)
    with committing_engine.begin() as conn:
        insert_workspace(conn)


def test_committing_fixture_cleans_up_between_tests_b(committing_engine):
    # Passes whether or not the test above ran first.
    assert counts(committing_engine) == dict.fromkeys(TABLES, 0)
    with committing_engine.begin() as conn:
        insert_workspace(conn)
