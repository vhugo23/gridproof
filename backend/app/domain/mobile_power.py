"""Mobile-site power planner (temporary mobile-powered site; doc 05 API-19).

A pure, deterministic calculation over the named electrical loads a user enters for a
temporary site. It models the site's electrical demand, not a truck or trailer, and
compares the result with four fixed, invented mobile power packages. It uses no
equipment data of any kind.

Per load: connected kW = quantity x rated kW; demand kW = connected kW x simultaneity
factor. For the site, with a capacity margin in percent:

- connected load            = sum of connected kW
- modeled demand            = sum of demand kW
- overall simultaneity      = modeled demand / connected load x 100
- required capacity         = modeled demand x (1 + margin / 100)
- all-simultaneous capacity = connected load x (1 + margin / 100)
- share of demand           = load demand / modeled demand x 100

Each package is compared on its rated kW with both requirements; equality passes. The
all-simultaneous comparison is a sensitivity check on the user's simultaneity factors,
which are planning assumptions entered by the user, not measurements.

Every engineering value and every comparison uses exact rational arithmetic
(``Fraction``); only the serialized values are rounded, half up, to 2 decimals. A
requirement that displays as equal to a rating can therefore still fail, and the
explanation says so. Pure domain code: no database, HTTP, clock or randomness.
"""

import unicodedata
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict

from app.domain.system_config import RuleError

MODEL_VERSION = "mobile-power-v1"

MAX_LOADS = 12
MAX_NAME_LENGTH = 40
QUANTITY_RANGE = (1, 100)
MAX_RATED_KW = 500
SIMULTANEITY_RANGE = (Decimal("0.01"), Decimal("1.00"))
CAPACITY_MARGIN_PCT_RANGE = (0, 50)
MAX_CONNECTED_KW = 2_000

NOT_MET = "does_not_meet_modeled"
MODELED_ONLY = "meets_modeled_only"
BOTH = "meets_modeled_and_all_simultaneous"

CATEGORY_LABELS = {
    NOT_MET: "Does not meet modeled demand",
    MODELED_ONLY: "Meets modeled demand only",
    BOTH: "Meets both modeled and all-simultaneous demand",
}


@dataclass(frozen=True)
class PackageSpec:
    id: str
    label: str
    rated_kw: int


# Invented for GridProof. None is a Cummins product or rating, and none equals a
# Daventry capacity-check package or the Fridley lab's fixed 250 kW generators.
PACKAGES: tuple[PackageSpec, ...] = (
    PackageSpec("mobile-m1", "Synthetic Mobile Package M1", 30),
    PackageSpec("mobile-m2", "Synthetic Mobile Package M2", 60),
    PackageSpec("mobile-m3", "Synthetic Mobile Package M3", 100),
    PackageSpec("mobile-m4", "Synthetic Mobile Package M4", 150),
)

ASSUMPTIONS: tuple[tuple[str, str], ...] = (
    (
        "A1",
        (
            "The four packages are synthetic and invented for GridProof. They are not "
            "Cummins products, models or ratings, and the trailer-mounted source "
            "they stand for is illustrative: only the site's electrical demand is "
            "modeled, not a truck or trailer."
        ),
    ),
    (
        "A2",
        (
            "Every load name, quantity, rated kW and simultaneity factor is entered "
            "by the user. A simultaneity factor is a user-entered planning "
            "assumption: your judgment of the fraction of that load group running at "
            "the same time. It is not a measured peak concurrency or a physical "
            "operating schedule, and the model cannot check it."
        ),
    ),
    (
        "A3",
        (
            "The model screens steady-state real power (kW) only. It does not "
            "validate kVA, power factor, voltage, motor starting, step loading, "
            "derating, protection, fuel, emissions or full equipment suitability."
        ),
    ),
    (
        "A4",
        (
            "Connected kW = quantity x rated kW; demand kW = connected kW x "
            "simultaneity factor. Modeled demand is the sum of demand kW; required "
            "capacity = modeled demand x (1 + margin / 100)."
        ),
    ),
    (
        "A5",
        (
            "The all-simultaneous requirement is the sensitivity case in which every "
            "load runs at once (every simultaneity factor 1.00): connected load x "
            "(1 + margin / 100). The same margin applies to both requirements."
        ),
    ),
    (
        "A6",
        (
            "Each package has one continuous kW rating. A requirement is met when it "
            "is less than or equal to the rating (equality passes). Each package "
            "falls in one of three neutral categories: it does not meet modeled "
            "demand, meets modeled demand only, or meets both modeled and "
            "all-simultaneous demand."
        ),
    ),
    (
        "A7",
        (
            "All calculations and comparisons use exact rational arithmetic. "
            "Displayed values are rounded half up to 2 decimals, so a requirement "
            "that displays as equal to a rating can still exceed it, and displayed "
            "shares can add up to slightly more or less than 100%."
        ),
    ),
    (
        "A8",
        (
            "There is no score, ranking or recommendation, and no package "
            "selection. This is a screening exercise only, not a sizing or "
            "compliance check and not measured performance."
        ),
    ),
)

# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------


def _decimal(
    low: Decimal | int, high: Decimal | int, *, low_exclusive: bool, message: str
) -> Any:
    def check(value: Any) -> Decimal:
        # JSON numbers arrive as int or exact Decimal (parse_float=Decimal);
        # strings, booleans and None are rejected.
        if isinstance(value, bool) or not isinstance(value, int | Decimal):
            raise RuleError("Must be a number")
        number = Decimal(value)
        # Finiteness first: ordering comparisons on NaN raise instead of returning.
        if not number.is_finite():
            raise RuleError(message)
        too_low = number <= low if low_exclusive else number < low
        if too_low or number > high:
            raise RuleError(message)
        if number != number.quantize(Decimal("0.01")):
            raise RuleError("Must have at most 2 decimal places")
        return number

    return Annotated[Decimal, BeforeValidator(check)]


RatedKw = _decimal(
    0,
    MAX_RATED_KW,
    low_exclusive=True,
    message=f"Must be greater than 0 and at most {MAX_RATED_KW}",
)
SimultaneityFactor = _decimal(
    SIMULTANEITY_RANGE[0],
    SIMULTANEITY_RANGE[1],
    low_exclusive=False,
    message="Must be between 0.01 and 1.00",
)


def _whole_number(low: int, high: int) -> Any:
    def check(value: Any) -> int:
        # bool is a subclass of int; floats, strings and None are not accepted.
        if isinstance(value, bool) or not isinstance(value, int):
            raise RuleError("Must be a whole number")
        if not low <= value <= high:
            raise RuleError(f"Must be between {low} and {high}")
        return value

    return Annotated[int, BeforeValidator(check)]


Quantity = _whole_number(*QUANTITY_RANGE)
CapacityMarginPct = _whole_number(*CAPACITY_MARGIN_PCT_RANGE)


def _load_name(value: Any) -> str:
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


def _load_list(value: Any) -> Any:
    if not isinstance(value, list):
        raise RuleError("Must be a list of loads")
    if not 1 <= len(value) <= MAX_LOADS:
        raise RuleError(f"Must contain 1 to {MAX_LOADS} loads")
    return value


_FROZEN = ConfigDict(frozen=True, extra="forbid")


class LoadInput(BaseModel):
    model_config = _FROZEN

    name: Annotated[str, BeforeValidator(_load_name)]
    quantity: Quantity
    rated_kw: RatedKw
    simultaneity_factor: SimultaneityFactor


class MobilePowerInput(BaseModel):
    """The user's site loads. All fields are validated here, on the backend."""

    model_config = _FROZEN

    loads: Annotated[tuple[LoadInput, ...], BeforeValidator(_load_list)]
    capacity_margin_pct: CapacityMarginPct = 0


def cross_field_errors(request: MobilePowerInput) -> list[dict[str, str]]:
    """Rules that span fields, as doc 05 ``details``; empty when the input is valid.

    Reasons never repeat submitted values.
    """
    errors: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, load in enumerate(request.loads):
        key = load.name.casefold()
        if key in seen:
            errors.append(
                {
                    "field": f"loads.{index}.name",
                    "reason": "Must be different from the other load names",
                }
            )
        seen.add(key)

    connected = sum(
        (Fraction(load.quantity) * Fraction(load.rated_kw) for load in request.loads),
        Fraction(0),
    )
    if connected > MAX_CONNECTED_KW:
        errors.append(
            {
                "field": "loads",
                "reason": (
                    f"Total connected load must not exceed {MAX_CONNECTED_KW:,} kW; "
                    "reduce quantities or rated power"
                ),
            }
        )
    return errors


# ---------------------------------------------------------------------------
# Evidence (response) models
# ---------------------------------------------------------------------------


class Assumption(BaseModel):
    model_config = _FROZEN

    id: str
    text: str


class InputLoad(BaseModel):
    model_config = _FROZEN

    name: str
    quantity: int
    rated_kw: float
    simultaneity_factor: float


class Inputs(BaseModel):
    model_config = _FROZEN

    loads: tuple[InputLoad, ...]
    capacity_margin_pct: int


