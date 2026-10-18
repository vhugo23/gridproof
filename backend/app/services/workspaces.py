"""Anonymous demo workspace initialization (roadmap task A-03).

``initialize_workspace`` creates, as one unit, a workspace, the default Fridley
configuration and its immutable version 1. Transaction rules:

- The caller owns an active outer transaction and decides when to commit. The
  service never commits and never rolls back the caller's transaction.
- All of this call's work runs in a savepoint, so any failure removes every row it
  created while leaving the caller's other work in the transaction untouched.
- A call without an active transaction is rejected instead of silently starting one.

Only the SHA-256 hash of the session token is stored. The plaintext token is
returned once (for the future session endpoint's cookie) and is never logged.
"""

import hashlib
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import (
    Configuration,
    ConfigurationVersion,
    DemoWorkspace,
    FacilityCatalog,
)
from app.domain.system_config import (
    DEFAULT_CONFIGURATION_NAME,
    SCHEMA_VERSION,
    default_system_config,
    to_snapshot,
    validate_configuration_name,
)

SESSION_LIFETIME = timedelta(days=7)


class TransactionRequiredError(RuntimeError):
    """initialize_workspace needs an active outer transaction owned by the caller."""


class CatalogNotSeededError(RuntimeError):
    """The facility catalog row needed by the default configuration is missing."""


@dataclass(frozen=True)
class NewWorkspace:
    workspace_id: uuid.UUID
    configuration_id: uuid.UUID
    version_id: uuid.UUID
    expires_at: datetime
    token: str = field(repr=False)  # plaintext; return it once, never log it


def generate_token() -> str:
    """A 256-bit URL-safe random token (43 characters)."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """SHA-256 hex digest (64 characters). Sound for a high-entropy random token."""
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def initialize_workspace(session: Session) -> NewWorkspace:
    """Create workspace + default configuration + version 1 atomically."""
    if not session.in_transaction():
        raise TransactionRequiredError(
            "initialize_workspace must run inside a transaction owned by the caller."
        )

    config = default_system_config()
    name = validate_configuration_name(DEFAULT_CONFIGURATION_NAME)
    token = generate_token()

    with session.begin_nested():
        if session.get(FacilityCatalog, config.facility_id) is None:
            raise CatalogNotSeededError(
                f"Facility {config.facility_id!r} is missing from the catalog; "
                "seed the facility catalog first."
            )

        # created_at and expires_at both come from the database transaction clock, so
        # the expiry is exactly seven days after creation whatever the app clock says.
        workspace = DemoWorkspace(
            id=uuid.uuid4(),
            token_hash=hash_token(token),
            expires_at=func.now() + SESSION_LIFETIME,
        )
        session.add(workspace)
        session.flush()

        configuration = Configuration(
            id=uuid.uuid4(),
            workspace_id=workspace.id,
            facility_id=config.facility_id,
            name=name,
            latest_version=0,
        )
        session.add(configuration)
        session.flush()

        version = ConfigurationVersion(
            id=uuid.uuid4(),
            configuration_id=configuration.id,
            version_number=1,
            schema_version=SCHEMA_VERSION,
            snapshot_json=to_snapshot(config),
        )
        session.add(version)
        session.flush()

        # The pointer moves only after the version exists (same order as version saves).
        configuration.latest_version = version.version_number
        configuration.updated_at = func.now()
        session.flush()

        session.refresh(workspace, ["expires_at"])

    return NewWorkspace(
        workspace_id=workspace.id,
        configuration_id=configuration.id,
        version_id=version.id,
        expires_at=workspace.expires_at,
        token=token,
    )
