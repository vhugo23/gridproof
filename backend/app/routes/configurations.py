"""Workspace configuration routes: read the current version (doc 05 API-05) and save a
new version (API-06).

The workspace comes only from the session cookie; no route accepts a workspace
identifier. No route creates a session or issues a cookie.
"""

import json
import logging
import uuid
from datetime import UTC
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import error_response, new_request_id
from app.db.session import get_db
from app.domain.system_config import (
    ConfigurationName,
    SystemConfigV1,
    validation_details,
)
from app.services import configurations, workspace_auth

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_BODY_BYTES = 256 * 1024


class CurrentConfigurationOut(BaseModel):
    configuration_id: str
    name: str
    latest_version: int
    version_id: str
    schema_version: str
    snapshot: dict[str, Any]
    saved_at: str


@router.get(
    "/api/v1/configurations/current",
    response_model=CurrentConfigurationOut,
    responses={
        401: {"description": "SESSION_REQUIRED or WORKSPACE_EXPIRED (error envelope)"},
        404: {"description": "CONFIGURATION_NOT_FOUND (error envelope)"},
        503: {"description": "DATABASE_UNAVAILABLE (error envelope)"},
        500: {"description": "INTERNAL_ERROR (error envelope)"},
    },
)
def get_current_configuration(
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
):
    request_id = new_request_id()
    try:
        workspace_id = workspace_auth.require_workspace_id(
            db, request.headers.getlist("cookie")
        )
        current = configurations.read_current_configuration(db, workspace_id)
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
            404, "CONFIGURATION_NOT_FOUND", "No configuration was found.", request_id
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
        # Only the exception type: driver messages can contain hosts or stored hashes.
        logger.error(
            "configuration query failed: %s (request %s)",
            type(exc).__name__,
            request_id,
        )
        return _error(
            503,
            "DATABASE_UNAVAILABLE",
            "The configuration service is temporarily unavailable.",
            request_id,
        )
    except Exception as exc:  # noqa: BLE001 - scoped catch-all: unexpected errors become the 500 envelope
        logger.error(
            "configuration failed unexpectedly: %s (request %s)",
            type(exc).__name__,
            request_id,
        )
        return _internal(request_id)

    response.headers["Cache-Control"] = "no-store"
    response.headers["Vary"] = "Cookie"
    response.headers["X-Request-ID"] = request_id
    return CurrentConfigurationOut(
        configuration_id=str(current.configuration_id),
        name=current.name,
        latest_version=current.latest_version,
        version_id=str(current.version_id),
        schema_version=current.schema_version,
        snapshot=current.snapshot,
        saved_at=current.saved_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )


# ---------------------------------------------------------------------------
# POST /api/v1/configurations/{configuration_id}/versions (doc 05 API-06)
# ---------------------------------------------------------------------------