class LoadResult(BaseModel):
    model_config = _FROZEN

    id: str
    name: str
    quantity: int
    rated_kw: float
    simultaneity_factor: float
    connected_kw: float
    demand_kw: float
    share_of_demand_pct: float
    is_dominant: bool


class Totals(BaseModel):
    model_config = _FROZEN

    connected_kw: float
    demand_kw: float
    overall_simultaneity_pct: float
    required_kw: float
    all_simultaneous_required_kw: float


class Comparison(BaseModel):
    model_config = _FROZEN

    status: Literal["meets", "does_not_meet"]
    comparator: Literal["<="]
    required: float
    capacity: float
    headroom_kw: float
    utilization_pct: float


class PackageResult(BaseModel):
    model_config = _FROZEN

    id: str
    label: str
    rated_kw: int
    modeled_demand: Comparison
    all_simultaneous: Comparison
    category: Literal[
        "does_not_meet_modeled",
        "meets_modeled_only",
        "meets_modeled_and_all_simultaneous",
    ]
    category_label: str
    explanation: str


class MobilePowerEvidence(BaseModel):
    model_config = _FROZEN

    model_version: str
    inputs: Inputs
    loads: tuple[LoadResult, ...]
    totals: Totals
    dominant_load_ids: tuple[str, ...]
    packages: tuple[PackageResult, ...]
    explanation: str
    assumptions: tuple[Assumption, ...]


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------

_CENT = Decimal("0.01")


def _display(value: Fraction) -> float:
    """Round half up to 2 decimals; never negative zero (headroom can round to it)."""
    exact = Decimal(value.numerator) / Decimal(value.denominator)
    rounded = exact.quantize(_CENT, rounding=ROUND_HALF_UP)
    return 0.0 if rounded == 0 else float(rounded)


def _text(value: Fraction) -> str:
    return f"{_display(value):.2f}"


def _join(names: list[str]) -> str:
    if len(names) <= 2:
        return " and ".join(names)
    return ", ".join(names[:-1]) + " and " + names[-1]


def _by(excess: Fraction) -> str:
    """'by 9.00 kW', or 'by less than 0.01 kW' when the excess rounds to zero."""
    if _display(excess) == 0:
        return "by less than 0.01 kW"
    return f"by {_text(excess)} kW"


def _compare(required: Fraction, capacity: int) -> tuple[Comparison, Fraction]:
    cap = Fraction(capacity)
    headroom = cap - required
    comparison = Comparison(
        status="meets" if required <= cap else "does_not_meet",
        comparator="<=",
        required=_display(required),
        capacity=_display(cap),
        headroom_kw=_display(headroom),
        utilization_pct=_display(required * 100 / cap),
    )
    return comparison, headroom


def _package_explanation(
    category: str,
    spec: PackageSpec,
    required: Fraction,
    bound: Fraction,
    modeled_headroom: Fraction,
    bound_headroom: Fraction,
    modeled: Comparison,
    sensitivity: Comparison,
) -> str:
    rating = f"{spec.rated_kw:.2f} kW"
    if category == BOTH:
        return (
            f"The required {_text(required)} kW is within the {rating} rating "
            f"({_text(modeled_headroom)} kW headroom, {modeled.utilization_pct:.2f}% "
            f"utilization), and so is the all-simultaneous {_text(bound)} kW "
            f"({_text(bound_headroom)} kW headroom, "
            f"{sensitivity.utilization_pct:.2f}% utilization)."
        )
    if category == MODELED_ONLY:
        return (
            f"The required {_text(required)} kW is within the {rating} rating "
            f"({_text(modeled_headroom)} kW headroom, {modeled.utilization_pct:.2f}% "
            f"utilization), but the all-simultaneous {_text(bound)} kW exceeds it "
            f"{_by(-bound_headroom)}. It meets modeled demand only because of the "
            "simultaneity factors you entered."
        )
    if _display(-modeled_headroom) == 0:
        return (
            f"The required {_text(required)} kW is above the {rating} rating by "
            "less than 0.01 kW. The comparison uses exact values, so this package "
            "does not meet modeled demand even though both display as "
            f"{rating}."
        )
    return (
        f"The required {_text(required)} kW exceeds the {rating} rating "
        f"{_by(-modeled_headroom)} ({modeled.utilization_pct:.2f}% utilization), "
        "so this package does not meet modeled demand."
    )


