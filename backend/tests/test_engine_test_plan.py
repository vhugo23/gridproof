"""Engine test-plan coverage (doc 05 API-20): the model and its validation.

Expected values are worked by hand, not taken from the implementation. With
k = speed x torque / 30,000, theoretical shaft power is k x pi kW, so the golden plan
gives 50pi/3 = 52.36 kW (1000 rpm, 500 N.m), 50pi = 157.08 kW (1500 rpm, 1000 N.m),
48pi = 150.80 kW (1800 rpm, 800 N.m) and 52pi = 163.36 kW (1200 rpm, 1300 N.m). pi
for the independent checks is computed here with Machin's formula in integers.
"""

import copy
import json
import re
from decimal import Decimal, localcontext

import pytest
from pydantic import ValidationError

from app.domain import engine_test_plan as model
from app.domain.engine_test_plan import (
    EngineTestPlanInput,
    cross_field_errors,
    run_engine_test_plan,
    theoretical_power_kw,
)
from app.domain.system_config import validation_details

GOLDEN = {
    "objective": "Synthetic mid-speed coverage check",
    "requirements": [
        {
            "label": "R1 Low-speed",
            "rpm_min": 800,
            "rpm_max": 1200,
            "torque_min_nm": 400,
            "torque_max_nm": 600,
            "min_points": 1,
            "min_dwell_min": 10,
        },
        {
            "label": "R2 Mid-speed",
            "rpm_min": 1400,
            "rpm_max": 1600,
            "torque_min_nm": 900,
            "torque_max_nm": 1100,
            "power_min_kw": 150,
        },
        {
            "label": "R3 Rated-speed",
            "rpm_min": 1750,
            "rpm_max": 1850,
            "torque_min_nm": 700,
            "torque_max_nm": 900,
            "min_points": 2,
            "min_dwell_min": 20,
        },
        {
            "label": "R4 Peak torque",
            "rpm_min": 1100,
            "rpm_max": 1300,
            "torque_min_nm": 1350,
            "torque_max_nm": 1500,
        },
    ],
    "points": [
        {"label": "Point A", "rpm": 1000, "torque_nm": 500, "dwell_min": 10},
        {"label": "Point B", "rpm": 1500, "torque_nm": 1000, "dwell_min": 20},
        {"label": "Point C", "rpm": 1800, "torque_nm": 800, "dwell_min": 15},
        {"label": "Point D", "rpm": 1200, "torque_nm": 1300, "dwell_min": 15},
    ],
}


def run(body: dict):
    return run_engine_test_plan(EngineTestPlanInput.model_validate(body))


def plan(requirements: list[dict], points: list[dict]) -> dict:
    return {"objective": "Test", "requirements": requirements, "points": points}


def req(label="R", **kw) -> dict:
    base = {
        "label": label,
        "rpm_min": 1000,
        "rpm_max": 2000,
        "torque_min_nm": 100,
        "torque_max_nm": 900,
    }
    base.update(kw)
    return base


def pt(label="P", rpm=1500, torque=500, dwell=10) -> dict:
    return {"label": label, "rpm": rpm, "torque_nm": torque, "dwell_min": dwell}


