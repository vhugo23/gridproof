"""Read the current configuration version of a workspace (roadmap task A-05).

Every query is scoped by the authenticated workspace id. Stored data is validated by
its recorded schema version and is never repaired, reset or modified here.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import ValidationError
from sqlalchemy import and_, func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.db.models import Configuration, ConfigurationVersion
from app.domain.system_config import (
    SCHEMA_VERSION,
    SystemConfigV1,
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


# ---------------------------------------------------------------------------
# Saving a new version (roadmap task A-06)
# ---------------------------------------------------------------------------

# Bounded waits, applied with SET LOCAL semantics so they end with the transaction.
LOCK_TIMEOUT_MS = 2000
STATEMENT_TIMEOUT_MS = 5000
_PG_LOCK_NOT_AVAILABLE = "55P03"


class VersionConflictError(RuntimeError):
    def __init__(self, current_version: int):
        super().__init__("version conflict")
        self.current_version = current_version


class SaveBusyError(RuntimeError):
    """The configuration row lock could not be acquired within the bounded wait."""


class FacilityMismatchError(RuntimeError):
    """The submitted snapshot names a different facility than the configuration."""


@dataclass(frozen=True)
class SavedVersion:
    configuration_id: uuid.UUID
    version_id: uuid.UUID
    version_number: int
    schema_version: str
    saved_at: datetime
    created: bool  # False for an approved identical replay


def save_version(
    db: Session,
    workspace_id: uuid.UUID,
    configuration_id: uuid.UUID,
    expected_version: int,
    name: str,
    config: SystemConfigV1,
) -> SavedVersion:
    """Append an immutable version under a row lock, or replay an identical save.

    Runs in the caller's session transaction and always ends it: commit on success
    (the result is returned only after the commit), rollback otherwise.
    """
    try:
        result = _save_version_locked(
            db, workspace_id, configuration_id, expected_version, name, config
        )
        db.commit()
        return result
    except DBAPIError as exc:
        db.rollback()
        if getattr(exc.orig, "sqlstate", None) == _PG_LOCK_NOT_AVAILABLE:
            raise SaveBusyError from None
        raise
    except BaseException:
        db.rollback()
        raise


def _save_version_locked(
    db: Session,
    workspace_id: uuid.UUID,
    configuration_id: uuid.UUID,
    expected_version: int,
    name: str,
    config: SystemConfigV1,
) -> SavedVersion:
    db.execute(
        text(
            "SELECT set_config('lock_timeout', :lock, true), "
            "set_config('statement_timeout', :stmt, true)"
        ),
        {"lock": f"{LOCK_TIMEOUT_MS}ms", "stmt": f"{STATEMENT_TIMEOUT_MS}ms"},
    )
    # Ownership is part of the lock query: a foreign id is indistinguishable from a
    # missing one.
    configuration = db.scalars(
        select(Configuration)
        .where(
            Configuration.id == configuration_id,
            Configuration.workspace_id == workspace_id,
        )
        .with_for_update()
    ).first()
    if configuration is None:
        raise ConfigurationNotFoundError

    latest = configuration.latest_version
    if latest < 1:
        raise StoredConfigurationError("pointer_not_set", configuration.id)
    current = db.scalars(
        select(ConfigurationVersion).where(
            ConfigurationVersion.configuration_id == configuration.id,
            ConfigurationVersion.version_number == latest,
        )
    ).first()
    if current is None:
        raise StoredConfigurationError("pointer_version_missing", configuration.id)
    try:
        current_config = load_snapshot(current.schema_version, current.snapshot_json)
    except UnsupportedSchemaVersion:
        raise StoredConfigurationError(
            "unsupported_schema_version", configuration.id
        ) from None
    except ValidationError:
        raise StoredConfigurationError("invalid_snapshot", configuration.id) from None

    if config.facility_id != configuration.facility_id:
        raise FacilityMismatchError

    if expected_version == latest:
        version = ConfigurationVersion(
            id=uuid.uuid4(),
            configuration_id=configuration.id,
            version_number=latest + 1,
            schema_version=SCHEMA_VERSION,
            snapshot_json=to_snapshot(config),
        )
        db.add(version)
        db.flush()
        # The pointer and name move only after the version exists, in this transaction.
        configuration.latest_version = version.version_number
        configuration.name = name
        configuration.updated_at = func.now()
        db.flush()
        db.refresh(version, ["created_at"])
        return SavedVersion(
            configuration_id=configuration.id,
            version_id=version.id,
            version_number=version.version_number,
            schema_version=version.schema_version,
            saved_at=version.created_at,
            created=True,
        )

    # Best-effort replay (not true request idempotency): the previous request's save
    # is the latest version and the submitted content equals what is stored.
    if (
        expected_version + 1 == latest
        and configuration.name == name
        and to_snapshot(current_config) == to_snapshot(config)
    ):
        return SavedVersion(
            configuration_id=configuration.id,
            version_id=current.id,
            version_number=current.version_number,
            schema_version=current.schema_version,
            saved_at=current.created_at,
            created=False,
        )
    raise VersionConflictError(latest)
