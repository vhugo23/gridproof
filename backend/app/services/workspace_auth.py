"""Resolve the session cookie to an active workspace on protected routes (doc 05 §1).

Read-only: this never creates, renews or modifies a workspace. Only ``GET /session``
issues sessions. It reuses the A-04 cookie parsing and the A-03 token hashing.
"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import DemoWorkspace
from app.services.sessions import extract_session_token
from app.services.workspaces import hash_token


class SessionRequiredError(RuntimeError):
    """No usable session: cookie missing, malformed, duplicated or unknown."""


class WorkspaceExpiredError(RuntimeError):
    """The cookie matches an existing workspace whose fixed expiry has passed."""


def require_workspace_id(db: Session, cookie_headers: list[str]) -> uuid.UUID:
    token = extract_session_token(cookie_headers)
    if token is None:
        raise SessionRequiredError
    row = db.execute(
        select(
            DemoWorkspace.id,
            (DemoWorkspace.expires_at > func.now()).label("active"),
        ).where(DemoWorkspace.token_hash == hash_token(token))
    ).first()
    if row is None:
        raise SessionRequiredError
    if not row.active:
        raise WorkspaceExpiredError
    return row.id
