"""User-defined duty-cycle energy analysis (Mining utility; doc 05 API-18).

A pure, deterministic calculation over the power-versus-time segments a user enters.
It computes energy from the user's own numbers. It is not a vehicle, fuel, range or
propulsion model, and it uses no equipment data of any kind.

Per segment (kW x min / 60 = kWh), summed over the cycle, then repeated for an explicit
number of identical cycles per shift:

- cycle energy        = sum of segment energies
- cycle duration      = sum of segment minutes
- shift energy        = cycle energy x cycles per shift
- shift duration      = cycle duration x cycles per shift (at most 1,440 minutes)
- average cycle power = cycle energy / cycle hours (time-weighted)
- peak power          = the largest segment kW
- share of energy     = segment energy / cycle energy x 100

Every engineering value and every dominance comparison uses exact rational arithmetic
(``Fraction``); only the serialized values are rounded, half up, to 2 decimals. The
rounded shares can therefore differ slightly from 100 % when added up. Pure domain
code: no database, HTTP, clock or randomness.
"""

import unicodedata
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, ConfigDict

from app.domain.system_config import RuleError

MODEL_VERSION = "duty-cycle-v1"

MAX_SEGMENTS = 12
MAX_NAME_LENGTH = 40
MAX_POWER_KW = 10_000
MAX_DURATION_MIN = 480
CYCLES_PER_SHIFT_RANGE = (1, 500)
MAX_SHIFT_MINUTES = 1_440

ASSUMPTIONS: tuple[tuple[str, str], ...] = (
    (
        "A1",
        (
            "Every segment name, power and duration is entered by the user. The "
            "values are inputs to a calculation, not measurements, and the sample "
            "values shown in the workbench are invented for illustration."
        ),
    ),
    (
        "A2",
        (
            "Power is constant within a segment, so segment energy (kWh) = power "
            "(kW) x duration (min) / 60. Power cannot be negative: regeneration and "
            "energy returned to a source are not modeled."
        ),
    ),
    (
        "A3",
        (
            "The segments run one after another once per cycle, and the shift is the "
            "same cycle repeated exactly the stated number of times. Idle time "
            "between cycles counts only if the user enters it as a segment."
        ),
    ),
    (
        "A4",
        (
            "Cycle duration x cycles per shift must not exceed "
            f"{MAX_SHIFT_MINUTES:,} minutes, the longest shift modeled."
        ),
    ),
    (
        "A5",
        (
            "Average power is cycle energy divided by cycle time. The dominant "
            "segment is the one with the most energy, found by exact comparison; "
            "segments with exactly equal energy are all reported."
        ),
    ),
    (
        "A6",
        (
            "All calculations use exact rational arithmetic. Displayed values are "
            "rounded half up to 2 decimals, so displayed shares can differ slightly "
            "from 100% when added up."
        ),
    ),
    (
        "A7",
        (
            "Not modeled: fuel use, vehicle range, propulsion or drivetrain, "
            "efficiency or losses, auxiliary loads, emissions, battery or "
            "generator sizing. This is not validated haul-truck or equipment "
            "performance and uses no Cummins data."
        ),
    ),
    (
        "A8",
        (
            "There is no score, ranking or recommendation; the analysis only "
            "reports the entered profile."
        ),
    ),
)

# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------


def _decimal(low: int, high: int, *, low_exclusive: bool, message: str) -> Any:
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


PowerKw = _decimal(
    0,
    MAX_POWER_KW,
    low_exclusive=False,
    message=f"Must be between 0 and {MAX_POWER_KW}",
)
DurationMin = _decimal(
    0,
    MAX_DURATION_MIN,
    low_exclusive=True,
    message=f"Must be greater than 0 and at most {MAX_DURATION_MIN}",
)


def _segment_name(value: Any) -> str:
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


