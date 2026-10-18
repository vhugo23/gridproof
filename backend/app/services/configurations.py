"""Read the current configuration version of a workspace (roadmap task A-05).

Every query is scoped by the authenticated workspace id. Stored data is validated by
its recorded schema version and is never repaired, reset or modified here.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import ValidationError
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.db.models import Configuration, ConfigurationVersion
from app.domain.system_config import (
    UnsupportedSchemaVersion,
    load_snapshot,
    to_snapshot,
)


class ConfigurationNotFoundError(RuntimeError):
    """The workspace has no configuration record."""


class StoredConfigurationError(RuntimeError):
    """Saved data is inconsistent or invalid (a server-side data fault)."""

    def __init__(self, reason: str, configuration_id: uuid.UUID):
        super().__init__(reason)
        self.reason = reason
        self.configuration_id = configuration_id


@dataclass(frozen=True)
class CurrentConfiguration:
    configuration_id: uuid.UUID
    name: str
    latest_version: int
    version_id: uuid.UUID
    schema_version: str
    snapshot: dict[str, Any]
    saved_at: datetime


def read_current_configuration(
    db: Session, workspace_id: uuid.UUID
) -> CurrentConfiguration:
    # One statement, so the pointer and the version it names are read consistently.
    row = db.execute(
        select(Configuration, ConfigurationVersion)
        .outerjoin(
            ConfigurationVersion,
            and_(
                ConfigurationVersion.configuration_id == Configuration.id,
                ConfigurationVersion.version_number == Configuration.latest_version,
            ),
        )
        .where(Configuration.workspace_id == workspace_id)
        .order_by(Configuration.updated_at.desc(), Configuration.id)
        .limit(1)
    ).first()
    if row is None:
        raise ConfigurationNotFoundError
    configuration, version = row

    if configuration.latest_version < 1:
        raise StoredConfigurationError("pointer_not_set", configuration.id)
    if version is None:
        raise StoredConfigurationError("pointer_version_missing", configuration.id)
    try:
        config = load_snapshot(version.schema_version, version.snapshot_json)
    except UnsupportedSchemaVersion:
        raise StoredConfigurationError(
            "unsupported_schema_version", configuration.id
        ) from None
    except ValidationError:
        raise StoredConfigurationError("invalid_snapshot", configuration.id) from None

    return CurrentConfiguration(
        configuration_id=configuration.id,
        name=configuration.name,
        latest_version=configuration.latest_version,
        version_id=version.id,
        schema_version=version.schema_version,
        snapshot=to_snapshot(config),
        saved_at=version.created_at,
    )
