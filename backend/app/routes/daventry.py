"""Daventry workbench route (doc 05 API-17).

``POST /api/v1/demo/capacity-check`` is a pure computation over the numbers in the
request. It needs no session cookie and no database, creates nothing and sets no
cookie. The Origin allowlist is checked first, like the other POST routes.
"""

import json
import logging
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import ValidationError

from app.core.errors import new_request_id
from app.core.origin import origin_allowed
from app.domain.capacity_check import (
    CapacityCheckEvidence,
    CapacityCheckInput,
    run_capacity_check,
)
from app.domain.system_config import validation_details
from app.routes.demo import (
    _error,
    _internal,
    _is_json_media_type,
    _read_body,
    _reject_constant,
    _reject_duplicates,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post(
    "/api/v1/demo/capacity-check",
    response_model=CapacityCheckEvidence,
    responses={
        403: {"description": "FORBIDDEN: Origin not allowed (error envelope)"},
        413: {"description": "PAYLOAD_TOO_LARGE (error envelope)"},
        415: {"description": "UNSUPPORTED_MEDIA_TYPE (error envelope)"},
        422: {"description": "VALIDATION_ERROR (error envelope)"},
        500: {"description": "INTERNAL_ERROR (error envelope)"},
    },
)
async def capacity_check(request: Request, response: Response):
    request_id = new_request_id()
    try:
        if not origin_allowed(request.headers.getlist("origin")):
            logger.warning(
                "capacity-check rejected: reason=origin_not_allowed (request %s)",
                request_id,
            )
            return _error(403, "FORBIDDEN", "This request is not allowed.", request_id)

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

        evidence = await run_in_threadpool(run_capacity_check, parsed)
    except Exception as exc:  # noqa: BLE001 - scoped catch-all: unexpected errors become the 500 envelope
        logger.error(
            "capacity check failed unexpectedly: %s (request %s)",
            type(exc).__name__,
            request_id,
        )
        return _internal(request_id)

    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Request-ID"] = request_id
    return evidence


def _parse_request(raw: bytes) -> CapacityCheckInput | list[dict[str, str]]:
    try:
        data: Any = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_reject_duplicates,
            parse_constant=_reject_constant,
            # Exact decimals: 0.57 stays 0.57 instead of a binary float.
            parse_float=Decimal,
        )
    except (UnicodeDecodeError, ValueError, ArithmeticError, RecursionError):
        return [{"field": "(body)", "reason": "Malformed JSON"}]
    try:
        return CapacityCheckInput.model_validate(data)
    except ValidationError as exc:
        return validation_details(exc)
