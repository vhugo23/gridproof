"""Origin allowlist check for state-changing and computed POST routes."""

from app.core.config import get_settings


def _allowed_origins() -> set[str]:
    raw = get_settings().frontend_origins
    return {item.strip().rstrip("/").lower() for item in raw.split(",") if item.strip()}


def origin_allowed(origin_headers: list[str]) -> bool:
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
