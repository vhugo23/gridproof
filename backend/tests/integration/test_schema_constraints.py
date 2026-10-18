"""Database-level constraints, defaults and foreign keys on real PostgreSQL.

Each test runs inside a rolled-back transaction (see db_session), so tests
are independent of execution order and leave no rows behind.
"""

import json
import uuid

import psycopg.errors as pgerr
import pytest
from db_helpers import (
    count,
    insert_configuration,
    insert_facility,
    insert_version,
    insert_workspace,
    seed_chain,
)
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError


def constraint_of(excinfo) -> str | None:
    return excinfo.value.orig.diag.constraint_name


# ---------- demo_workspaces ----------


def test_workspace_valid_insert_sets_created_at(db_session):
    workspace_id = insert_workspace(db_session)
    row = db_session.execute(
        text("SELECT created_at, expires_at FROM demo_workspaces WHERE id = :i"),
        {"i": workspace_id},
    ).one()
    assert row.created_at.tzinfo is not None
    assert row.expires_at > row.created_at


def test_workspace_token_hash_must_be_unique(db_session):
    insert_workspace(db_session, token_hash="same-hash")
    with pytest.raises(IntegrityError) as exc:
        insert_workspace(db_session, token_hash="same-hash")
    assert isinstance(exc.value.orig, pgerr.UniqueViolation)
    assert "token_hash" in constraint_of(exc)


@pytest.mark.parametrize(
    "expires_expr",
    ["now()", "now() - interval '1 day'"],
    ids=["equal-to-created", "before-created"],
)
def test_workspace_expiry_must_follow_creation(db_session, expires_expr):
    with pytest.raises(IntegrityError) as exc:
        insert_workspace(
            db_session,
            created_at_expr="now()",
            expires_at_expr=expires_expr,
        )
    assert constraint_of(exc) == "ck_workspace_expiry"


def test_workspace_expiry_one_second_after_creation_is_allowed(db_session):
    insert_workspace(db_session, expires_at_expr="now() + interval '1 second'")


def test_workspace_token_hash_not_null(db_session):
    with pytest.raises(IntegrityError) as exc:
        db_session.execute(
            text(
                "INSERT INTO demo_workspaces (id, token_hash, expires_at) "
                "VALUES (:i, NULL, now() + interval '1 day')"
            ),
            {"i": uuid.uuid4()},
        )
    assert isinstance(exc.value.orig, pgerr.NotNullViolation)


# ---------- facility_catalog ----------


def test_facility_server_defaults(db_session):
    facility_id = insert_facility(db_session)
    row = db_session.execute(
        text(
            "SELECT is_interactive, catalog_version FROM facility_catalog WHERE id = :i"
        ),
        {"i": facility_id},
    ).one()
    assert row.is_interactive is False
    assert row.catalog_version == 1


@pytest.mark.parametrize("latitude", [-90, 90, 0])
def test_facility_latitude_boundaries_allowed(db_session, latitude):
    insert_facility(db_session, latitude=latitude)


@pytest.mark.parametrize("latitude", [90.000001, -90.000001, 91, -91])
def test_facility_latitude_out_of_range_rejected(db_session, latitude):
    with pytest.raises(IntegrityError) as exc:
        insert_facility(db_session, latitude=latitude)
    assert constraint_of(exc) == "ck_facility_latitude"


@pytest.mark.parametrize("longitude", [-180, 180, 0])
def test_facility_longitude_boundaries_allowed(db_session, longitude):
    insert_facility(db_session, longitude=longitude)


@pytest.mark.parametrize("longitude", [180.000001, -180.000001, 181, -181])
def test_facility_longitude_out_of_range_rejected(db_session, longitude):
    with pytest.raises(IntegrityError) as exc:
        insert_facility(db_session, longitude=longitude)
    assert constraint_of(exc) == "ck_facility_longitude"


@pytest.mark.parametrize("version", [0, -1])
def test_facility_catalog_version_must_be_positive(db_session, version):
    with pytest.raises(IntegrityError) as exc:
        insert_facility(db_session, catalog_version=version)
    assert constraint_of(exc) == "ck_facility_catalog_version"


