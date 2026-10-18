"""Current workspace configuration (doc 05 API-05).

The workspace comes only from the session cookie; the route accepts no workspace or
configuration identifier. It never creates a session and never issues a cookie.
"""

import logging
from datetime import UTC
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import error_response, new_request_id
from app.db.session import get_db
from app.services import configurations, workspace_auth

logger = logging.getLogger(__name__)

router = APIRouter()


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


def _error(status_code: int, code: str, message: str, request_id: str) -> JSONResponse:
    resp = error_response(status_code, code, message, request_id=request_id)
    resp.headers["Vary"] = "Cookie"
    return resp


def _internal(request_id: str) -> JSONResponse:
    return _error(500, "INTERNAL_ERROR", "An unexpected error occurred.", request_id)