def machin_pi(digits: int = 60) -> Decimal:
    """pi by Machin's formula with integer arithmetic (independent of model.PI)."""
    scale = 10 ** (digits + 10)

    def arctan_inv(x: int) -> int:
        total = term = scale // x
        n, sign = 3, -1
        while term:
            term //= x * x
            total += sign * (term // n)
            n += 2
            sign = -sign
        return total

    value = 4 * (4 * arctan_inv(5) - arctan_inv(239))
    with localcontext() as ctx:
        ctx.prec = 120
        return Decimal(value) / Decimal(scale)


# ---------- golden example ----------


def test_the_golden_plan_matches_the_hand_calculation():
    result = run(GOLDEN)
    assert result.model_version == "engine-test-plan-v1"
    assert [p.power_kw for p in result.points] == [52.36, 157.08, 150.8, 163.36]
    assert [(p.hold_start_min, p.hold_end_min) for p in result.points] == [
        (0, 10),
        (10, 30),
        (30, 45),
        (45, 60),
    ]
    assert result.points[0].step_from_previous is None
    steps = [
        (p.step_from_previous.delta_rpm, p.step_from_previous.delta_torque_nm)
        for p in result.points[1:]
    ]
    assert steps == [(500, 500.0), (300, -200.0), (-600, 500.0)]
    assert [r.status for r in result.requirements] == [
        "covered_by_plan",
        "covered_by_plan",
        "partly_covered",
        "not_covered",
    ]
    assert [r.status_label for r in result.requirements] == [
        "Covered by plan",
        "Covered by plan",
        "Partly covered",
        "Not covered",
    ]
    assert [r.matched_point_ids for r in result.requirements] == [
        ("point-1",),
        ("point-2",),
        ("point-3",),
        (),
    ]
    assert [p.covers for p in result.points] == [
        ("req-1",),
        ("req-2",),
        ("req-3",),
        (),
    ]
    r3 = result.requirements[2]
    assert (r3.matched_entries, r3.matched_hold_min) == (1, 15)
    assert (r3.shortfall.entries, r3.shortfall.hold_min) == (1, 5)
    summary = result.summary
    assert (summary.covered_by_plan, summary.partly_covered, summary.not_covered) == (
        2,
        1,
        1,
    )
    assert summary.planned_hold_min == 60
    assert (summary.min_power_kw, summary.max_power_kw) == (52.36, 163.36)
    assert summary.unmatched_point_ids == ("point-4",)
    assert summary.distinct_conditions == 4
    assert summary.repeated_conditions == ()


def test_the_golden_not_covered_grid_shows_the_signed_miss_per_dimension():
    r4 = run(GOLDEN).requirements[3]
    d = next(c for c in r4.point_checks if c.point_id == "point-4")
    assert d.rpm.met is True  # 1200 inside 1100 to 1300
    assert d.torque.met is False
    assert d.torque.outside_by == -50.0  # 1300 is 50 below 1350
    assert d.power is None
    a = next(c for c in r4.point_checks if c.point_id == "point-1")
    assert (a.rpm.outside_by, a.torque.outside_by) == (-100.0, -850.0)
    # Point D passes R1's speed bound at its inclusive limit but not its torque.
    d_r1 = next(
        c for c in run(GOLDEN).requirements[0].point_checks if c.point_id == "point-4"
    )
    assert (d_r1.rpm.met, d_r1.torque.met, d_r1.matches) == (True, False, False)
    assert d_r1.torque.outside_by == 700.0


def test_the_golden_evidence_checklist_is_counted_and_never_started():
    items = run(GOLDEN).evidence_checklist
    # 5 plan items + 2 per point (8) + requirement items: R1 1, R2 1, R3 2, R4 1.
    assert len(items) == 18
    assert [i.id for i in items] == [f"ev-{n}" for n in range(1, 19)]
    assert {i.status for i in items} == {"not_started"}
    assert sum(i.scope == "plan" for i in items) == 5
    assert sum(i.scope == "point" for i in items) == 8
    assert sum(i.scope == "requirement" for i in items) == 5
    assert {i.ref_id for i in items if i.scope == "point"} == {
        "point-1",
        "point-2",
        "point-3",
        "point-4",
    }


# ---------- power ----------


@pytest.mark.parametrize(
    ("rpm", "torque", "multiple_of_pi"),
    [
        (1000, "500", Decimal(50) / 3),
        (1500, "1000", Decimal(50)),
        (1800, "800", Decimal(48)),
        (1200, "1300", Decimal(52)),
        (6000, "20000", Decimal(4000)),
        (30, "1000", Decimal(1)),
    ],
)
def test_power_equals_the_analytical_multiple_of_pi(rpm, torque, multiple_of_pi):
    # P = rpm x torque x pi / 30,000, so (rpm x torque / 30,000) is the multiple of pi.
    pi = machin_pi()
    with localcontext() as ctx:
        ctx.prec = 120
        expected = Decimal(rpm) * Decimal(torque) / Decimal(30_000) * pi
    got = theoretical_power_kw(rpm, Decimal(torque))
    assert abs(got - expected) < Decimal("1e-45")
    assert abs(Decimal(rpm) * Decimal(torque) / 30_000 - multiple_of_pi) < Decimal(
        "1e-20"
    )


def test_the_pi_constant_agrees_with_an_independent_computation():
    assert abs(model.PI - machin_pi()) < Decimal("1e-48")


def test_zero_torque_is_zero_power_and_shows_no_negative_zero():
    result = run(plan([req()], [pt(torque=0)]))
    assert result.points[0].power_kw == 0.0
    assert "-0.0" not in result.model_dump_json()


def test_the_exact_power_is_not_a_rounded_float():
    # 1500 x 1000 x pi / 30,000 = 157.0796326794896619...
    assert str(theoretical_power_kw(1500, Decimal(1000)))[:20] == "157.0796326794896619"


# ---------- the display-rounding boundary ----------


def test_157_0796_displays_as_157_08_but_falls_below_a_157_08_threshold():
    body = plan(
        [req(power_min_kw=Decimal("157.08"), torque_max_nm=1100)],
        [pt(rpm=1500, torque=1000)],
    )
    result = run(body)
    assert result.points[0].power_kw == 157.08
    r = result.requirements[0]
    assert r.status == "not_covered"
    power = r.point_checks[0].power
    assert power is not None
    assert (power.value, power.minimum) == (157.08, 157.08)
    assert power.met is False
    assert power.equal_when_rounded is True
    assert power.outside_by == 0.0
    assert "-0.0" not in result.model_dump_json()


def test_a_threshold_just_below_the_exact_power_is_met():
    body = plan(
        [req(power_min_kw=Decimal("157.07"), torque_max_nm=1100)],
        [pt(rpm=1500, torque=1000)],
    )
    r = run(body).requirements[0]
    assert r.status == "covered_by_plan"
    assert r.point_checks[0].power.met is True
    assert r.point_checks[0].power.equal_when_rounded is False


def test_a_clearly_unmet_threshold_reports_the_signed_shortfall():
    body = plan(
        [req(power_min_kw=Decimal(160), torque_max_nm=1100)],
        [pt(rpm=1500, torque=1000)],
    )
    power = run(body).requirements[0].point_checks[0].power
    assert (power.met, power.outside_by, power.equal_when_rounded) == (
        False,
        -2.92,
        False,
    )


def test_sampled_nonzero_powers_do_not_land_on_a_two_decimal_value():
    # Spot check: the computed values are finite-precision approximations of an
    # irrational product, so none of these coincides with a 2-decimal threshold.
    for rpm in (1, 977, 1500, 6000):
        for torque in ("0.01", "123.45", "20000"):
            p = theoretical_power_kw(rpm, Decimal(torque))
            assert p != p.quantize(Decimal("0.01"))


# ---------- inclusive bounds ----------


@pytest.mark.parametrize(
    ("rpm", "matches"),
    [
        (999, False),
        (1000, True),
        (1001, True),
        (1999, True),
        (2000, True),
        (2001, False),
    ],
)
def test_speed_bounds_are_inclusive(rpm, matches):
    check = run(plan([req()], [pt(rpm=rpm)])).requirements[0].point_checks[0]
    assert check.rpm.met is matches
    assert check.matches is matches


@pytest.mark.parametrize(
    ("torque", "matches"),
    [
        ("99.99", False),
        ("100", True),
        ("100.01", True),
        ("900", True),
        ("900.01", False),
    ],
)
def test_torque_bounds_are_inclusive(torque, matches):
    point = pt(torque=Decimal(torque))
    check = run(plan([req()], [point])).requirements[0].point_checks[0]
    assert check.torque.met is matches


def test_outside_by_is_negative_below_and_positive_above():
    low = run(plan([req()], [pt(rpm=900)])).requirements[0].point_checks[0].rpm
    high = run(plan([req()], [pt(rpm=2100)])).requirements[0].point_checks[0].rpm
    inside = run(plan([req()], [pt(rpm=1500)])).requirements[0].point_checks[0].rpm
    assert (low.outside_by, high.outside_by, inside.outside_by) == (-100.0, 100.0, 0.0)


def test_a_degenerate_range_is_allowed():
    body = plan([req(rpm_min=1500, rpm_max=1500)], [pt(rpm=1500), pt("Q", rpm=1501)])
    assert run(body).requirements[0].matched_point_ids == ("point-1",)


# ---------- counts, dwell and repeated coordinates ----------


def test_min_points_counts_planned_entries_and_repeats_count_separately():
    points = [
        pt("One", 1500, 500, 10),
        pt("Two", 1500, 500, 10),
        pt("Three", 1500, 500, 10),
    ]
    result = run(plan([req(min_points=3)], points))
    r = result.requirements[0]
    assert r.status == "covered_by_plan"
    assert r.matched_entries == 3
    assert r.matched_distinct_conditions == 1  # disclosed, not deduplicated
    assert "do not establish distinct-condition coverage" in r.explanation
    assert result.summary.distinct_conditions == 1
    assert result.summary.repeated_conditions[0].point_ids == (
        "point-1",
        "point-2",
        "point-3",
    )
    assert [p.same_conditions_as for p in result.points] == [
        ("point-2", "point-3"),
        ("point-1", "point-3"),
        ("point-1", "point-2"),
    ]
    assert result.summary.points_total == 3


def test_distinct_condition_count_is_reported_for_mixed_matches():
    points = [pt("One", 1500, 500), pt("Two", 1500, 500), pt("Three", 1600, 500)]
    r = run(plan([req(min_points=2)], points)).requirements[0]
    assert (r.matched_entries, r.matched_distinct_conditions) == (3, 2)


def test_repeated_holds_add_an_evidence_item_for_a_rationale():
    points = [pt("One", 1500, 500), pt("Two", 1500, 500)]
    items = run(plan([req(min_points=2)], points)).evidence_checklist
    assert any("repeated holds at identical conditions" in i.text for i in items)
    distinct = run(plan([req()], [pt("One", 1500, 500), pt("Two", 1600, 500)]))
    assert not any("repeated holds" in i.text for i in distinct.evidence_checklist)


def test_a_hold_requirement_met_exactly_is_covered_and_one_minute_short_is_partly():
    met = run(plan([req(min_dwell_min=30)], [pt("A", dwell=10), pt("B", dwell=20)]))
    assert met.requirements[0].status == "covered_by_plan"
    short = run(plan([req(min_dwell_min=30)], [pt("A", dwell=10), pt("B", dwell=19)]))
    r = short.requirements[0]
    assert r.status == "partly_covered"
    assert (r.shortfall.entries, r.shortfall.hold_min) == (0, 1)
    assert "1 min of planned hold short" in r.explanation


def test_a_min_points_above_the_plan_size_is_allowed_and_reported():
    matching = run(plan([req(min_points=5)], [pt()])).requirements[0]
    assert matching.status == "partly_covered"
    assert matching.shortfall.entries == 4
    none = run(plan([req(min_points=5, rpm_min=5000, rpm_max=5100)], [pt()]))
    assert none.requirements[0].status == "not_covered"


def test_the_summed_hold_counts_only_matching_entries():
    body = plan(
        [req(rpm_min=1400, rpm_max=1600)],
        [pt("A", 1500, dwell=7), pt("B", 3000, dwell=50)],
    )
    r = run(body).requirements[0]
    assert r.matched_hold_min == 7
    assert run(body).summary.planned_hold_min == 57


def test_the_planned_hold_summary_is_the_sum_of_scheduled_holds_only():
    result = run(GOLDEN)
    assert result.summary.planned_hold_min == sum(p.dwell_min for p in result.points)
    assert "not total elapsed test time" in result.explanation


# ---------- order, determinism, permutations ----------


def test_order_changes_the_timeline_and_steps_but_not_coverage():
    forward = run(GOLDEN)
    reversed_body = copy.deepcopy(GOLDEN)
    reversed_body["points"].reverse()
    backward = run(reversed_body)
    status = lambda r: {x.label: x.status for x in r.requirements}
    assert status(forward) == status(backward)
    assert [p.label for p in backward.points] == [
        "Point D",
        "Point C",
        "Point B",
        "Point A",
    ]
    assert backward.points[1].step_from_previous.delta_rpm == 600
    assert backward.points[0].hold_start_min == 0
    assert backward.points[-1].hold_end_min == forward.summary.planned_hold_min
    assert backward.summary.planned_hold_min == forward.summary.planned_hold_min


def test_requirement_order_does_not_change_each_requirements_result():
    shuffled = copy.deepcopy(GOLDEN)
    shuffled["requirements"].reverse()
    by_label = lambda r: {
        x.label: (x.status, x.matched_hold_min, x.shortfall.entries)
        for x in r.requirements
    }
    assert by_label(run(GOLDEN)) == by_label(run(shuffled))


def test_the_same_plan_gives_identical_output():
    assert run(GOLDEN).model_dump_json() == run(GOLDEN).model_dump_json()


# ---------- coverage is not acceptance ----------


def test_verification_is_always_not_verified_even_when_everything_is_covered():
    all_covered = run(plan([req()], [pt()]))
    assert all_covered.summary.covered_by_plan == 1
    for result in (all_covered, run(GOLDEN)):
        assert result.verification.status == "not_verified"
        assert "not verified" in result.verification.statement
        assert "cannot show" in result.verification.statement


def test_no_response_text_claims_a_pass_or_verification():
    for body in (GOLDEN, plan([req()], [pt()])):
        text = run(body).model_dump_json()
        stripped = re.sub(
            r"not[ _]verified|nothing here is verified|or verified stable operation",
            "",
            text,
            flags=re.IGNORECASE,
        )
        assert not re.search(r"\bpass(ed|es|ing)?\b", stripped, re.IGNORECASE)
        assert not re.search(
            r"verified|validated|certified|proven|proves", stripped, re.IGNORECASE
        )


def test_the_response_schema_has_no_engine_data_fields():
    forbidden = re.compile(
        r"efficien|fuel|emission|bsfc|envelope|curve|derat|limit|map|performance",
        re.IGNORECASE,
    )
    names: set[str] = set()

    def walk(node):
        if isinstance(node, dict):
            names.update(node.get("properties", {}))
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(model.EngineTestPlanEvidence.model_json_schema())
    assert names
    assert not [n for n in names if forbidden.search(n)]


def test_the_assumptions_state_independence_and_the_planning_scope():
    texts = {a.id: a.text for a in run(GOLDEN).assumptions}
    assert "independent of Cummins Inc." in texts["A1"]
    assert "not acceptance or verification" in texts["A3"]
    assert "not total elapsed test time" in texts["A6"]
    assert "separate entries" in texts["A5"]
    assert list(texts) == [f"A{n}" for n in range(1, 10)]


# ---------- validation ----------


def error_fields(body: dict) -> set[str]:
    try:
        request = EngineTestPlanInput.model_validate(body)
    except ValidationError as exc:
        return {d["field"] for d in validation_details(exc)}
    return {d["field"] for d in cross_field_errors(request)}


def with_point(**kw) -> dict:
    body = copy.deepcopy(GOLDEN)
    body["points"][0].update(kw)
    return body


def with_req(**kw) -> dict:
    body = copy.deepcopy(GOLDEN)
    body["requirements"][0].update(kw)
    return body


def test_the_golden_plan_is_valid():
    assert error_fields(GOLDEN) == set()


@pytest.mark.parametrize(
    ("body", "field"),
    [
        (with_point(rpm=0), "points.0.rpm"),
        (with_point(rpm=6001), "points.0.rpm"),
        (with_point(rpm=1500.5), "points.0.rpm"),
        (with_point(rpm=Decimal("1500.0")), "points.0.rpm"),
        (with_point(rpm="1500"), "points.0.rpm"),
        (with_point(rpm=True), "points.0.rpm"),
        (with_point(rpm=None), "points.0.rpm"),
        (with_point(torque_nm=-1), "points.0.torque_nm"),
        (with_point(torque_nm=Decimal("20000.01")), "points.0.torque_nm"),
        (with_point(torque_nm=Decimal("1.234")), "points.0.torque_nm"),
        (with_point(torque_nm=Decimal("NaN")), "points.0.torque_nm"),
        (with_point(torque_nm="5"), "points.0.torque_nm"),
        (with_point(dwell_min=0), "points.0.dwell_min"),
        (with_point(dwell_min=481), "points.0.dwell_min"),
        (with_point(dwell_min=1.5), "points.0.dwell_min"),
        (with_point(label=""), "points.0.label"),
        (with_point(label="x" * 41), "points.0.label"),
        (with_point(label="a\x00b"), "points.0.label"),
        (with_point(label="   "), "points.0.label"),
        (with_point(extra=1), "points.0.extra"),
        (with_req(rpm_min=0), "requirements.0.rpm_min"),
        (with_req(rpm_max=6001), "requirements.0.rpm_max"),
        (with_req(torque_min_nm=-0.01), "requirements.0.torque_min_nm"),
        (with_req(torque_max_nm=Decimal("20000.01")), "requirements.0.torque_max_nm"),
        (with_req(power_min_kw=0), "requirements.0.power_min_kw"),
        (with_req(power_min_kw=20001), "requirements.0.power_min_kw"),
        (with_req(power_min_kw=Decimal("1.234")), "requirements.0.power_min_kw"),
        (with_req(power_min_kw="5"), "requirements.0.power_min_kw"),
        (with_req(min_points=0), "requirements.0.min_points"),
        (with_req(min_points=13), "requirements.0.min_points"),
        (with_req(min_dwell_min=-1), "requirements.0.min_dwell_min"),
        (with_req(min_dwell_min=1441), "requirements.0.min_dwell_min"),
        (with_req(min_points=True), "requirements.0.min_points"),
        (with_req(engine_limit=3), "requirements.0.engine_limit"),
    ],
)
def test_single_field_errors_name_the_field(body, field):
    assert field in error_fields(body)


def test_optional_fields_default_and_null_power_is_accepted():
    body = with_req(power_min_kw=None)
    for key in ("min_points", "min_dwell_min"):
        body["requirements"][0].pop(key, None)
    assert error_fields(body) == set()
    r = run(body).inputs.requirements[0]
    assert (r.power_min_kw, r.min_points, r.min_dwell_min) == (None, 1, 0)


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("objective", ""),
        ("objective", "x" * 81),
        ("objective", 5),
        ("requirements", []),
        ("requirements", [copy.deepcopy(GOLDEN["requirements"][0])] * 0),
        ("requirements", "x"),
        ("points", []),
        ("points", None),
    ],
)
def test_top_level_errors(key, value):
    body = copy.deepcopy(GOLDEN)
    body[key] = value
    assert key in error_fields(body)