def test_facility_primary_key_unique(db_session):
    insert_facility(db_session, id="dup")
    with pytest.raises(IntegrityError) as exc:
        insert_facility(db_session, id="dup")
    assert isinstance(exc.value.orig, pgerr.UniqueViolation)


@pytest.mark.parametrize("column", ["source_url", "source_note", "description", "name"])
def test_facility_required_text_columns_not_null(db_session, column):
    with pytest.raises(IntegrityError) as exc:
        insert_facility(db_session, **{column: None})
    assert isinstance(exc.value.orig, pgerr.NotNullViolation)


# ---------- configurations ----------


def test_configuration_server_defaults(db_session):
    _, _, configuration_id = seed_chain(db_session)
    row = db_session.execute(
        text(
            "SELECT latest_version, created_at, updated_at FROM configurations "
            "WHERE id = :i"
        ),
        {"i": configuration_id},
    ).one()
    assert row.latest_version == 0
    assert row.created_at.tzinfo is not None
    assert row.updated_at.tzinfo is not None


def test_configuration_requires_existing_workspace(db_session):
    facility_id = insert_facility(db_session)
    with pytest.raises(IntegrityError) as exc:
        insert_configuration(db_session, uuid.uuid4(), facility_id)
    assert isinstance(exc.value.orig, pgerr.ForeignKeyViolation)


def test_configuration_requires_existing_facility(db_session):
    workspace_id = insert_workspace(db_session)
    with pytest.raises(IntegrityError) as exc:
        insert_configuration(db_session, workspace_id, "no-such-facility")
    assert isinstance(exc.value.orig, pgerr.ForeignKeyViolation)


def test_configuration_latest_version_cannot_be_negative(db_session):
    workspace_id = insert_workspace(db_session)
    facility_id = insert_facility(db_session)
    with pytest.raises(IntegrityError) as exc:
        insert_configuration(db_session, workspace_id, facility_id, latest_version=-1)
    assert constraint_of(exc) == "ck_configurations_latest_version"


@pytest.mark.parametrize("name", ["", "   "], ids=["empty", "spaces"])
def test_configuration_name_cannot_be_blank(db_session, name):
    workspace_id = insert_workspace(db_session)
    facility_id = insert_facility(db_session)
    with pytest.raises(IntegrityError) as exc:
        insert_configuration(db_session, workspace_id, facility_id, name=name)
    assert constraint_of(exc) == "ck_configurations_name"


def test_configuration_name_check_trims_spaces_only(db_session):
    """Observed behavior: PostgreSQL trim() removes spaces, not tabs/newlines.

    A tab-only name therefore passes ck_configurations_name. The API layer
    (backend validation) must reject control-character-only names; see
    docs/09-known-limitations.md.
    """
    workspace_id = insert_workspace(db_session)
    facility_id = insert_facility(db_session)
    insert_configuration(db_session, workspace_id, facility_id, name="\t\n")


def test_configuration_name_of_100_characters_allowed(db_session):
    workspace_id = insert_workspace(db_session)
    facility_id = insert_facility(db_session)
    insert_configuration(db_session, workspace_id, facility_id, name="x" * 100)


def test_configuration_name_of_101_characters_rejected(db_session):
    workspace_id = insert_workspace(db_session)
    facility_id = insert_facility(db_session)
    with pytest.raises(DBAPIError) as exc:
        insert_configuration(db_session, workspace_id, facility_id, name="x" * 101)
    assert isinstance(exc.value.orig, pgerr.StringDataRightTruncation)


# ---------- configuration_versions ----------


def test_version_valid_insert_round_trips_jsonb(db_session):
    _, _, configuration_id = seed_chain(db_session)
    snapshot = {"g1": {"startup_delay_s": 5, "enabled": True}, "tags": ["a", "b"]}
    version_id = insert_version(
        db_session, configuration_id, 1, snapshot_json=json.dumps(snapshot)
    )
    stored = db_session.execute(
        text(
            "SELECT snapshot_json, created_at FROM configuration_versions WHERE id = :i"
        ),
        {"i": version_id},
    ).one()
    assert stored.snapshot_json == snapshot
    assert stored.created_at.tzinfo is not None


