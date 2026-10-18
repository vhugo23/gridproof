"""Public, read-only facility catalog (doc 05 API-03)."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import error_response, new_request_id
from app.db.models import FacilityCatalog
from app.db.session import get_db

logger = logging.getLogger(__name__)

router = APIRouter()

CACHE_CONTROL_OK = "public, max-age=300"


class FacilityOut(BaseModel):
    """Exactly the documented catalog fields; nothing else can be serialized."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: str
    name: str
    city: str
    region: str
    country: str
    latitude: float
    longitude: float
    facility_type: str
    is_interactive: bool
    description: str
    source_url: str
    source_note: str


class FacilityCatalogOut(BaseModel):
    catalog_version: int
    facilities: list[FacilityOut]


@router.get(
    "/api/v1/facilities",
    response_model=FacilityCatalogOut,
    responses={
        503: {"description": "CATALOG_UNAVAILABLE (error envelope, not cached)"},
        500: {"description": "INTERNAL_ERROR (error envelope, not cached)"},
    },
)
def list_facilities(
    response: Response,
    db: Annotated[Session, Depends(get_db)],
):
    request_id = new_request_id()
    try:
        rows = db.scalars(select(FacilityCatalog).order_by(FacilityCatalog.id)).all()
        if not rows:
            logger.error("facility catalog is empty (request %s)", request_id)
            return _unavailable(request_id)
        body = FacilityCatalogOut(
            catalog_version=max(row.catalog_version for row in rows),
            facilities=[FacilityOut.model_validate(row) for row in rows],
        )
    except SQLAlchemyError as exc:
        # Log only the exception type: driver messages can include connection details.
        logger.error(
            "facility catalog query failed: %s (request %s)",
            type(exc).__name__,
            request_id,
        )
        return _unavailable(request_id)
    except Exception as exc:  # noqa: BLE001 - scoped catch-all: unexpected errors become the 500 envelope
        logger.error(
            "facility catalog failed unexpectedly: %s (request %s)",
            type(exc).__name__,
            request_id,
        )
        return error_response(
            500,
            "INTERNAL_ERROR",
            "An unexpected error occurred.",
            request_id=request_id,
        )

    response.headers["Cache-Control"] = CACHE_CONTROL_OK
    return body


def _unavailable(request_id: str):
    return error_response(
        503,
        "CATALOG_UNAVAILABLE",
        "The facility catalog is temporarily unavailable.",
        request_id=request_id,
    )
