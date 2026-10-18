"""Anonymous session resolution and issuance (roadmap task A-04, doc 05 API-02).

``resolve_session`` reuses a valid workspace or issues a new one:

- Reuse is a plain indexed read. It never takes the issuance lock, never renews the
  fixed seven-day expiry and is never limited by the issuance cap.
- Issuance runs in one transaction: bounded lock/statement timeouts (``SET LOCAL``
  semantics, so they cannot leak into the connection pool), a transaction-scoped
  advisory lock that serializes issuance, a rolling-window count of workspaces
  created in the last minute, ``initialize_workspace`` and the commit. The lock is
  released by the commit or rollback. The token is returned only after the commit
  succeeded, so a caller can set the cookie safely.

The cap is global: behind Vercel and Render there is no trustworthy client address.
The window is measured with the database's transaction clock (``now()``), the same
clock that stamps ``created_at``.

Tokens, their hashes and cookie headers are never logged here.
"""

import hashlib
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.db.models import DemoWorkspace
from app.services.workspaces import hash_token, initialize_workspace

COOKIE_NAME = "gridproof_demo"

# Issuance cap: at most ISSUANCE_LIMIT new workspaces per rolling ISSUANCE_WINDOW_SECONDS.
# Module attributes (read at call time) so tests can lower them.
ISSUANCE_LIMIT = 120
ISSUANCE_WINDOW_SECONDS = 60
LOCK_TIMEOUT_MS = 2000
STATEMENT_TIMEOUT_MS = 5000

# Arbitrary fixed 64-bit key for the issuance advisory lock.
ISSUANCE_LOCK_KEY = int.from_bytes(
    hashlib.sha256(b"gridproof:session-issuance").digest()[:8], "big", signed=True
)

_TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{43}")  # secrets.token_urlsafe(32)
_PG_LOCK_NOT_AVAILABLE = "55P03"


class SessionRateLimitedError(RuntimeError):
    """The rolling-window issuance cap is reached."""


class SessionBusyError(RuntimeError):
    """The issuance lock could not be acquired within the bounded wait."""


@dataclass(frozen=True)
class SessionResult:
    workspace_id: uuid.UUID
    expires_at: datetime
    is_new: bool
    token: str | None = field(default=None, repr=False)  # set only when is_new


def extract_session_token(cookie_headers: list[str]) -> str | None:
    """The well-formed token from the Cookie header(s), or None.

    None means "no usable session": the cookie is absent, malformed, or present more
    than once (no value is chosen arbitrarily).
    """
    values = []
    for header in cookie_headers:
        for part in header.split(";"):
            name, sep, value = part.strip().partition("=")
            if sep and name == COOKIE_NAME:
                values.append(value)
    if len(values) != 1 or not _TOKEN_RE.fullmatch(values[0]):
        return None
    return values[0]


def resolve_session(db: Session, token: str | None) -> SessionResult:
    """Reuse the workspace for ``token`` or issue a new one (committed on return)."""
    if token is not None:
        row = db.execute(
            select(DemoWorkspace.id, DemoWorkspace.expires_at).where(
                DemoWorkspace.token_hash == hash_token(token),
                DemoWorkspace.expires_at > func.now(),
            )
        ).first()
        db.rollback()  # end the read-only transaction; issuance starts its own
        if row is not None:
            return SessionResult(
                workspace_id=row.id, expires_at=row.expires_at, is_new=False
            )
    return _issue(db)


def _issue(db: Session) -> SessionResult:
    try:
        with db.begin():
            db.execute(
                text(
                    "SELECT set_config('lock_timeout', :lock, true), "
                    "set_config('statement_timeout', :stmt, true)"
                ),
                {"lock": f"{LOCK_TIMEOUT_MS}ms", "stmt": f"{STATEMENT_TIMEOUT_MS}ms"},
            )
            db.execute(
                text("SELECT pg_advisory_xact_lock(:key)"), {"key": ISSUANCE_LOCK_KEY}
            )
            recent = db.scalar(
                select(func.count())
                .select_from(DemoWorkspace)
                .where(
                    DemoWorkspace.created_at
                    > func.now()
                    - text(f"interval '{int(ISSUANCE_WINDOW_SECONDS)} seconds'")
                )
            )
            if recent >= ISSUANCE_LIMIT:
                raise SessionRateLimitedError
            new = initialize_workspace(db)
        # Leaving the block committed the transaction (and released the lock).
    except DBAPIError as exc:
        if getattr(exc.orig, "sqlstate", None) == _PG_LOCK_NOT_AVAILABLE:
            raise SessionBusyError from None
        raise
    return SessionResult(
        workspace_id=new.workspace_id,
        expires_at=new.expires_at,
        is_new=True,
        token=new.token,
    )
