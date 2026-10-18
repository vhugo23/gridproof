"""SystemConfigV1 snapshots and configuration names against real PostgreSQL."""

import json

import pytest
from db_helpers import insert_configuration, insert_version, insert_workspace
from sqlalchemy import text

from app.domain.system_config import (
    DEFAULT_CONFIGURATION_NAME,
    SCHEMA_VERSION,
    default_system_config,
    from_snapshot,
    load_snapshot,
    to_snapshot,
    validate_configuration_name,
)
from app.seed.facilities import seed_facilities


def stored_snapshot(db, version_id):
    return db.execute(
        text(
            "SELECT snapshot_json, schema_version FROM configuration_versions WHERE id = :i"
        ),
        {"i": version_id},
    ).one()


def test_default_snapshot_round_trips_through_jsonb(db_session):
    seed_facilities(db_session)
    config = default_system_config()
    configuration_id = insert_configuration(
        db_session,
        insert_workspace(db_session),
        config.facility_id,
        name=DEFAULT_CONFIGURATION_NAME,
    )
    version_id = insert_version(
        db_session,
        configuration_id,
        1,
        schema_version=SCHEMA_VERSION,
        snapshot_json=json.dumps(to_snapshot(config)),
    )

    row = stored_snapshot(db_session, version_id)

    assert row.schema_version == "config-v1"
    assert row.snapshot_json == to_snapshot(config)
    assert load_snapshot(row.schema_version, row.snapshot_json) == config


def test_edited_snapshot_round_trips_and_keeps_integer_types(db_session):
    seed_facilities(db_session)
    snapshot = to_snapshot(default_system_config())
    snapshot["equipment"]["g1"]["startup_delay_s"] = 15
    configuration_id = insert_configuration(
        db_session, insert_workspace(db_session), "fridley"
    )
    version_id = insert_version(
        db_session, configuration_id, 2, snapshot_json=json.dumps(snapshot)
    )

    loaded = from_snapshot(stored_snapshot(db_session, version_id).snapshot_json)

    assert loaded.equipment.g1.startup_delay_s == 15
    assert type(loaded.equipment.g1.startup_delay_s) is int
    assert loaded.equipment.g2.startup_delay_s == 5


def test_default_facility_id_is_a_seeded_catalog_row(db_session):
    seed_facilities(db_session)
    ids = db_session.execute(text("SELECT id FROM facility_catalog")).scalars().all()
    assert default_system_config().facility_id in ids


def test_default_facility_is_the_interactive_one(db_session):
    seed_facilities(db_session)
    interactive = (
        db_session.execute(text("SELECT id FROM facility_catalog WHERE is_interactive"))
        .scalars()
        .all()
    )
    assert interactive == [default_system_config().facility_id]


@pytest.mark.parametrize(
    "name",
    [
        DEFAULT_CONFIGURATION_NAME,
        "x",
        "x" * 100,
        "  padded  ",
        "Résumé 配置 ⚡",
        "---",
        " em-space padded ",
    ],
)
def test_every_accepted_name_satisfies_the_database_constraints(db_session, name):
    seed_facilities(db_session)
    accepted = validate_configuration_name(name)
    insert_configuration(
        db_session, insert_workspace(db_session), "fridley", name=accepted
    )


@pytest.mark.parametrize("name", ["\t\n", "\n", "line\nbreak"])
def test_validator_closes_the_gap_the_database_check_leaves(db_session, name):
    """The database accepts these (trim() removes spaces only); the validator does not."""
    seed_facilities(db_session)
    insert_configuration(db_session, insert_workspace(db_session), "fridley", name=name)
    with pytest.raises(ValueError):
        validate_configuration_name(name)
