"""SystemConfigV1: the validated, immutable configuration snapshot (task A-02).

Contract: docs/05-api-contracts.md (SystemConfigV1) and docs/04-database-design.md
(``config-v1``). Pure domain code: no database, no HTTP.

V1 rules
- Fixed values (must equal the V1 value): facility, rated/inverter/usable sizes,
  ``battery.min_soc_pct``, ``utility.available``, ``switchgear.mode`` and the exact
  set of equipment ids.
- Editable: ``g1/g2.startup_delay_s`` (0..120), ``g1/g2.enabled``,
  ``battery.initial_soc_pct`` (0..100 and >= ``min_soc_pct``) and
  ``load.critical_kw`` (1..500).
- Numbers are strict integers: booleans, floats, strings and non-finite values are
  rejected. Unknown or missing fields are rejected.
- ``load.critical_kw`` is the *baseline* critical load. Demand changes during a
  simulation come from future ``set_load_kw`` scenario events; the load-bank
  visualization shows that simulated demand, so V1 has no load-bank field.

All models are frozen and contain no mutable containers.
"""

import unicodedata
from typing import Annotated, Any

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    StrictBool,
    ValidationError,
    ValidationInfo,
    field_validator,
)

SCHEMA_VERSION = "config-v1"
DEFAULT_CONFIGURATION_NAME = "Fridley Test Configuration"

MAX_NAME_LENGTH = 100


class RuleError(ValueError):
    """A violated V1 rule. Its message is safe to show: it never contains input."""


# ---------------------------------------------------------------------------
# Field types
# ---------------------------------------------------------------------------


def _require_int(value: Any) -> int:
    # bool is a subclass of int; floats (even 5.0), strings and None are not accepted.
    if isinstance(value, bool) or not isinstance(value, int):
        raise RuleError("Must be a whole number")
    return value


def _bounded_int(low: int, high: int) -> Any:
    def check(value: int) -> int:
        if not low <= value <= high:
            raise RuleError(f"Must be between {low} and {high}")
        return value

    return Annotated[int, BeforeValidator(_require_int), AfterValidator(check)]


def _fixed_int(expected: int) -> Any:
    def check(value: int) -> int:
        if value != expected:
            raise RuleError(f"Must be {expected} (fixed in V1)")
        return value

    return Annotated[int, BeforeValidator(_require_int), AfterValidator(check)]


def _fixed_str(expected: str) -> Any:
    def require_str(value: Any) -> str:
        if not isinstance(value, str):
            raise RuleError(f"Must be '{expected}' (fixed in V1)")
        return value

    def check(value: str) -> str:
        if value != expected:
            raise RuleError(f"Must be '{expected}' (fixed in V1)")
        return value

    return Annotated[str, BeforeValidator(require_str), AfterValidator(check)]


def _require_true(value: Any) -> bool:
    if value is not True:
        raise RuleError("Must be true (fixed in V1)")
    return value


StartupDelaySeconds = _bounded_int(0, 120)
SocPercent = _bounded_int(0, 100)
CriticalKw = _bounded_int(1, 500)
FixedTrue = Annotated[bool, BeforeValidator(_require_true)]


def _require_bool(value: Any) -> bool:
    if not isinstance(value, bool):
        raise RuleError("Must be true or false")
    return value


EditableBool = Annotated[StrictBool, BeforeValidator(_require_bool)]

_MODEL_CONFIG = ConfigDict(frozen=True, extra="forbid")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class Generator(BaseModel):
    model_config = _MODEL_CONFIG

    rated_kw: _fixed_int(250)
    startup_delay_s: StartupDelaySeconds
    enabled: EditableBool


class Battery(BaseModel):
    model_config = _MODEL_CONFIG

    inverter_kw: _fixed_int(250)
    usable_kwh: _fixed_int(500)
    # min_soc_pct is declared before initial_soc_pct so the cross-field check below
    # can read it and report the error on initial_soc_pct.
    min_soc_pct: _fixed_int(20)
    initial_soc_pct: SocPercent

    @field_validator("initial_soc_pct")
    @classmethod
    def _not_below_minimum(cls, value: int, info: ValidationInfo) -> int:
        minimum = info.data.get("min_soc_pct")
        if minimum is not None and value < minimum:
            raise RuleError(f"Must be at least the minimum SOC ({minimum})")
        return value


class Utility(BaseModel):
    model_config = _MODEL_CONFIG

    available: FixedTrue


