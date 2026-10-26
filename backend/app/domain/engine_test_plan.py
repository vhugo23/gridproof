"""Engine test-plan coverage (Seymour synthetic workbench; doc 05 API-20).

A pure, deterministic calculation over a test plan the user types: an objective,
requirement regions in the speed-torque plane and an ordered list of planned
operating points. It reports which requirements the plan covers *as a plan*. It uses
no engine data of any kind: no map, envelope, limit, efficiency, fuel or emissions
figure, and it never decides whether an engine can operate at a point.

Per point: theoretical shaft power P (kW) = 2 x pi x N x T / 60,000, with N in rpm and
T in N.m. Planned hold start and end are cumulative sums of the entered holds only.

A point *matches* a requirement when it is inside every stated bound (all inclusive):
speed range, torque range and, when given, theoretical power at or above a minimum.
A requirement is

- covered by plan  : matching planned entries >= min_points and their summed planned
                     hold >= min_dwell_min;
- partly covered   : at least one matching entry, but one of those two is short;
- not covered      : no matching entry.

``min_points`` counts planned test entries. Repeated speed/torque coordinates are
allowed and count as separate entries; they are never silently merged, and the
response discloses how many distinct conditions a requirement's matches represent.

Speed and torque are exact (``Decimal``/``int``). pi is irrational, so power uses
``Decimal`` at 80 digits of precision from a 50-decimal pi, deterministically. Every
coverage and threshold comparison uses these unrounded values; only the serialized
values are rounded, half up, to 2 decimals. A power of 157.0796... kW therefore shows
as 157.08 kW yet is below a 157.08 kW threshold, and the response says so.

Pure domain code: no database, HTTP, clock or randomness.
"""

import unicodedata
from decimal import ROUND_HALF_UP, Decimal, localcontext
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict

from app.domain.system_config import RuleError

MODEL_VERSION = "engine-test-plan-v1"

MAX_REQUIREMENTS = 10
MAX_POINTS = 12
MAX_OBJECTIVE_LENGTH = 80
MAX_LABEL_LENGTH = 40
RPM_RANGE = (1, 6_000)
TORQUE_RANGE_NM = (0, 20_000)
MAX_POWER_THRESHOLD_KW = 20_000
DWELL_RANGE_MIN = (1, 480)
MIN_POINTS_RANGE = (1, MAX_POINTS)
MIN_DWELL_RANGE_MIN = (0, 1_440)
MAX_TOTAL_HOLD_MIN = 1_440

# pi to 50 decimal places (published constant, independent of float arithmetic).
PI = Decimal("3.14159265358979323846264338327950288419716939937510")
_PRECISION = 80
_CENT = Decimal("0.01")

COVERED = "covered_by_plan"
PARTLY = "partly_covered"
NOT_COVERED = "not_covered"
STATUS_LABELS = {
    COVERED: "Covered by plan",
    PARTLY: "Partly covered",
    NOT_COVERED: "Not covered",
}

VERIFICATION_STATEMENT = (
    "Verification status: not verified. This is a planning check on numbers you "
    "entered. GridProof holds no measurements, limits or engine data and cannot show "
    "that any planned point is attainable or that any engine performs as planned."
)

