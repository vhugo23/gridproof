"""Raw-SQL row builders for constraint and transaction tests.

Raw SQL is used on purpose: it exercises the database constraints directly,
independent of any ORM default or validation.
"""

import json
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

Executor = Session | Connection


def insert_workspace(db: Executor, **overrides: Any) -> uuid.UUID:
    row = {
        "id": uuid.uuid4(),
        "token_hash": uuid.uuid4().hex,
        "created_at_expr": "now()",
        "expires_at_expr": "now() + interval '7 days'",
    }
    row.update(overrides)
    db.execute(
        text(
            "INSERT INTO demo_workspaces (id, token_hash, created_at, expires_at) "
            f"VALUES (:id, :token_hash, {row['created_at_expr']}, "
            f"{row['expires_at_expr']})"
        ),
        {"id": row["id"], "token_hash": row["token_hash"]},
    )
    return row["id"]


def insert_facility(db: Executor, **overrides: Any) -> str:
    row = {
        "id": f"f-{uuid.uuid4().hex[:12]}",
        "name": "Test Facility",
        "city": "Testville",
        "region": "TS",
        "country": "Testland",
        "latitude": 45.0,
        "longitude": -93.0,
        "facility_type": "test",
        "description": "Synthetic test facility",
        "source_url": "https://example.invalid/source",
        "source_note": "Synthetic test row",
    }
    row.update(overrides)
    columns = ", ".join(row)
    params = ", ".join(f":{key}" for key in row)
    db.execute(text(f"INSERT INTO facility_catalog ({columns}) VALUES ({params})"), row)
    return row["id"]


def insert_configuration(
    db: Executor, workspace_id: uuid.UUID, facility_id: str, **overrides: Any
) -> uuid.UUID:
    row = {
        "id": uuid.uuid4(),
        "workspace_id": workspace_id,
        "facility_id": facility_id,
        "name": "Test Configuration",
    }
    row.update(overrides)
    columns = ", ".join(row)
    params = ", ".join(f":{key}" for key in row)
    db.execute(text(f"INSERT INTO configurations ({columns}) VALUES ({params})"), row)
    return row["id"]


def insert_version(
    db: Executor, configuration_id: uuid.UUID, version_number: int = 1, **overrides: Any
) -> uuid.UUID:
    row: dict[str, Any] = {
        "id": uuid.uuid4(),
        "configuration_id": configuration_id,
        "version_number": version_number,
        "schema_version": "config-v1",
        "snapshot_json": json.dumps({"g1": {"startup_delay_s": 5}}),
    }
    row.update(overrides)
    columns = ", ".join(row)
    params = ", ".join(
        "CAST(:snapshot_json AS JSONB)" if key == "snapshot_json" else f":{key}"
        for key in row
    )
    db.execute(
        text(f"INSERT INTO configuration_versions ({columns}) VALUES ({params})"), row
    )
    return row["id"]


def seed_chain(db: Executor) -> tuple[uuid.UUID, str, uuid.UUID]:
    """Workspace + facility + configuration; returns their ids."""
    workspace_id = insert_workspace(db)
    facility_id = insert_facility(db)
    configuration_id = insert_configuration(db, workspace_id, facility_id)
    return workspace_id, facility_id, configuration_id


def count(db: Executor, table: str) -> int:
    return db.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()