class SaveVersionRequest(BaseModel):
    """Exactly the documented body. The server decides schema_version."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    expected_version: Annotated[int, Field(strict=True, ge=0, le=2**31 - 1)]
    name: ConfigurationName
    snapshot: SystemConfigV1


class SavedVersionOut(BaseModel):
    configuration_id: str
    version_id: str
    version_number: int
    schema_version: str
    saved_at: str


class _TooLargeError(Exception):
    pass


@router.post(
    "/api/v1/configurations/{configuration_id}/versions",
    response_model=SavedVersionOut,
    status_code=201,
    responses={
        200: {
            "model": SavedVersionOut,
            "description": "Identical replay of the latest save; nothing was created",
        },
        400: {"description": "INVALID_ID (error envelope)"},
        401: {"description": "SESSION_REQUIRED or WORKSPACE_EXPIRED (error envelope)"},
        403: {"description": "FORBIDDEN: Origin not allowed (error envelope)"},
        404: {"description": "CONFIGURATION_NOT_FOUND (error envelope)"},
        409: {"description": "VERSION_CONFLICT; details has field current_version"},
        413: {"description": "PAYLOAD_TOO_LARGE (error envelope)"},
        415: {"description": "UNSUPPORTED_MEDIA_TYPE (error envelope)"},
        422: {"description": "VALIDATION_ERROR (error envelope)"},
        503: {"description": "DATABASE_UNAVAILABLE (error envelope)"},
        500: {"description": "INTERNAL_ERROR (error envelope)"},
    },
)
async def save_configuration_version(
    configuration_id: str,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
):
    request_id = new_request_id()
    try:
        if not _origin_allowed(request.headers.getlist("origin")):
            logger.warning(
                "write rejected: reason=origin_not_allowed (request %s)", request_id
            )
            return _error(403, "FORBIDDEN", "This request is not allowed.", request_id)

        workspace_id = await run_in_threadpool(
            workspace_auth.require_workspace_id, db, request.headers.getlist("cookie")
        )

        try:
            config_uuid = uuid.UUID(configuration_id)
        except ValueError:
            db.rollback()
            return _error(
                400, "INVALID_ID", "The configuration id is not valid.", request_id
            )

        if not _is_json_media_type(request.headers.get("content-type")):
            db.rollback()
            return _error(
                415,
                "UNSUPPORTED_MEDIA_TYPE",
                "Content-Type must be application/json.",
                request_id,
            )
        try:
            raw = await _read_body(request)
        except _TooLargeError:
            db.rollback()
            return _error(
                413, "PAYLOAD_TOO_LARGE", "The request body is too large.", request_id
            )

        parsed = _parse_request(raw)
        if isinstance(parsed, list):
            db.rollback()
            return _error(
                422,
                "VALIDATION_ERROR",
                "One or more fields are invalid.",
                request_id,
                details=parsed,
            )

        saved = await run_in_threadpool(
            configurations.save_version,
            db,
            workspace_id,
            config_uuid,
            parsed.expected_version,
            parsed.name,
            parsed.snapshot,
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
            404, "CONFIGURATION_NOT_FOUND", "No configuration was found.", request_id
        )
    except configurations.VersionConflictError as exc:
        return _error(
            409,
            "VERSION_CONFLICT",
            "The configuration has changed. Reload and try again.",
            request_id,
            details=[{"field": "current_version", "reason": str(exc.current_version)}],
        )
    except configurations.FacilityMismatchError:
        return _error(
            422,
            "VALIDATION_ERROR",
            "One or more fields are invalid.",
            request_id,
            details=[
                {
                    "field": "snapshot.facility_id",
                    "reason": "Must match the configuration's facility",
                }
            ],
        )
    except configurations.SaveBusyError:
        logger.error("save unavailable: reason=lock_timeout (request %s)", request_id)
        return _error(
            503,
            "DATABASE_UNAVAILABLE",
            "The configuration service is temporarily unavailable.",
            request_id,
            retry_after="5",
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
            "configuration save failed: %s (request %s)",
            type(exc).__name__,
            request_id,
        )
        return _error(
            503,
            "DATABASE_UNAVAILABLE",
            "The configuration service is temporarily unavailable.",
            request_id,
        )
    except Exception as exc:  # noqa: BLE001 - scoped catch-all: unexpected errors become the 500 envelope
        logger.error(
            "configuration save failed unexpectedly: %s (request %s)",
            type(exc).__name__,
            request_id,
        )
        return _internal(request_id)

    response.status_code = 201 if saved.created else 200
    response.headers["Cache-Control"] = "no-store"
    response.headers["Vary"] = "Cookie"
    response.headers["X-Request-ID"] = request_id
    return SavedVersionOut(
        configuration_id=str(saved.configuration_id),
        version_id=str(saved.version_id),
        version_number=saved.version_number,
        schema_version=saved.schema_version,
        saved_at=saved.saved_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )


def _allowed_origins() -> set[str]:
    raw = get_settings().frontend_origins
    return {item.strip().rstrip("/").lower() for item in raw.split(",") if item.strip()}


def _origin_allowed(origin_headers: list[str]) -> bool:
    """An Origin header, when present, must be on the configured allowlist.

    With no allowlist configured every browser origin is rejected (fail closed). A
    request without an Origin header (non-browser clients) is accepted: this is
    defense in depth, not complete CSRF protection (docs/09-known-limitations.md).
    """
    if not origin_headers:
        return True
    if len(origin_headers) != 1:
        return False
    return origin_headers[0].strip().rstrip("/").lower() in _allowed_origins()


def _is_json_media_type(content_type: str | None) -> bool:
    return (content_type or "").split(";", 1)[0].strip().lower() == "application/json"


async def _read_body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise _TooLargeError
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():  # actual bytes, whatever Content-Length says
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            raise _TooLargeError
        chunks.append(chunk)
    return b"".join(chunks)


def _reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    keys = [key for key, _ in pairs]
    if len(keys) != len(set(keys)):
        raise ValueError("duplicate key")
    return dict(pairs)


def _reject_constant(_: str) -> Any:
    raise ValueError("non-finite number")


def _parse_request(raw: bytes) -> SaveVersionRequest | list[dict[str, str]]:
    """The validated request, or doc 05 ``details`` (never echoing submitted values)."""
    try:
        data = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_reject_duplicates,
            parse_constant=_reject_constant,
        )
    except (UnicodeDecodeError, ValueError, RecursionError):
        return [{"field": "(body)", "reason": "Malformed JSON"}]
    try:
        return SaveVersionRequest.model_validate(data)
    except ValidationError as exc:
        return validation_details(exc)


def _error(
    status_code: int,
    code: str,
    message: str,
    request_id: str,
    details: list[dict[str, str]] | None = None,
    retry_after: str | None = None,
) -> JSONResponse:
    resp = error_response(
        status_code, code, message, details=details, request_id=request_id
    )
    resp.headers["Vary"] = "Cookie"
    if retry_after is not None:
        resp.headers["Retry-After"] = retry_after
    return resp


def _internal(request_id: str) -> JSONResponse:
    return _error(500, "INTERNAL_ERROR", "An unexpected error occurred.", request_id)
