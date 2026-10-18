"""Alembic migration correctness against the isolated PostgreSQL database.

The expected schema below is written by hand from docs/04-database-design.md
and migrations 001/002. It is intentionally NOT derived from the SQLAlchemy
models, so a model/migration drift or a wrong migration fails a test.
"""

from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from alembic.util.exc import CommandError
from sqlalchemy import inspect, text

from app.db import models  # noqa: F401  (registers tables on Base.metadata)
from app.db.base import Base

REV_001 = "bf8e25980480"
REV_002 = "2bfd8b6ca353"
BACKEND_DIR = Path(__file__).resolve().parents[2]

UUID, TS = "UUID", "TIMESTAMP WITH TIME ZONE"

# table -> {column: (type, nullable)}
EXPECTED_COLUMNS = {
    "demo_workspaces": {
        "id": (UUID, False),
        "token_hash": ("VARCHAR(128)", False),
        "created_at": (TS, False),
        "expires_at": (TS, False),
    },
    "facility_catalog": {
        "id": ("VARCHAR(40)", False),
        "name": ("VARCHAR(160)", False),
        "city": ("VARCHAR(120)", False),
        "region": ("VARCHAR(120)", False),
        "country": ("VARCHAR(120)", False),
        "latitude": ("NUMERIC(9, 6)", False),
        "longitude": ("NUMERIC(9, 6)", False),
        "facility_type": ("VARCHAR(80)", False),
        "is_interactive": ("BOOLEAN", False),
        "description": ("TEXT", False),
        "source_url": ("TEXT", False),
        "source_note": ("TEXT", False),
        "catalog_version": ("INTEGER", False),
    },
    "configurations": {
        "id": (UUID, False),
        "workspace_id": (UUID, False),
        "facility_id": ("VARCHAR(40)", False),
        "name": ("VARCHAR(100)", False),
        "latest_version": ("INTEGER", False),
        "created_at": (TS, False),
        "updated_at": (TS, False),
    },
    "configuration_versions": {
        "id": (UUID, False),
        "configuration_id": (UUID, False),
        "version_number": ("INTEGER", False),
        "schema_version": ("VARCHAR(32)", False),
        "snapshot_json": ("JSONB", False),
        "created_at": (TS, False),
    },
}

EXPECTED_CHECKS = {
    "demo_workspaces": {"ck_workspace_expiry"},
    "facility_catalog": {
        "ck_facility_latitude",
        "ck_facility_longitude",
        "ck_facility_catalog_version",
    },
    "configurations": {"ck_configurations_latest_version", "ck_configurations_name"},
    "configuration_versions": {"ck_configuration_versions_number"},
}

# (table, column) -> expected server default as PostgreSQL stores it
EXPECTED_DEFAULTS = {
    ("demo_workspaces", "created_at"): "now()",
    ("facility_catalog", "is_interactive"): "false",
    ("facility_catalog", "catalog_version"): "1",
    ("configurations", "latest_version"): "0",
    ("configurations", "created_at"): "now()",
    ("configurations", "updated_at"): "now()",
    ("configuration_versions", "created_at"): "now()",
}

# (child table, child column) -> (parent table, parent column); all RESTRICT
EXPECTED_FKS = {
    ("configurations", "workspace_id"): ("demo_workspaces", "id"),
    ("configurations", "facility_id"): ("facility_catalog", "id"),
    ("configuration_versions", "configuration_id"): ("configurations", "id"),
}

EXPECTED_INDEXES = {
    "ix_workspaces_expiry": ("demo_workspaces", ["expires_at"], False),
    "ix_configurations_workspace_updated": (
        "configurations",
        ["workspace_id", "updated_at"],
        True,
    ),
    "ix_configuration_versions_lookup": (
        "configuration_versions",
        ["configuration_id", "version_number"],
        True,
    ),
}


def _tables(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def test_single_migration_head():
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == [REV_002]
    assert script.get_revision(REV_002).down_revision == REV_001
    assert script.get_revision(REV_001).down_revision is None


def test_upgrade_head_creates_expected_tables(blank_engine, alembic_runner):
    alembic_runner("upgrade", "head")
    assert _tables(blank_engine) == set(EXPECTED_COLUMNS) | {"alembic_version"}
    with blank_engine.connect() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version"))
        assert version.scalars().all() == [REV_002]


def test_upgrade_head_columns_match_specification(blank_engine, alembic_runner):
    alembic_runner("upgrade", "head")
    insp = inspect(blank_engine)
    for table, expected in EXPECTED_COLUMNS.items():
        actual = {
            col["name"]: (
                col["type"].compile(dialect=blank_engine.dialect),
                col["nullable"],
            )
            for col in insp.get_columns(table)
        }
        assert actual == expected, table


def test_upgrade_head_server_defaults(blank_engine, alembic_runner):
    alembic_runner("upgrade", "head")
    with blank_engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT table_name, column_name, column_default "
                "FROM information_schema.columns WHERE table_schema = 'public' "
                "AND column_default IS NOT NULL"
            )
        ).all()
    # id columns have no server default (UUIDs are generated by the app)
    actual = {(t, c): d for t, c, d in rows}
    assert actual == EXPECTED_DEFAULTS


