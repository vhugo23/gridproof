"""Synthetic generator-package capacity screening (Daventry workbench; doc 05 API-17).

A pure, deterministic check of one customer requirement against four fixed, invented
generator packages. It is independent of the Fridley configuration (``SystemConfigV1``),
its fixed 250 kW generators and the startup check.

For each package two requirements are judged separately and exactly:

- ``KW_CAPACITY``: required real power <= package rated kW
- ``KVA_CAPACITY``: required apparent power <= package rated kVA

where required = demand x (1 + margin / 100) and demand kVA = demand kW / power factor.
Equality passes. Verdicts use exact rational arithmetic (``Fraction``); only the
serialized display values are rounded, half up, to 2 decimals. Binary floating point
would be wrong here: 228 kW at power factor 0.57 is exactly 400 kVA, yet 228 / 0.57 in
floats is 400.00000000000006.

There is no score, ranking or recommendation. Pure domain code: no database, HTTP,
clock or randomness.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict

from app.domain.system_config import RuleError

MODEL_VERSION = "capacity-check-v1"
RATING_POWER_FACTOR = Decimal("0.8")

REAL_POWER_KW_RANGE = (1, 2000)
POWER_FACTOR_RANGE = (Decimal("0.50"), Decimal("1.00"))
CAPACITY_MARGIN_PCT_RANGE = (0, 50)

KW_REQUIREMENT_ID = "KW_CAPACITY"
KVA_REQUIREMENT_ID = "KVA_CAPACITY"


@dataclass(frozen=True)
class PackageSpec:
    id: str
    label: str
    rated_kw: int
    rated_kva: int


# Invented for GridProof. Each rated kVA is rated kW / 0.8. None is a Cummins product
# or rating, and none equals the Fridley lab's fixed 250 kW generators.
PACKAGES: tuple[PackageSpec, ...] = (
    PackageSpec("synthetic-a", "Synthetic Package A", 200, 250),
    PackageSpec("synthetic-b", "Synthetic Package B", 320, 400),
    PackageSpec("synthetic-c", "Synthetic Package C", 480, 600),
    PackageSpec("synthetic-d", "Synthetic Package D", 640, 800),
)

ASSUMPTIONS: tuple[tuple[str, str], ...] = (
    (
        "A1",
        (
            "The four packages are synthetic and invented for GridProof. They are not "
            "Cummins products, models or ratings."
        ),
    ),
    (
        "A2",
        (
            "Each package has one continuous rating, defined at a power factor of 0.8 "
            "(rated kVA = rated kW / 0.8). There is no standby or prime distinction."
        ),
    ),
    (
        "A3",
        (
            "The load is steady: constant real power at one constant lagging power "
            "factor. Step loading, motor starting and harmonics are not checked."
        ),
    ),
    (
        "A4",
        (
            "Required kW = demand kW x (1 + margin / 100); required kVA = demand kW / "
            "power factor x (1 + margin / 100). The margin applies equally to both."
        ),
    ),
    (
        "A5",
        (
            "Each requirement passes when the required value is less than or equal to "
            "the package rating (equality passes). The kW and kVA checks are judged "
            "separately."
        ),
    ),
    (
        "A6",
        (
            "Verdicts use exact rational arithmetic. Displayed values are rounded half "
            "up to 2 decimals; verdicts use the exact values."
        ),
    ),
    (
        "A7",
        (
            "Not checked: altitude or temperature derating, paralleling, fuel, cooling, "
            "noise, emissions, site or installation constraints."
        ),
    ),
    (
        "A8",
        (
            "This is a screening exercise only: not a complete sizing or compliance "
            "check, not a product recommendation and not measured performance."
        ),
    ),
)

# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------


def _whole_number(low: int, high: int) -> Any:
    def check(value: Any) -> int:
        # bool is a subclass of int; floats, strings and None are not accepted.
        if isinstance(value, bool) or not isinstance(value, int):
            raise RuleError("Must be a whole number")
        if not low <= value <= high:
            raise RuleError(f"Must be between {low} and {high}")
        return value

    return Annotated[int, BeforeValidator(check)]


def _power_factor(value: Any) -> Decimal:
    # JSON numbers arrive as int (for example 1) or exact Decimal (the request is
    # parsed with parse_float=Decimal). Strings, booleans and None are rejected.
    if isinstance(value, bool) or not isinstance(value, int | Decimal):
        raise RuleError("Must be a number")
    number = Decimal(value)
    low, high = POWER_FACTOR_RANGE
    if not number.is_finite() or not low <= number <= high:
        raise RuleError(f"Must be between {low} and {high}")
    if number != number.quantize(Decimal("0.01")):
        raise RuleError("Must have at most 2 decimal places")
    return number


RealPowerKw = _whole_number(*REAL_POWER_KW_RANGE)
CapacityMarginPct = _whole_number(*CAPACITY_MARGIN_PCT_RANGE)
PowerFactor = Annotated[Decimal, BeforeValidator(_power_factor)]
_FROZEN = ConfigDict(frozen=True, extra="forbid")


class CapacityCheckInput(BaseModel):
    """The customer requirement. All fields are validated here, on the backend."""

    model_config = _FROZEN

    real_power_kw: RealPowerKw
    power_factor: PowerFactor
    capacity_margin_pct: CapacityMarginPct = 0


# ---------------------------------------------------------------------------
# Evidence (response) models
# ---------------------------------------------------------------------------


class Assumption(BaseModel):
    model_config = _FROZEN

    id: str
    text: str


class Inputs(BaseModel):
    model_config = _FROZEN

    real_power_kw: int
    power_factor: float
    capacity_margin_pct: int


class Demand(BaseModel):
    model_config = _FROZEN

    real_power_kw: int
    apparent_power_kva: float
    required_kw: float
    required_kva: float


class Requirement(BaseModel):
    model_config = _FROZEN

    requirement_id: Literal["KW_CAPACITY", "KVA_CAPACITY"]
    status: Literal["pass", "fail"]
    comparator: Literal["<="]
    required: float
    capacity: int
    unit: Literal["kW", "kVA"]
    margin: float
    margin_pct_of_required: float
    explanation: str


class PackageResult(BaseModel):
    model_config = _FROZEN

    id: str
    label: str
    rated_kw: int
    rated_kva: int
    rated_power_factor: float
    requirements: tuple[Requirement, Requirement]
    both_requirements_pass: bool


class CapacityCheckEvidence(BaseModel):
    model_config = _FROZEN

    model_version: str
    inputs: Inputs
    demand: Demand
    assumptions: tuple[Assumption, ...]
    packages: tuple[PackageResult, ...]


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------

_CENT = Decimal("0.01")


def _display(value: Fraction) -> float:
    """Round half up to 2 decimals (ties away from zero, so -0.125 -> -0.13)."""
    exact = Decimal(value.numerator) / Decimal(value.denominator)
    # "or 0.0" turns a rounded negative zero into 0.0.
    return float(exact.quantize(_CENT, rounding=ROUND_HALF_UP)) or 0.0


def _text(value: Fraction) -> str:
    return f"{_display(value):.2f}"


def _requirement(
    requirement_id: Literal["KW_CAPACITY", "KVA_CAPACITY"],
    required: Fraction,
    capacity: int,
    unit: Literal["kW", "kVA"],
    margin_pct: int,
) -> Requirement:
    spare = capacity - required
    passed = required <= capacity
    label = "real power" if unit == "kW" else "apparent power"
    basis = "demand" if margin_pct == 0 else f"demand plus {margin_pct}% margin"
    if passed:
        explanation = (
            f"Required {label} is {_text(required)} {unit} ({basis}), within the "
            f"{capacity} {unit} rating; {_text(spare)} {unit} spare."
        )
    else:
        over = _text(-spare) if _display(-spare) > 0 else "less than 0.01"
        explanation = (
            f"Required {label} is {_text(required)} {unit} ({basis}), above the "
            f"{capacity} {unit} rating by {over} {unit}."
        )
    return Requirement(
        requirement_id=requirement_id,
        status="pass" if passed else "fail",
        comparator="<=",
        required=_display(required),
        capacity=capacity,
        unit=unit,
        margin=_display(spare),
        margin_pct_of_required=_display(spare * 100 / required),
        explanation=explanation,
    )


def run_capacity_check(request: CapacityCheckInput) -> CapacityCheckEvidence:
    kw = Fraction(request.real_power_kw)
    power_factor = Fraction(request.power_factor)
    factor = 1 + Fraction(request.capacity_margin_pct, 100)
    demand_kva = kw / power_factor
    required_kw = kw * factor
    required_kva = demand_kva * factor

    packages = []
    for spec in PACKAGES:
        kw_req = _requirement(
            KW_REQUIREMENT_ID,
            required_kw,
            spec.rated_kw,
            "kW",
            request.capacity_margin_pct,
        )
        kva_req = _requirement(
            KVA_REQUIREMENT_ID,
            required_kva,
            spec.rated_kva,
            "kVA",
            request.capacity_margin_pct,
        )
        packages.append(
            PackageResult(
                id=spec.id,
                label=spec.label,
                rated_kw=spec.rated_kw,
                rated_kva=spec.rated_kva,
                rated_power_factor=float(RATING_POWER_FACTOR),
                requirements=(kw_req, kva_req),
                both_requirements_pass=(
                    kw_req.status == "pass" and kva_req.status == "pass"
                ),
            )
        )

    return CapacityCheckEvidence(
        model_version=MODEL_VERSION,
        inputs=Inputs(
            real_power_kw=request.real_power_kw,
            power_factor=float(request.power_factor),
            capacity_margin_pct=request.capacity_margin_pct,
        ),
        demand=Demand(
            real_power_kw=request.real_power_kw,
            apparent_power_kva=_display(demand_kva),
            required_kw=_display(required_kw),
            required_kva=_display(required_kva),
        ),
        assumptions=tuple(Assumption(id=i, text=t) for i, t in ASSUMPTIONS),
        packages=tuple(packages),
    )
