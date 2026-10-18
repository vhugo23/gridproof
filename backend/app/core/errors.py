"""Error responses in the doc 05 envelope.

Scoped helper: routes build their own error responses with it. There is
deliberately no application-wide exception handler.
"""

import uuid
from typing import Any

from fastapi.responses import JSONResponse


def new_request_id() -> str:
    return f"req_{uuid.uuid4().hex}"


def error_response(
    status_code: int,
    code: str,
    message: str,
    details: list[dict[str, Any]] | None = None,
    request_id: str | None = None,
) -> JSONResponse:
    """Doc 05 envelope. Never cached; never contains internal detail."""
    request_id = request_id or new_request_id()
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": details or [],
                "request_id": request_id,
            }
        },
        headers={
            "Cache-Control": "no-store",
            "X-Request-ID": request_id,
        },
    )
