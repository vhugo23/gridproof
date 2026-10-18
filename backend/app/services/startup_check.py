"""Run the startup-delay check against a saved, immutable configuration version.

Stateless and read-only. The equipment values come from the stored version, never
from the client. Every query is scoped by the authenticated workspace id, so a
foreign id is indistinguishable from a missing one. The database transaction is put
in read-only mode first, so this path cannot write even by mistake, and it is always
ended with a rollback.
"""

import uuid

from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db.models import Configuration, ConfigurationVersion
from app.domain.startup_check import (
    EvidenceSource,
    StartupCheckEvidence,
    run_startup_check,
)
from app.domain.system_config import UnsupportedSchemaVersion, load_snapshot
from app.services.configurations import (
    ConfigurationNotFoundError,
    StoredConfigurationError,
)

STATEMENT_TIMEOUT_MS = 5000


def startup_check_for_version(
    db: Session,
    workspace_id: uuid.UUID,
    configuration_id: uuid.UUID,
    version_number: int,
) -> StartupCheckEvidence:
    try:
        db.execute(
            text(
                "SELECT set_config('transaction_read_only', 'on', true), "
                "set_config('statement_timeout', :stmt, true)"
            ),
            {"stmt": f"{STATEMENT_TIMEOUT_MS}ms"},
        )
        version = db.scalars(
            select(ConfigurationVersion)
            .join(
                Configuration,
                Configuration.id == ConfigurationVersion.configuration_id,
            )
            .where(
                Configuration.id == configuration_id,
                Configuration.workspace_id == workspace_id,
                ConfigurationVersion.version_number == version_number,
            )
        ).first()
        if version is None:
            raise ConfigurationNotFoundError
        try:
            config = load_snapshot(version.schema_version, version.snapshot_json)
        except UnsupportedSchemaVersion:
            raise StoredConfigurationError(
                "unsupported_schema_version", configuration_id
            ) from None
        except ValidationError:
            raise StoredConfigurationError(
                "invalid_snapshot", configuration_id
            ) from None
        return run_startup_check(
            config,
            EvidenceSource(
                configuration_id=str(configuration_id),
                version_id=str(version.id),
                version_number=version.version_number,
                schema_version=version.schema_version,
            ),
        )
    finally:
        db.rollback()