ASSUMPTIONS: tuple[tuple[str, str], ...] = (
    (
        "A1",
        (
            "Everything here is synthetic and independent of Cummins Inc. The "
            "objective, requirements and operating points are entered by the user "
            "(the starting values are invented) and are not Cummins specifications, "
            "test procedures or measured data, and not the Seymour site's software "
            "or practice."
        ),
    ),
    (
        "A2",
        (
            "Theoretical shaft power = 2 x pi x speed (rpm) x torque (N.m) / 60,000, "
            "in kW. It is arithmetic on the entered speed and torque. It is not "
            "measured, corrected or attainable power, and says nothing about "
            "efficiency, fuel or emissions."
        ),
    ),
    (
        "A3",
        (
            "Coverage is planning coverage only. A matching planned entry satisfies a "
            "planning criterion; it does not show that the engine can operate at that "
            "point, and it is not acceptance or verification of performance."
        ),
    ),
    (
        "A4",
        (
            "A requirement is a rectangle in the speed-torque plane (inclusive "
            "bounds) with an optional minimum theoretical power. Tolerances, "
            "measurement uncertainty and engine limits are not modeled; a point "
            "planned exactly on a bound is inside it."
        ),
    ),
    (
        "A5",
        (
            "The minimum point count counts planned test entries. Repeated "
            "speed/torque coordinates are allowed and count as separate entries; "
            "they do not establish distinct-condition coverage. Nothing is "
            "deduplicated, and the number of distinct conditions is reported "
            "separately."
        ),
    ),
    (
        "A6",
        (
            "Dwell is planned hold time, not measured stabilization or verified "
            "stable operation. The timeline and the summary sum scheduled holds only. "
            "They are not total elapsed test time: transitions, setup and "
            "stabilization are not modeled, and the step changes between points are "
            "plain differences, not ramp rates."
        ),
    ),
    (
        "A7",
        (
            "The order of the points changes the hold timeline and the step changes. "
            "It does not change coverage."
        ),
    ),
    (
        "A8",
        (
            "Power uses high-precision decimal arithmetic. Every coverage and "
            "threshold comparison uses the unrounded values; displayed values are "
            "rounded half up to 2 decimals, so a power that displays as equal to a "
            "threshold can still be below it."
        ),
    ),
    (
        "A9",
        (
            "A requirement that is not covered is a gap in the plan, not a "
            "deficiency of any engine. The evidence checklist lists what would still "
            "be needed before any statement about real engine performance. It is "
            "generic and cites no standard or company procedure."
        ),
    ),
)

# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------


def _decimal_check(
    low: Decimal | int, high: Decimal | int, *, low_exclusive: bool, message: str
):
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
        if number != number.quantize(_CENT):
            raise RuleError("Must have at most 2 decimal places")
        return number

    return check


TorqueNm = Annotated[
    Decimal,
    BeforeValidator(
        _decimal_check(
            TORQUE_RANGE_NM[0],
            TORQUE_RANGE_NM[1],
            low_exclusive=False,
            message=f"Must be between 0 and {TORQUE_RANGE_NM[1]:,} N.m",
        )
    ),
]

_power_check_value = _decimal_check(
    0,
    MAX_POWER_THRESHOLD_KW,
    low_exclusive=True,
    message=f"Must be greater than 0 and at most {MAX_POWER_THRESHOLD_KW:,} kW",
)


def _optional_power(value: Any) -> Decimal | None:
    return None if value is None else _power_check_value(value)


def _whole_number(low: int, high: int, message: str | None = None) -> Any:
    def check(value: Any) -> int:
        # bool is a subclass of int; floats, strings and None are not accepted.
        if isinstance(value, bool) or not isinstance(value, int):
            raise RuleError("Must be a whole number")
        if not low <= value <= high:
            raise RuleError(message or f"Must be between {low:,} and {high:,}")
        return value

    return Annotated[int, BeforeValidator(check)]


Rpm = _whole_number(*RPM_RANGE)
DwellMin = _whole_number(*DWELL_RANGE_MIN)
MinPoints = _whole_number(*MIN_POINTS_RANGE)
MinDwellMin = _whole_number(*MIN_DWELL_RANGE_MIN)


def _text(maximum: int):
    def check(value: Any) -> str:
        if not isinstance(value, str):
            raise RuleError("Must be text")
        text = value.strip()
        if not 1 <= len(text) <= maximum:
            raise RuleError(f"Must be 1 to {maximum} characters")
        categories = [unicodedata.category(char) for char in text]
        if any(category in ("Cc", "Cs") for category in categories):
            raise RuleError("Must not contain control characters")
        if not any(category[0] in "LNPS" for category in categories):
            raise RuleError("Must contain a visible character")
        return text

    return check


def _list(name: str, low: int, high: int):
    def check(value: Any) -> Any:
        if not isinstance(value, list):
            raise RuleError(f"Must be a list of {name}")
        if not low <= len(value) <= high:
            raise RuleError(f"Must contain {low} to {high} {name}")
        return value

    return check


_FROZEN = ConfigDict(frozen=True, extra="forbid")


class RequirementInput(BaseModel):
    model_config = _FROZEN

    label: Annotated[str, BeforeValidator(_text(MAX_LABEL_LENGTH))]
    rpm_min: Rpm
    rpm_max: Rpm
    torque_min_nm: TorqueNm
    torque_max_nm: TorqueNm
    power_min_kw: Annotated[Decimal | None, BeforeValidator(_optional_power)] = None
    min_points: MinPoints = 1
    min_dwell_min: MinDwellMin = 0


