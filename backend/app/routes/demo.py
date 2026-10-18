"""Conference-demo routes (doc 05 API-16).

``POST /api/v1/demo/startup-check`` is a stateless computation over an immutable saved
configuration version. It creates nothing, persists no run and sets no cookie. The
workspace comes only from the session cookie.
"""

import json
import logging
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import error_response, new_request_id
from app.core.origin import origin_allowed
from app.db.session import get_db
from app.domain.startup_check import StartupCheckEvidence
from app.domain.system_config import validation_details
from app.services import configurations, workspace_auth
from app.services.startup_check import startup_check_for_version

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_BODY_BYTES = 4 * 1024


class StartupCheckRequest(BaseModel):
    """Identifies a saved version. Equipment values are never accepted from the client."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    configuration_id: uuid.UUID
    version_number: Annotated[int, Field(strict=True, ge=1, le=2**31 - 1)]


@router.post(
    "/api/v1/demo/startup-check",
    response_model=StartupCheckEvidence,
    responses={
        401: {"description": "SESSION_REQUIRED or WORKSPACE_EXPIRED (error envelope)"},
        403: {"description": "FORBIDDEN: Origin not allowed (error envelope)"},
        404: {"description": "CONFIGURATION_NOT_FOUND (error envelope)"},
        413: {"description": "PAYLOAD_TOO_LARGE (error envelope)"},
        415: {"description": "UNSUPPORTED_MEDIA_TYPE (error envelope)"},
        422: {"description": "VALIDATION_ERROR (error envelope)"},
        503: {"description": "DATABASE_UNAVAILABLE (error envelope)"},
        500: {"description": "INTERNAL_ERROR (error envelope)"},
    },
)
async def startup_check(
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
):
    request_id = new_request_id()
    try:
        if not origin_allowed(request.headers.getlist("origin")):
            logger.warning(
                "startup-check rejected: reason=origin_not_allowed (request %s)",
                request_id,
            )
            return _error(403, "FORBIDDEN", "This request is not allowed.", request_id)

        workspace_id = await run_in_threadpool(
            workspace_auth.require_workspace_id, db, request.headers.getlist("cookie")
        )

        if not _is_json_media_type(request.headers.get("content-type")):
            return _error(
                415,
                "UNSUPPORTED_MEDIA_TYPE",
                "Content-Type must be application/json.",
                request_id,
            )
        raw = await _read_body(request)
        if raw is None:
            return _error(
                413, "PAYLOAD_TOO_LARGE", "The request body is too large.", request_id
            )
        parsed = _parse_request(raw)
        if isinstance(parsed, list):
            return _error(
                422,
                "VALIDATION_ERROR",
                "One or more fields are invalid.",
                request_id,
                details=parsed,
            )

        evidence = await run_in_threadpool(
            startup_check_for_version,
            db,
            workspace_id,
            parsed.configuration_id,
            parsed.version_number,
        )
    except workspace_auth.SessionRequiredError:
        return _error(
            401, "SESSION_REQUIRED", "A demo session is required.", request_id
        )
    except workspace_auth.WorkspaceExpiredError:
        return _error(
            401, "WORKSPACE_EXPIRED", "The demo session has expired.", request_id
        )
    except configurations.ConfigurationNotFoundError:
        return _error(
            404,
            "CONFIGURATION_NOT_FOUND",
            "No such configuration version was found.",
            request_id,
        )
    except configurations.StoredConfigurationError as exc:
        logger.error(
            "stored configuration invalid: reason=%s configuration=%s (request %s)",
            exc.reason,
            exc.configuration_id,
            request_id,
        )
        return _internal(request_id)
    except SQLAlchemyError as exc:
        logger.error(
            "startup check failed: %s (request %s)", type(exc).__name__, request_id
        )
        return _error(
            503,
            "DATABASE_UNAVAILABLE",
            "The simulation service is temporarily unavailable.",
            request_id,
        )
    except Exception as exc:  # noqa: BLE001 - scoped catch-all: unexpected errors become the 500 envelope
        logger.error(
            "startup check failed unexpectedly: %s (request %s)",
            type(exc).__name__,
            request_id,
        )
        return _internal(request_id)

    response.headers["Cache-Control"] = "no-store"
    response.headers["Vary"] = "Cookie"
    response.headers["X-Request-ID"] = request_id
    return evidence


def _is_json_media_type(content_type: str | None) -> bool:
    return (content_type or "").split(";", 1)[0].strip().lower() == "application/json"


async def _read_body(request: Request) -> bytes | None:
    """The body bytes, or None if larger than the limit (measured on actual bytes)."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        return None
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            return None
        chunks.append(chunk)
    return b"".join(chunks)


def _reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    keys = [key for key, _ in pairs]
    if len(keys) != len(set(keys)):
        raise ValueError("duplicate key")
    return dict(pairs)


def _reject_constant(_: str) -> Any:
    raise ValueError("non-finite number")


def _parse_request(raw: bytes) -> StartupCheckRequest | list[dict[str, str]]:
    try:
        data = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_reject_duplicates,
            parse_constant=_reject_constant,
        )
    except (UnicodeDecodeError, ValueError, RecursionError):
        return [{"field": "(body)", "reason": "Malformed JSON"}]
    try:
        return StartupCheckRequest.model_validate(data)
    except ValidationError as exc:
        return validation_details(exc)


def _error(
    status_code: int,
    code: str,
    message: str,
    request_id: str,
    details: list[dict[str, str]] | None = None,
) -> JSONResponse:
    resp = error_response(
        status_code, code, message, details=details, request_id=request_id
    )
    resp.headers["Vary"] = "Cookie"
    return resp


def _internal(request_id: str) -> JSONResponse:
    return _error(500, "INTERNAL_ERROR", "An unexpected error occurred.", request_id)