def test_list_size_limits():
    many_requirements = [req(label=f"R{i}") for i in range(11)]
    assert "requirements" in error_fields(plan(many_requirements, [pt()]))
    assert error_fields(plan(many_requirements[:10], [pt()])) == set()
    many_points = [pt(label=f"P{i}", dwell=1) for i in range(13)]
    assert "points" in error_fields(plan([req()], many_points))
    assert error_fields(plan([req()], many_points[:12])) == set()


def test_missing_required_fields_are_field_errors():
    body = copy.deepcopy(GOLDEN)
    del body["points"][1]["rpm"]
    assert "points.1.rpm" in error_fields(body)


def test_cross_field_rules():
    body = with_req(rpm_min=1300, rpm_max=1200)
    assert error_fields(body) == {"requirements.0.rpm_max"}
    body = with_req(torque_min_nm=500, torque_max_nm=Decimal("499.99"))
    assert error_fields(body) == {"requirements.0.torque_max_nm"}
    body = copy.deepcopy(GOLDEN)
    body["requirements"][2]["label"] = " r1 low-speed "
    assert error_fields(body) == {"requirements.2.label"}
    body = copy.deepcopy(GOLDEN)
    body["points"][3]["label"] = "POINT a"
    assert error_fields(body) == {"points.3.label"}