@pytest.mark.parametrize("number", [0, -1])
def test_version_number_must_be_positive(db_session, number):
    _, _, configuration_id = seed_chain(db_session)
    with pytest.raises(IntegrityError) as exc:
        insert_version(db_session, configuration_id, number)
    assert constraint_of(exc) == "ck_configuration_versions_number"


def test_version_number_unique_per_configuration(db_session):
    _, _, configuration_id = seed_chain(db_session)
    insert_version(db_session, configuration_id, 1)
    with pytest.raises(IntegrityError) as exc:
        insert_version(db_session, configuration_id, 1)
    assert constraint_of(exc) == "uq_configuration_versions_number"


def test_same_version_number_allowed_in_different_configurations(db_session):
    workspace_id, facility_id, first = seed_chain(db_session)
    second = insert_configuration(db_session, workspace_id, facility_id)
    insert_version(db_session, first, 1)
    insert_version(db_session, second, 1)
    assert count(db_session, "configuration_versions") == 2


def test_version_requires_existing_configuration(db_session):
    with pytest.raises(IntegrityError) as exc:
        insert_version(db_session, uuid.uuid4(), 1)
    assert isinstance(exc.value.orig, pgerr.ForeignKeyViolation)


def test_version_snapshot_cannot_be_sql_null(db_session):
    _, _, configuration_id = seed_chain(db_session)
    with pytest.raises(IntegrityError) as exc:
        db_session.execute(
            text(
                "INSERT INTO configuration_versions "
                "(id, configuration_id, version_number, schema_version, snapshot_json) "
                "VALUES (:i, :c, 1, 'config-v1', NULL)"
            ),
            {"i": uuid.uuid4(), "c": configuration_id},
        )
    assert isinstance(exc.value.orig, pgerr.NotNullViolation)


# ---------- ON DELETE RESTRICT ----------


def test_cannot_delete_workspace_that_owns_a_configuration(db_session):
    workspace_id, _, _ = seed_chain(db_session)
    with pytest.raises(IntegrityError) as exc:
        db_session.execute(
            text("DELETE FROM demo_workspaces WHERE id = :i"), {"i": workspace_id}
        )
    assert isinstance(exc.value.orig, pgerr.ForeignKeyViolation)


def test_cannot_delete_facility_used_by_a_configuration(db_session):
    _, facility_id, _ = seed_chain(db_session)
    with pytest.raises(IntegrityError) as exc:
        db_session.execute(
            text("DELETE FROM facility_catalog WHERE id = :i"), {"i": facility_id}
        )
    assert isinstance(exc.value.orig, pgerr.ForeignKeyViolation)


def test_cannot_delete_configuration_that_has_versions(db_session):
    _, _, configuration_id = seed_chain(db_session)
    insert_version(db_session, configuration_id, 1)
    with pytest.raises(IntegrityError) as exc:
        db_session.execute(
            text("DELETE FROM configurations WHERE id = :i"), {"i": configuration_id}
        )
    assert isinstance(exc.value.orig, pgerr.ForeignKeyViolation)


def test_rows_can_be_deleted_children_first(db_session):
    workspace_id, facility_id, configuration_id = seed_chain(db_session)
    insert_version(db_session, configuration_id, 1)
    for table, key, value in [
        ("configuration_versions", "configuration_id", configuration_id),
        ("configurations", "id", configuration_id),
        ("demo_workspaces", "id", workspace_id),
        ("facility_catalog", "id", facility_id),
    ]:
        db_session.execute(text(f"DELETE FROM {table} WHERE {key} = :v"), {"v": value})
    for table in ["configuration_versions", "configurations", "demo_workspaces"]:
        assert count(db_session, table) == 0


# ---------- isolation between tests ----------


def test_rollback_fixture_leaves_no_rows_a(db_session):
    assert count(db_session, "demo_workspaces") == 0
    insert_workspace(db_session)
    assert count(db_session, "demo_workspaces") == 1


def test_rollback_fixture_leaves_no_rows_b(db_session):
    # Passes regardless of whether the test above ran first.
    assert count(db_session, "demo_workspaces") == 0
    insert_workspace(db_session)
