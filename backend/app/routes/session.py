"""Anonymous demo session bootstrap (doc 05 API-02).

Documented exception to "GET has no side effects": a request without a valid session
creates a workspace. The frontend must call it explicitly (no prefetching), and the
issuance cap bounds abuse. The plaintext token only ever travels in the HttpOnly
cookie: it is never in the JSON body, a URL or a log line.
"""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import error_response, new_request_id
from app.db.session import get_db
from app.services import sessions
from app.services.workspaces import SESSION_LIFETIME, CatalogNotSeededError

logger = logging.getLogger(__name__)

router = APIRouter()

RETRY_AFTER_RATE_LIMITED = "60"
RETRY_AFTER_BUSY = "5"


class SessionOut(BaseModel):
    workspace_id: str
    expires_at: str
    is_new: bool


@router.get(
    "/api/v1/session",
    response_model=SessionOut,
    responses={
        429: {"description": "SESSION_RATE_LIMITED (error envelope, Retry-After)"},
        503: {"description": "DATABASE_UNAVAILABLE (error envelope, not cached)"},
        500: {"description": "INTERNAL_ERROR (error envelope, not cached)"},
    },
)
def get_session(
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
):
    request_id = new_request_id()
    token = sessions.extract_session_token(request.headers.getlist("cookie"))
    try:
        result = sessions.resolve_session(db, token)
    except sessions.SessionRateLimitedError:
        logger.warning("session issuance rate limited (request %s)", request_id)
        return _error(
            429,
            "SESSION_RATE_LIMITED",
            "Too many new demo sessions were created recently. Try again shortly.",
            request_id,
            retry_after=RETRY_AFTER_RATE_LIMITED,
        )
    except sessions.SessionBusyError:
        return _unavailable("lock_timeout", request_id, retry_after=RETRY_AFTER_BUSY)
    except CatalogNotSeededError:
        return _unavailable("catalog_not_seeded", request_id)
    except SQLAlchemyError as exc:
        # Only the exception type: driver messages can contain stored hashes or hosts.
        return _unavailable(f"database_error:{type(exc).__name__}", request_id)
    except Exception as exc:  # noqa: BLE001 - scoped catch-all: unexpected errors become the 500 envelope
        logger.error(
            "session failed unexpectedly: %s (request %s)",
            type(exc).__name__,
            request_id,
        )
        return _error(
            500, "INTERNAL_ERROR", "An unexpected error occurred.", request_id
        )

    body = SessionOut(
        workspace_id=str(result.workspace_id),
        expires_at=_iso_utc(result.expires_at),
        is_new=result.is_new,
    )
    _apply_session_headers(response)
    response.headers["X-Request-ID"] = request_id
    if result.is_new:
        # Reached only after the issuing transaction committed.
        remaining = result.expires_at - datetime.now(UTC)
        response.set_cookie(
            key=sessions.COOKIE_NAME,
            value=result.token,
            max_age=max(
                1,
                min(
                    int(remaining.total_seconds()),
                    int(SESSION_LIFETIME.total_seconds()),
                ),
            ),
            path="/",
            secure=True,
            httponly=True,
            samesite="lax",
        )
    return body


def _apply_session_headers(response: Response | JSONResponse) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Vary"] = "Cookie"


def _error(
    status_code: int,
    code: str,
    message: str,
    request_id: str,
    retry_after: str | None = None,
) -> JSONResponse:
    resp = error_response(status_code, code, message, request_id=request_id)
    _apply_session_headers(resp)
    if retry_after is not None:
        resp.headers["Retry-After"] = retry_after
    return resp


def _unavailable(reason: str, request_id: str, retry_after: str | None = None):
    logger.error("session unavailable: reason=%s (request %s)", reason, request_id)
    return _error(
        503,
        "DATABASE_UNAVAILABLE",
        "The demo session service is temporarily unavailable.",
        request_id,
        retry_after=retry_after,
    )


def _iso_utc(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