def _explain(
    names: list[str],
    dominant: list[int],
    demands: list[Fraction],
    connected: Fraction,
    demand: Fraction,
    margin: int,
    required: Fraction,
    bound: Fraction,
    any_package_meets: bool,
) -> str:
    first = dominant[0]
    amount = (
        f"{_text(demands[first])} kW of {_text(demand)} kW "
        f"({_text(demands[first] * 100 / demand)}% of modeled demand)"
    )
    if len(dominant) == 1:
        text = f"The load with the most modeled demand is {names[first]}: {amount}."
    else:
        text = (
            f"{_join([names[i] for i in dominant])} tie for the most modeled "
            f"demand, each with {amount}."
        )
    text += (
        f" Connected load is {_text(connected)} kW; at the simultaneity factors you "
        f"entered, modeled demand is {_text(demand)} kW "
        f"({_text(demand * 100 / connected)}% of connected load), or "
        f"{_text(required)} kW with the {margin}% margin. This follows from your "
        "simultaneity assumptions; it is not a measured or guaranteed peak. If "
        f"every load ran at once, the requirement would be {_text(bound)} kW."
    )
    if not any_package_meets:
        text += (
            " No single synthetic package meets the modeled demand; paralleling "
            "is not evaluated."
        )
    return text


def run_mobile_power(request: MobilePowerInput) -> MobilePowerEvidence:
    problems = cross_field_errors(request)
    if problems:
        # Callers (the route) check first; this keeps the model safe on its own.
        raise RuleError(problems[0]["reason"])

    names = [load.name for load in request.loads]
    quantities = [load.quantity for load in request.loads]
    rated = [Fraction(load.rated_kw) for load in request.loads]
    factors = [Fraction(load.simultaneity_factor) for load in request.loads]
    connected_each = [q * r for q, r in zip(quantities, rated, strict=True)]
    demand_each = [c * f for c, f in zip(connected_each, factors, strict=True)]

    margin = request.capacity_margin_pct
    connected = sum(connected_each, Fraction(0))
    demand = sum(demand_each, Fraction(0))
    scale = 1 + Fraction(margin, 100)
    required = demand * scale
    bound = connected * scale

    top = max(demand_each)
    dominant = [i for i, d in enumerate(demand_each) if d == top]
    ids = [f"load-{i + 1}" for i in range(len(names))]

    packages: list[PackageResult] = []
    for spec in PACKAGES:
        modeled, modeled_headroom = _compare(required, spec.rated_kw)
        sensitivity, bound_headroom = _compare(bound, spec.rated_kw)
        if modeled.status == "does_not_meet":
            category = NOT_MET
        elif sensitivity.status == "does_not_meet":
            category = MODELED_ONLY
        else:
            category = BOTH
        packages.append(
            PackageResult(
                id=spec.id,
                label=spec.label,
                rated_kw=spec.rated_kw,
                modeled_demand=modeled,
                all_simultaneous=sensitivity,
                category=category,
                category_label=CATEGORY_LABELS[category],
                explanation=_package_explanation(
                    category,
                    spec,
                    required,
                    bound,
                    modeled_headroom,
                    bound_headroom,
                    modeled,
                    sensitivity,
                ),
            )
        )

    loads = tuple(
        LoadResult(
            id=ids[i],
            name=names[i],
            quantity=quantities[i],
            rated_kw=_display(rated[i]),
            simultaneity_factor=_display(factors[i]),
            connected_kw=_display(connected_each[i]),
            demand_kw=_display(demand_each[i]),
            share_of_demand_pct=_display(demand_each[i] * 100 / demand),
            is_dominant=i in dominant,
        )
        for i in range(len(names))
    )

    return MobilePowerEvidence(
        model_version=MODEL_VERSION,
        inputs=Inputs(
            loads=tuple(
                InputLoad(
                    name=names[i],
                    quantity=quantities[i],
                    rated_kw=_display(rated[i]),
                    simultaneity_factor=_display(factors[i]),
                )
                for i in range(len(names))
            ),
            capacity_margin_pct=margin,
        ),
        loads=loads,
        totals=Totals(
            connected_kw=_display(connected),
            demand_kw=_display(demand),
            overall_simultaneity_pct=_display(demand * 100 / connected),
            required_kw=_display(required),
            all_simultaneous_required_kw=_display(bound),
        ),
        dominant_load_ids=tuple(ids[i] for i in dominant),
        packages=tuple(packages),
        explanation=_explain(
            names,
            dominant,
            demand_each,
            connected,
            demand,
            margin,
            required,
            bound,
            any(p.modeled_demand.status == "meets" for p in packages),
        ),
        assumptions=tuple(Assumption(id=i, text=t) for i, t in ASSUMPTIONS),
    )