class PointInput(BaseModel):
    model_config = _FROZEN

    label: Annotated[str, BeforeValidator(_text(MAX_LABEL_LENGTH))]
    rpm: Rpm
    torque_nm: TorqueNm
    dwell_min: DwellMin


class EngineTestPlanInput(BaseModel):
    """The user's test plan. All fields are validated here, on the backend."""

    model_config = _FROZEN

    objective: Annotated[str, BeforeValidator(_text(MAX_OBJECTIVE_LENGTH))]
    requirements: Annotated[
        tuple[RequirementInput, ...],
        BeforeValidator(_list("requirements", 1, MAX_REQUIREMENTS)),
    ]
    points: Annotated[
        tuple[PointInput, ...], BeforeValidator(_list("points", 1, MAX_POINTS))
    ]


def cross_field_errors(request: EngineTestPlanInput) -> list[dict[str, str]]:
    """Rules that span fields, as doc 05 ``details``; empty when the input is valid.

    Reasons never repeat submitted values.
    """
    errors: list[dict[str, str]] = []

    for group, items in (
        ("requirements", request.requirements),
        ("points", request.points),
    ):
        seen: set[str] = set()
        for index, item in enumerate(items):
            key = item.label.casefold()
            if key in seen:
                errors.append(
                    {
                        "field": f"{group}.{index}.label",
                        "reason": "Must be different from the other labels",
                    }
                )
            seen.add(key)

    for index, req in enumerate(request.requirements):
        if req.rpm_max < req.rpm_min:
            errors.append(
                {
                    "field": f"requirements.{index}.rpm_max",
                    "reason": "Must be at least the minimum speed",
                }
            )
        if req.torque_max_nm < req.torque_min_nm:
            errors.append(
                {
                    "field": f"requirements.{index}.torque_max_nm",
                    "reason": "Must be at least the minimum torque",
                }
            )

    if sum(point.dwell_min for point in request.points) > MAX_TOTAL_HOLD_MIN:
        errors.append(
            {
                "field": "points",
                "reason": (
                    f"Total planned hold time must not exceed {MAX_TOTAL_HOLD_MIN:,} "
                    "minutes; shorten the holds or remove points"
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


class InputRequirement(BaseModel):
    model_config = _FROZEN

    label: str
    rpm_min: int
    rpm_max: int
    torque_min_nm: float
    torque_max_nm: float
    power_min_kw: float | None
    min_points: int
    min_dwell_min: int


class InputPoint(BaseModel):
    model_config = _FROZEN

    label: str
    rpm: int
    torque_nm: float
    dwell_min: int


class Inputs(BaseModel):
    model_config = _FROZEN

    objective: str
    requirements: tuple[InputRequirement, ...]
    points: tuple[InputPoint, ...]


class Step(BaseModel):
    model_config = _FROZEN

    delta_rpm: int
    delta_torque_nm: float


class PointResult(BaseModel):
    model_config = _FROZEN

    id: str
    label: str
    rpm: int
    torque_nm: float
    dwell_min: int
    power_kw: float
    hold_start_min: int
    hold_end_min: int
    step_from_previous: Step | None
    covers: tuple[str, ...]
    same_conditions_as: tuple[str, ...]


class RangeCheck(BaseModel):
    model_config = _FROZEN

    met: bool
    value: float
    minimum: float
    maximum: float
    # Signed distance outside the range: negative below the minimum, positive above
    # the maximum, 0 when inside.
    outside_by: float


class PowerCheck(BaseModel):
    model_config = _FROZEN

    met: bool
    value: float
    minimum: float
    # Value minus minimum when below it; 0 when met.
    outside_by: float
    # Not met although value and minimum display as equal at 2 decimals.
    equal_when_rounded: bool


class PointCheck(BaseModel):
    model_config = _FROZEN

    point_id: str
    matches: bool
    rpm: RangeCheck
    torque: RangeCheck
    power: PowerCheck | None


class Shortfall(BaseModel):
    model_config = _FROZEN

    entries: int
    hold_min: int


class RequirementResult(BaseModel):
    model_config = _FROZEN

    id: str
    label: str
    status: Literal["covered_by_plan", "partly_covered", "not_covered"]
    status_label: str
    min_points: int
    min_dwell_min: int
    matched_point_ids: tuple[str, ...]
    matched_entries: int
    matched_distinct_conditions: int
    matched_hold_min: int
    shortfall: Shortfall
    point_checks: tuple[PointCheck, ...]
    explanation: str


class RepeatedCondition(BaseModel):
    model_config = _FROZEN

    rpm: int
    torque_nm: float
    point_ids: tuple[str, ...]


class Summary(BaseModel):
    model_config = _FROZEN

    requirements_total: int
    covered_by_plan: int
    partly_covered: int
    not_covered: int
    points_total: int
    distinct_conditions: int
    repeated_conditions: tuple[RepeatedCondition, ...]
    planned_hold_min: int
    min_power_kw: float
    max_power_kw: float
    unmatched_point_ids: tuple[str, ...]


class Verification(BaseModel):
    model_config = _FROZEN

    status: Literal["not_verified"]
    statement: str


class EvidenceItem(BaseModel):
    model_config = _FROZEN

    id: str
    scope: Literal["plan", "requirement", "point"]
    ref_id: str | None
    text: str
    status: Literal["not_started"]


class EngineTestPlanEvidence(BaseModel):
    model_config = _FROZEN

    model_version: str
    inputs: Inputs
    points: tuple[PointResult, ...]
    requirements: tuple[RequirementResult, ...]
    summary: Summary
    verification: Verification
    evidence_checklist: tuple[EvidenceItem, ...]
    explanation: str
    assumptions: tuple[Assumption, ...]


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------


def _display(value: Decimal | int) -> float:
    """Round half up to 2 decimals; never negative zero."""
    with localcontext() as ctx:
        ctx.prec = _PRECISION
        rounded = Decimal(value).quantize(_CENT, rounding=ROUND_HALF_UP)
    return 0.0 if rounded == 0 else float(rounded)


def _t(value: Decimal | int) -> str:
    return f"{_display(value):.2f}"


def theoretical_power_kw(rpm: int, torque_nm: Decimal) -> Decimal:
    """2 x pi x N x T / 60,000, unrounded (80-digit decimal arithmetic)."""
    with localcontext() as ctx:
        ctx.prec = _PRECISION
        return Decimal(rpm) * torque_nm * PI / Decimal(30_000)


def _range_check(value: Decimal, low: Decimal, high: Decimal) -> RangeCheck:
    if value < low:
        outside = value - low
    elif value > high:
        outside = value - high
    else:
        outside = Decimal(0)
    return RangeCheck(
        met=low <= value <= high,
        value=_display(value),
        minimum=_display(low),
        maximum=_display(high),
        outside_by=_display(outside),
    )


def _power_check(power: Decimal, minimum: Decimal) -> PowerCheck:
    met = power >= minimum
    return PowerCheck(
        met=met,
        value=_display(power),
        minimum=_display(minimum),
        outside_by=0.0 if met else _display(power - minimum),
        equal_when_rounded=(not met) and _display(power) == _display(minimum),
    )


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"


def _entries(count: int) -> str:
    return f"{count} planned entry" if count == 1 else f"{count} planned entries"


def _requirement_explanation(
    status: str,
    matched: int,
    distinct: int,
    hold: int,
    min_points: int,
    min_dwell: int,
    entries_short: int,
    hold_short: int,
) -> str:
    needs = f"needs {_entries(min_points)}"
    if min_dwell:
        needs += f" and {min_dwell} min of planned hold"
    have = (
        f"{_entries(matched)} match{'es' if matched == 1 else ''} "
        f"with {hold} min of planned hold"
    )
    tail = (
        " This is planning coverage only; it does not show that the engine can "
        "operate at these points."
    )
    if matched and distinct < matched:
        tail = (
            f" The {matched} matching entries cover {distinct} distinct "
            "speed/torque condition"
            f"{'' if distinct == 1 else 's'}: repeated coordinates count as separate "
            "entries but do not establish distinct-condition coverage." + tail
        )
    if status == NOT_COVERED:
        return (
            "No planned entry is inside every bound of this requirement. The check "
            "grid shows which bound each entry misses." + tail
        )
    if status == COVERED:
        return f"The plan covers this requirement: {have}; it {needs}." + tail
    gaps = []
    if entries_short:
        gaps.append(f"{_entries(entries_short)} short")
    if hold_short:
        gaps.append(f"{hold_short} min of planned hold short")
    return (
        f"The plan covers this requirement only in part: {have}; it {needs}. "
        f"It is {' and '.join(gaps)}." + tail
    )


def _evidence(
    points: list[PointResult],
    requirements: list[RequirementResult],
    plan: EngineTestPlanInput,
) -> tuple[EvidenceItem, ...]:
    items: list[EvidenceItem] = []

    def add(scope: str, ref: str | None, text: str) -> None:
        items.append(
            EvidenceItem(
                id=f"ev-{len(items) + 1}",
                scope=scope,  # type: ignore[arg-type]
                ref_id=ref,
                text=text,
                status="not_started",
            )
        )

    add(
        "plan",
        None,
        "Authoritative capability limits for the planned speeds and torques, "
        "obtained from the owner of the engine data. GridProof holds none and does "
        "not check that any planned point is attainable.",
    )
    add(
        "plan",
        None,
        "A written, approved test procedure and acceptance criteria that define what "
        "would count as satisfying each requirement. Planning coverage here is not "
        "acceptance.",
    )
    add(
        "plan",
        None,
        "Calibrated speed and torque measurement records for the run, with their "
        "stated uncertainty.",
    )
    add(
        "plan",
        None,
        "Recorded test conditions and a log of any deviation from this plan, with "
        "reasons.",
    )
    add(
        "plan",
        None,
        "Test facility and safety approval to operate at the planned points.",
    )
    for point, entered in zip(points, plan.points, strict=True):
        add(
            "point",
            point.id,
            f"Measured speed and torque logged during the hold at {point.label}, "
            f"compared with the planned {point.rpm} rpm and "
            f"{point.torque_nm:.2f} N.m.",
        )
        add(
            "point",
            point.id,
            f"Evidence, judged by the test procedure's own stability criterion, "
            f"that operation at {point.label} was stable for the planned "
            f"{entered.dwell_min} min hold.",
        )
    for req in requirements:
        if req.status != NOT_COVERED:
            add(
                "requirement",
                req.id,
                f"Measured results at the matching points for {req.label}, judged "
                "against acceptance criteria defined before the run.",
            )
        if req.status != COVERED:
            add(
                "requirement",
                req.id,
                f"A plan change or documented rationale for the gap in {req.label}.",
            )
        if (
            req.matched_entries
            and req.matched_distinct_conditions < req.matched_entries
        ):
            add(
                "requirement",
                req.id,
                f"A rationale for the repeated holds at identical conditions that "
                f"count toward {req.label}.",
            )
    return tuple(items)


def run_engine_test_plan(request: EngineTestPlanInput) -> EngineTestPlanEvidence:
    problems = cross_field_errors(request)
    if problems:
        # Callers (the route) check first; this keeps the model safe on its own.
        raise RuleError(problems[0]["reason"])

    powers = [theoretical_power_kw(p.rpm, p.torque_nm) for p in request.points]
    point_ids = [f"point-{i + 1}" for i in range(len(request.points))]
    req_ids = [f"req-{i + 1}" for i in range(len(request.requirements))]

    requirements: list[RequirementResult] = []
    covers: dict[str, list[str]] = {pid: [] for pid in point_ids}
    for ri, req in enumerate(request.requirements):
        checks: list[PointCheck] = []
        for pi_, point in enumerate(request.points):
            rpm_check = _range_check(
                Decimal(point.rpm), Decimal(req.rpm_min), Decimal(req.rpm_max)
            )
            torque_check = _range_check(
                point.torque_nm, req.torque_min_nm, req.torque_max_nm
            )
            power_check = (
                _power_check(powers[pi_], req.power_min_kw)
                if req.power_min_kw is not None
                else None
            )
            matches = (
                rpm_check.met
                and torque_check.met
                and (power_check is None or power_check.met)
            )
            checks.append(
                PointCheck(
                    point_id=point_ids[pi_],
                    matches=matches,
                    rpm=rpm_check,
                    torque=torque_check,
                    power=power_check,
                )
            )
        matched_idx = [i for i, c in enumerate(checks) if c.matches]
        matched = len(matched_idx)
        distinct = len(
            {(request.points[i].rpm, request.points[i].torque_nm) for i in matched_idx}
        )
        hold = sum(request.points[i].dwell_min for i in matched_idx)
        entries_short = max(0, req.min_points - matched)
        hold_short = max(0, req.min_dwell_min - hold)
        if matched == 0:
            status = NOT_COVERED
        elif entries_short or hold_short:
            status = PARTLY
        else:
            status = COVERED
        for i in matched_idx:
            covers[point_ids[i]].append(req_ids[ri])
        requirements.append(
            RequirementResult(
                id=req_ids[ri],
                label=req.label,
                status=status,  # type: ignore[arg-type]
                status_label=STATUS_LABELS[status],
                min_points=req.min_points,
                min_dwell_min=req.min_dwell_min,
                matched_point_ids=tuple(point_ids[i] for i in matched_idx),
                matched_entries=matched,
                matched_distinct_conditions=distinct,
                matched_hold_min=hold,
                shortfall=Shortfall(entries=entries_short, hold_min=hold_short),
                point_checks=tuple(checks),
                explanation=_requirement_explanation(
                    status,
                    matched,
                    distinct,
                    hold,
                    req.min_points,
                    req.min_dwell_min,
                    entries_short,
                    hold_short,
                ),
            )
        )

    points: list[PointResult] = []
    clock = 0
    for i, point in enumerate(request.points):
        previous = request.points[i - 1] if i else None
        same = tuple(
            point_ids[j]
            for j, other in enumerate(request.points)
            if j != i and other.rpm == point.rpm and other.torque_nm == point.torque_nm
        )
        points.append(
            PointResult(
                id=point_ids[i],
                label=point.label,
                rpm=point.rpm,
                torque_nm=_display(point.torque_nm),
                dwell_min=point.dwell_min,
                power_kw=_display(powers[i]),
                hold_start_min=clock,
                hold_end_min=clock + point.dwell_min,
                step_from_previous=(
                    Step(
                        delta_rpm=point.rpm - previous.rpm,
                        delta_torque_nm=_display(point.torque_nm - previous.torque_nm),
                    )
                    if previous is not None
                    else None
                ),
                covers=tuple(covers[point_ids[i]]),
                same_conditions_as=same,
            )
        )
        clock += point.dwell_min

    groups: dict[tuple[int, Decimal], list[str]] = {}
    for i, point in enumerate(request.points):
        groups.setdefault((point.rpm, point.torque_nm), []).append(point_ids[i])
    repeated = tuple(
        RepeatedCondition(rpm=rpm, torque_nm=_display(torque), point_ids=tuple(ids))
        for (rpm, torque), ids in groups.items()
        if len(ids) > 1
    )

    count = {s: sum(1 for r in requirements if r.status == s) for s in STATUS_LABELS}
    summary = Summary(
        requirements_total=len(requirements),
        covered_by_plan=count[COVERED],
        partly_covered=count[PARTLY],
        not_covered=count[NOT_COVERED],
        points_total=len(points),
        distinct_conditions=len(groups),
        repeated_conditions=repeated,
        planned_hold_min=clock,
        min_power_kw=_display(min(powers)),
        max_power_kw=_display(max(powers)),
        unmatched_point_ids=tuple(pid for pid in point_ids if not covers[pid]),
    )

    explanation = (
        f"Of {_plural(len(requirements), 'requirement')}, {count[COVERED]} "
        f"{'is' if count[COVERED] == 1 else 'are'} covered by the plan, "
        f"{count[PARTLY]} partly covered and {count[NOT_COVERED]} not covered. "
        f"The plan holds {clock} min of planned hold time across "
        f"{_entries(len(points))} "
        f"({len(groups)} distinct speed/torque condition"
        f"{'' if len(groups) == 1 else 's'}); that is scheduled hold time, not total "
        "elapsed test time. This is planning coverage only: nothing here is "
        "verified, and no planned point is shown to be attainable."
    )

    return EngineTestPlanEvidence(
        model_version=MODEL_VERSION,
        inputs=Inputs(
            objective=request.objective,
            requirements=tuple(
                InputRequirement(
                    label=r.label,
                    rpm_min=r.rpm_min,
                    rpm_max=r.rpm_max,
                    torque_min_nm=_display(r.torque_min_nm),
                    torque_max_nm=_display(r.torque_max_nm),
                    power_min_kw=(
                        _display(r.power_min_kw) if r.power_min_kw is not None else None
                    ),
                    min_points=r.min_points,
                    min_dwell_min=r.min_dwell_min,
                )
                for r in request.requirements
            ),
            points=tuple(
                InputPoint(
                    label=p.label,
                    rpm=p.rpm,
                    torque_nm=_display(p.torque_nm),
                    dwell_min=p.dwell_min,
                )
                for p in request.points
            ),
        ),
        points=tuple(points),
        requirements=tuple(requirements),
        summary=summary,
        verification=Verification(
            status="not_verified", statement=VERIFICATION_STATEMENT
        ),
        evidence_checklist=_evidence(points, requirements, request),
        explanation=explanation,
        assumptions=tuple(Assumption(id=i, text=t) for i, t in ASSUMPTIONS),
    )