def test_upgrade_head_constraints_match_specification(blank_engine, alembic_runner):
    alembic_runner("upgrade", "head")
    insp = inspect(blank_engine)

    for table, names in EXPECTED_CHECKS.items():
        assert {c["name"] for c in insp.get_check_constraints(table)} == names, table

    uniques = {
        (t, c["name"], tuple(c["column_names"]))
        for t in EXPECTED_COLUMNS
        for c in insp.get_unique_constraints(t)
    }
    assert (
        "configuration_versions",
        "uq_configuration_versions_number",
        ("configuration_id", "version_number"),
    ) in uniques
    assert any(
        t == "demo_workspaces" and cols == ("token_hash",) for t, _, cols in uniques
    )

    for (table, column), (parent, parent_col) in EXPECTED_FKS.items():
        fks = [
            fk
            for fk in insp.get_foreign_keys(table)
            if fk["constrained_columns"] == [column]
        ]
        assert len(fks) == 1, (table, column)
        assert fks[0]["referred_table"] == parent
        assert fks[0]["referred_columns"] == [parent_col]
        assert fks[0]["options"].get("ondelete") == "RESTRICT"

    for table in EXPECTED_COLUMNS:
        assert insp.get_pk_constraint(table)["constrained_columns"] == ["id"]


def test_upgrade_head_indexes_match_specification(blank_engine, alembic_runner):
    alembic_runner("upgrade", "head")
    with blank_engine.connect() as conn:
        defs = dict(
            conn.execute(
                text(
                    "SELECT indexname, indexdef FROM pg_indexes "
                    "WHERE schemaname = 'public'"
                )
            ).all()
        )
    for name, (table, columns, has_desc) in EXPECTED_INDEXES.items():
        assert name in defs, name
        assert f"ON public.{table}" in defs[name]
        for column in columns:
            assert column in defs[name]
        assert (" DESC" in defs[name]) is has_desc, name


def test_models_match_migrated_schema(blank_engine, alembic_runner):
    """Equivalent of `alembic check`: no drift between models and migrations."""
    alembic_runner("upgrade", "head")
    with blank_engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    assert diff == []


def test_stepwise_upgrade(blank_engine, alembic_runner):
    alembic_runner("upgrade", REV_001)
    assert _tables(blank_engine) == {
        "alembic_version",
        "demo_workspaces",
        "facility_catalog",
    }
    alembic_runner("upgrade", REV_002)
    assert _tables(blank_engine) == set(EXPECTED_COLUMNS) | {"alembic_version"}


def test_downgrade_to_001_removes_only_configuration_tables(
    blank_engine, alembic_runner
):
    alembic_runner("upgrade", "head")
    alembic_runner("downgrade", REV_001)
    assert _tables(blank_engine) == {
        "alembic_version",
        "demo_workspaces",
        "facility_catalog",
    }


def test_downgrade_base_leaves_no_application_tables(blank_engine, alembic_runner):
    alembic_runner("upgrade", "head")
    alembic_runner("downgrade", "base")
    assert _tables(blank_engine) == {"alembic_version"}
    with blank_engine.connect() as conn:
        assert (
            conn.execute(text("SELECT count(*) FROM alembic_version")).scalar_one() == 0
        )
        leftovers = (
            conn.execute(
                text("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")
            )
            .scalars()
            .all()
        )
    # Only alembic_version's own primary-key index may remain.
    assert leftovers == ["alembic_version_pkc"]


def test_upgrade_downgrade_upgrade_round_trip(blank_engine, alembic_runner):
    alembic_runner("upgrade", "head")
    alembic_runner("downgrade", "base")
    alembic_runner("upgrade", "head")
    assert _tables(blank_engine) == set(EXPECTED_COLUMNS) | {"alembic_version"}
    with blank_engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    assert diff == []


def test_upgrade_head_is_idempotent(blank_engine, alembic_runner):
    alembic_runner("upgrade", "head")
    alembic_runner("upgrade", "head")
    with blank_engine.connect() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version"))
        assert version.scalars().all() == [REV_002]


def test_unknown_revision_fails(blank_engine, alembic_runner):
    with pytest.raises(CommandError):
        alembic_runner("upgrade", "does_not_exist")