class Switchgear(BaseModel):
    model_config = _MODEL_CONFIG

    mode: _fixed_str("auto")


class Load(BaseModel):
    """Baseline critical load. Demand changes are simulation events, not config."""

    model_config = _MODEL_CONFIG

    critical_kw: CriticalKw


class Equipment(BaseModel):
    model_config = _MODEL_CONFIG

    g1: Generator
    g2: Generator
    battery: Battery
    utility: Utility
    switchgear: Switchgear
    load: Load


class SystemConfigV1(BaseModel):
    model_config = _MODEL_CONFIG

    facility_id: _fixed_str("fridley")
    equipment: Equipment


# ---------------------------------------------------------------------------
# Canonical default, snapshots and error details
# ---------------------------------------------------------------------------


def default_system_config() -> SystemConfigV1:
    """The seeded Fridley configuration (synthetic values; G1 startup delay 5 s)."""
    return SystemConfigV1(
        facility_id="fridley",
        equipment=Equipment(
            g1=Generator(rated_kw=250, startup_delay_s=5, enabled=True),
            g2=Generator(rated_kw=250, startup_delay_s=5, enabled=True),
            battery=Battery(
                inverter_kw=250, usable_kwh=500, min_soc_pct=20, initial_soc_pct=80
            ),
            utility=Utility(available=True),
            switchgear=Switchgear(mode="auto"),
            load=Load(critical_kw=180),
        ),
    )


def to_snapshot(config: SystemConfigV1) -> dict[str, Any]:
    """JSON-safe dict for the ``snapshot_json`` column (a fresh copy each call)."""
    return config.model_dump(mode="json")


def from_snapshot(data: object) -> SystemConfigV1:
    """Validate stored or received data. Raises pydantic.ValidationError."""
    return SystemConfigV1.model_validate(data)


class UnsupportedSchemaVersion(ValueError):
    """A stored snapshot names a schema version this code does not implement."""


def load_snapshot(schema_version: str, data: object) -> SystemConfigV1:
    """Validate a stored snapshot by its recorded ``schema_version``.

    Historical snapshots are never reinterpreted with newer rules: a version this
    module does not implement is an error, not a best-effort parse.
    """
    if schema_version != SCHEMA_VERSION:
        raise UnsupportedSchemaVersion(
            f"Unsupported configuration schema version: {schema_version!r}"
        )
    return from_snapshot(data)


_FALLBACK_REASON = "Invalid value"


def _reason(error: dict[str, Any]) -> str:
    kind = error["type"]
    if kind == "missing":
        return "Required"
    if kind == "extra_forbidden":
        return "Unknown field"
    if kind in ("model_type", "dict_type", "model_attributes_type"):
        return "Must be an object"
    if kind in ("bool_type", "bool_parsing"):
        return "Must be true or false"
    if kind == "value_error":
        cause = error.get("ctx", {}).get("error")
        if isinstance(cause, RuleError):
            return str(cause)
    # Never fall back to pydantic's message: it can quote the input value.
    return _FALLBACK_REASON


def validation_details(error: ValidationError) -> list[dict[str, str]]:
    """Doc 05 ``details``: ``[{"field": "equipment.g1.startup_delay_s", "reason": ...}]``."""
    return [
        {
            "field": ".".join(str(part) for part in item["loc"]) or "(root)",
            "reason": _reason(item),
        }
        for item in error.errors(
            include_url=False, include_context=True, include_input=False
        )
    ]


# ---------------------------------------------------------------------------
# Configuration name
# ---------------------------------------------------------------------------


def validate_configuration_name(value: object) -> str:
    """Return the trimmed name, or raise RuleError.

    Stricter than the ``ck_configurations_name`` database check, whose ``trim()``
    removes spaces only (a tab-only name passes it). Rejects control characters,
    names without a visible character, and names over 100 characters.
    """
    if not isinstance(value, str):
        raise RuleError("Must be text")
    name = value.strip()
    if not 1 <= len(name) <= MAX_NAME_LENGTH:
        raise RuleError(f"Must be 1 to {MAX_NAME_LENGTH} characters")
    categories = [unicodedata.category(char) for char in name]
    if any(category in ("Cc", "Cs") for category in categories):
        raise RuleError("Must not contain control characters")
    if not any(category[0] in "LNPS" for category in categories):
        raise RuleError("Must contain a visible character")
    return name


ConfigurationName = Annotated[str, BeforeValidator(validate_configuration_name)]