def _cycles_per_shift(value: Any) -> int:
    low, high = CYCLES_PER_SHIFT_RANGE
    # bool is a subclass of int; floats, strings and None are not accepted.
    if isinstance(value, bool) or not isinstance(value, int):
        raise RuleError("Must be a whole number")
    if not low <= value <= high:
        raise RuleError(f"Must be between {low} and {high}")
    return value


def _segment_list(value: Any) -> Any:
    if not isinstance(value, list):
        raise RuleError("Must be a list of segments")
    if not 1 <= len(value) <= MAX_SEGMENTS:
        raise RuleError(f"Must contain 1 to {MAX_SEGMENTS} segments")
    return value


_FROZEN = ConfigDict(frozen=True, extra="forbid")


class SegmentInput(BaseModel):
    model_config = _FROZEN

    name: Annotated[str, BeforeValidator(_segment_name)]
    power_kw: PowerKw
    duration_min: DurationMin


class DutyCycleInput(BaseModel):
    """The user's duty cycle. All fields are validated here, on the backend."""

    model_config = _FROZEN

    segments: Annotated[tuple[SegmentInput, ...], BeforeValidator(_segment_list)]
    cycles_per_shift: Annotated[int, BeforeValidator(_cycles_per_shift)]


def cross_field_errors(request: DutyCycleInput) -> list[dict[str, str]]:
    """Rules that span fields, as doc 05 ``details``; empty when the input is valid.

    Reasons never repeat submitted values. The one derived number (the most cycles
    that fit) is computed here from the cycle duration.
    """
    errors: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, segment in enumerate(request.segments):
        key = segment.name.casefold()
        if key in seen:
            errors.append(
                {
                    "field": f"segments.{index}.name",
                    "reason": "Must be different from the other segment names",
                }
            )
        seen.add(key)

    cycle_minutes = sum(
        (Fraction(s.duration_min) for s in request.segments), Fraction(0)
    )
    if cycle_minutes * request.cycles_per_shift > MAX_SHIFT_MINUTES:
        fit = int(MAX_SHIFT_MINUTES // cycle_minutes)
        if fit >= 1:
            reason = (
                f"Cycle duration x cycles per shift must not exceed "
                f"{MAX_SHIFT_MINUTES:,} minutes; at most {fit} cycles fit this cycle"
            )
        else:
            reason = (
                f"One cycle already exceeds {MAX_SHIFT_MINUTES:,} minutes; shorten "
                "the segment durations"
            )
        errors.append({"field": "cycles_per_shift", "reason": reason})
    return errors


# ---------------------------------------------------------------------------
# Evidence (response) models
# ---------------------------------------------------------------------------


class Assumption(BaseModel):
    model_config = _FROZEN

    id: str
    text: str


class InputSegment(BaseModel):
    model_config = _FROZEN

    name: str
    power_kw: float
    duration_min: float


class Inputs(BaseModel):
    model_config = _FROZEN

    segments: tuple[InputSegment, ...]
    cycles_per_shift: int


class SegmentResult(BaseModel):
    model_config = _FROZEN

    id: str
    name: str
    power_kw: float
    duration_min: float
    energy_kwh: float
    share_of_cycle_energy_pct: float
    is_dominant: bool


class CycleTotals(BaseModel):
    model_config = _FROZEN

    duration_min: float
    energy_kwh: float
    average_power_kw: float
    peak_power_kw: float


class ShiftTotals(BaseModel):
    model_config = _FROZEN

    cycles: int
    duration_min: float
    energy_kwh: float


class DutyCycleEvidence(BaseModel):
    model_config = _FROZEN

    model_version: str
    inputs: Inputs
    segments: tuple[SegmentResult, ...]
    cycle: CycleTotals
    shift: ShiftTotals
    dominant_segment_ids: tuple[str, ...]
    explanation: str
    assumptions: tuple[Assumption, ...]


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------

_CENT = Decimal("0.01")


def _display(value: Fraction) -> float:
    """Round half up to 2 decimals (the values here are never negative)."""
    exact = Decimal(value.numerator) / Decimal(value.denominator)
    return float(exact.quantize(_CENT, rounding=ROUND_HALF_UP))


def _text(value: Fraction) -> str:
    return f"{_display(value):.2f}"


def _join(names: list[str]) -> str:
    if len(names) <= 2:
        return " and ".join(names)
    return ", ".join(names[:-1]) + " and " + names[-1]


def _explain(
    names: list[str],
    energies: list[Fraction],
    powers: list[Fraction],
    minutes: list[Fraction],
    total_energy: Fraction,
    total_minutes: Fraction,
    dominant: list[int],
) -> str:
    if not dominant:
        return "The cycle uses no energy because every segment has 0 kW, so no segment dominates."
    first = dominant[0]
    energy_text = (
        f"{_text(energies[first])} kWh of {_text(total_energy)} kWh "
        f"({_text(energies[first] * 100 / total_energy)}% of cycle energy)"
    )
    if len(dominant) == 1:
        text = (
            f"{names[first]} uses the most energy: {energy_text}, from "
            f"{_text(powers[first])} kW for {_text(minutes[first])} min "
            f"({_text(minutes[first] * 100 / total_minutes)}% of cycle time)."
        )
    else:
        text = (
            f"{_join([names[i] for i in dominant])} tie for the most energy, each "
            f"with {energy_text}."
        )
    peak = max(powers)
    peak_names = [n for n, p in zip(names, powers, strict=True) if p == peak]
    if all(powers[i] == peak for i in dominant):
        text += (
            " They also have the highest power."
            if len(dominant) > 1
            else (" It also has the highest power.")
        )
    else:
        text += (
            f" The highest-power segment is {_join(peak_names)} at {_text(peak)} kW."
        )
    return text


def run_duty_cycle(request: DutyCycleInput) -> DutyCycleEvidence:
    problems = cross_field_errors(request)
    if problems:
        # Callers (the route) check first; this keeps the model safe on its own.
        raise RuleError(problems[0]["reason"])

    names = [s.name for s in request.segments]
    powers = [Fraction(s.power_kw) for s in request.segments]
    minutes = [Fraction(s.duration_min) for s in request.segments]
    energies = [p * m / 60 for p, m in zip(powers, minutes, strict=True)]

    total_energy = sum(energies, Fraction(0))
    total_minutes = sum(minutes, Fraction(0))
    cycles = request.cycles_per_shift
    average_power = total_energy * 60 / total_minutes

    top = max(energies)
    dominant = [i for i, e in enumerate(energies) if e == top] if top > 0 else []
    ids = [f"segment-{i + 1}" for i in range(len(names))]

    segments = tuple(
        SegmentResult(
            id=ids[i],
            name=names[i],
            power_kw=_display(powers[i]),
            duration_min=_display(minutes[i]),
            energy_kwh=_display(energies[i]),
            share_of_cycle_energy_pct=(
                _display(energies[i] * 100 / total_energy) if total_energy else 0.0
            ),
            is_dominant=i in dominant,
        )
        for i in range(len(names))
    )

    return DutyCycleEvidence(
        model_version=MODEL_VERSION,
        inputs=Inputs(
            segments=tuple(
                InputSegment(
                    name=names[i],
                    power_kw=_display(powers[i]),
                    duration_min=_display(minutes[i]),
                )
                for i in range(len(names))
            ),
            cycles_per_shift=cycles,
        ),
        segments=segments,
        cycle=CycleTotals(
            duration_min=_display(total_minutes),
            energy_kwh=_display(total_energy),
            average_power_kw=_display(average_power),
            peak_power_kw=_display(max(powers)),
        ),
        shift=ShiftTotals(
            cycles=cycles,
            duration_min=_display(total_minutes * cycles),
            energy_kwh=_display(total_energy * cycles),
        ),
        dominant_segment_ids=tuple(ids[i] for i in dominant),
        explanation=_explain(
            names, energies, powers, minutes, total_energy, total_minutes, dominant
        ),
        assumptions=tuple(Assumption(id=i, text=t) for i, t in ASSUMPTIONS),
    )