def test_a_requirement_and_a_point_may_share_a_label():
    body = copy.deepcopy(GOLDEN)
    body["points"][0]["label"] = body["requirements"][0]["label"]
    assert error_fields(body) == set()


def test_total_planned_hold_is_limited_to_1440_minutes():
    twelve = [pt(label=f"P{i}", dwell=120) for i in range(12)]
    assert error_fields(plan([req()], twelve)) == set()  # exactly 1,440
    twelve[0]["dwell_min"] = 121
    assert error_fields(plan([req()], twelve)) == {"points"}


def test_reasons_never_repeat_submitted_values():
    body = with_point(rpm=987654, label="SECRET")
    body["requirements"][0]["label"] = "SECRET"
    body["requirements"][1]["label"] = "secret"
    try:
        EngineTestPlanInput.model_validate(body)
    except ValidationError as exc:
        text = json.dumps(validation_details(exc))
    else:  # pragma: no cover
        raise AssertionError("expected a validation error")
    assert "987654" not in text
    reasons = json.dumps(
        cross_field_errors(EngineTestPlanInput.model_validate(with_req(label="X")))
    )
    assert "SECRET" not in reasons


def test_the_model_refuses_an_invalid_request_on_its_own():
    request = EngineTestPlanInput.model_validate(with_req(rpm_min=1300, rpm_max=1200))
    with pytest.raises(model.RuleError):
        run_engine_test_plan(request)


def test_the_label_is_trimmed_and_unicode_text_is_kept():
    body = with_point(label="  Pointe é µ  ")
    assert run(body).points[0].label == "Pointe é µ"


def test_the_largest_valid_plan_runs():
    requirements = [
        req(
            label=f"{i:02d}" + "n" * 38,
            rpm_min=1,
            rpm_max=6000,
            torque_min_nm=0,
            torque_max_nm=20000,
            power_min_kw=Decimal("12566.37"),
            min_points=12,
            min_dwell_min=1440,
        )
        for i in range(10)
    ]
    points = [
        pt(label=f"{i:02d}" + "n" * 38, rpm=6000, torque=Decimal(20000), dwell=120)
        for i in range(12)
    ]
    result = run(plan(requirements, points))
    assert result.points[0].power_kw == 12566.37  # 4000 pi
    assert all(r.status == "covered_by_plan" for r in result.requirements)
