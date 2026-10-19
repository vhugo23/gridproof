"""Hand-calculated checks of the synthetic capacity screening model (no database).

Every expected number below was worked out on paper before the model was run.
Packages (rated kW / rated kVA): A 200/250, B 320/400, C 480/600, D 640/800.

    demand kVA   = kW / power factor
    required kW  = kW  x (1 + margin / 100)
    required kVA = kVA x (1 + margin / 100)
    margin       = capacity - required;  margin % = margin / required x 100
"""

import ast
import inspect
from decimal import Decimal

import pytest
from pydantic import ValidationError

import app.domain.capacity_check as cc
from app.domain.capacity_check import CapacityCheckInput, run_capacity_check
from app.domain.system_config import validation_details


def run(kw, pf, margin=0):
    return run_capacity_check(
        CapacityCheckInput(
            real_power_kw=kw, power_factor=Decimal(pf), capacity_margin_pct=margin
        )
    )


def row(evidence, package):
    """{requirement_id: (status, required, capacity, margin, margin_pct)} for a package."""
    result = next(p for p in evidence.packages if p.id == f"synthetic-{package}")
    return {
        r.requirement_id: (
            r.status,
            r.required,
            r.capacity,
            r.margin,
            r.margin_pct_of_required,
        )
        for r in result.requirements
    }


def test_packages_are_fixed_synthetic_and_independent_of_fridley():
    assert [(p.id, p.rated_kw, p.rated_kva) for p in cc.PACKAGES] == [
        ("synthetic-a", 200, 250),
        ("synthetic-b", 320, 400),
        ("synthetic-c", 480, 600),
        ("synthetic-d", 640, 800),
    ]
    assert all(p.label.startswith("Synthetic Package ") for p in cc.PACKAGES)
    assert all(p.rated_kw * 5 == p.rated_kva * 4 for p in cc.PACKAGES)  # pf 0.8
    assert 250 not in {p.rated_kw for p in cc.PACKAGES}  # Fridley's generators
    imported = {
        node.module
        for node in ast.walk(ast.parse(inspect.getsource(cc)))
        if isinstance(node, ast.ImportFrom)
    }
    assert "app.domain.startup_check" not in imported
    names = {
        alias.name
        for node in ast.walk(ast.parse(inspect.getsource(cc)))
        if isinstance(node, ast.ImportFrom)
        for alias in node.names
    }
    assert "SystemConfigV1" not in names  # only the generic RuleError is shared


def test_case_1_400_kw_at_0_8_pf_no_margin():
    ev = run(400, "0.80")
    assert ev.demand.apparent_power_kva == 500.0
    assert (ev.demand.required_kw, ev.demand.required_kva) == (400.0, 500.0)
    assert row(ev, "a") == {
        "KW_CAPACITY": ("fail", 400.0, 200, -200.0, -50.0),
        "KVA_CAPACITY": ("fail", 500.0, 250, -250.0, -50.0),
    }
    assert row(ev, "b") == {
        "KW_CAPACITY": ("fail", 400.0, 320, -80.0, -20.0),
        "KVA_CAPACITY": ("fail", 500.0, 400, -100.0, -20.0),
    }
    assert row(ev, "c") == {
        "KW_CAPACITY": ("pass", 400.0, 480, 80.0, 20.0),
        "KVA_CAPACITY": ("pass", 500.0, 600, 100.0, 20.0),
    }
    assert row(ev, "d") == {
        "KW_CAPACITY": ("pass", 400.0, 640, 240.0, 60.0),
        "KVA_CAPACITY": ("pass", 500.0, 800, 300.0, 60.0),
    }
    assert [p.both_requirements_pass for p in ev.packages] == [
        False,
        False,
        True,
        True,
    ]


def test_case_2_split_verdict_kw_passes_while_kva_fails():
    # 300 / 0.70 = 428.571428... kVA
    ev = run(300, "0.70")
    assert ev.demand.apparent_power_kva == 428.57
    assert row(ev, "b") == {
        "KW_CAPACITY": ("pass", 300.0, 320, 20.0, 6.67),
        "KVA_CAPACITY": ("fail", 428.57, 400, -28.57, -6.67),
    }
    assert row(ev, "c") == {
        "KW_CAPACITY": ("pass", 300.0, 480, 180.0, 60.0),
        "KVA_CAPACITY": ("pass", 428.57, 600, 171.43, 40.0),
    }
    b = next(p for p in ev.packages if p.id == "synthetic-b")
    assert not b.both_requirements_pass
    assert [r.status for r in b.requirements] == ["pass", "fail"]


def test_case_3_margin_boundary_equal_passes_one_over_fails():
    # 400 kW at pf 1.00: kVA equals kW.
    at = run(400, "1.00", margin=20)  # required 480 exactly
    assert (at.demand.required_kw, at.demand.required_kva) == (480.0, 480.0)
    assert row(at, "c") == {
        "KW_CAPACITY": ("pass", 480.0, 480, 0.0, 0.0),
        "KVA_CAPACITY": ("pass", 480.0, 600, 120.0, 25.0),
    }
    assert row(at, "b") == {
        "KW_CAPACITY": ("fail", 480.0, 320, -160.0, -33.33),
        "KVA_CAPACITY": ("fail", 480.0, 400, -80.0, -16.67),
    }
    over = run(400, "1.00", margin=21)  # required 484
    assert row(over, "c") == {
        "KW_CAPACITY": ("fail", 484.0, 480, -4.0, -0.83),
        "KVA_CAPACITY": ("pass", 484.0, 600, 116.0, 23.97),
    }
    under = run(400, "1.00", margin=19)  # required 476
    assert row(under, "c")["KW_CAPACITY"] == ("pass", 476.0, 480, 4.0, 0.84)


def test_case_4_package_rating_boundary():
    at = run(320, "0.80")  # 400 kVA exactly
    assert row(at, "b") == {
        "KW_CAPACITY": ("pass", 320.0, 320, 0.0, 0.0),
        "KVA_CAPACITY": ("pass", 400.0, 400, 0.0, 0.0),
    }
    over = run(321, "0.80")  # 401.25 kVA
    assert row(over, "b") == {
        "KW_CAPACITY": ("fail", 321.0, 320, -1.0, -0.31),
        "KVA_CAPACITY": ("fail", 401.25, 400, -1.25, -0.31),
    }


@pytest.mark.parametrize(
    "kw, pf, margin, kva_capacity",
    [(228, "0.57", 0, 400), (95, "0.57", 50, 250)],
)
def test_case_5_exactness_trap_where_float_division_would_fail(
    kw, pf, margin, kva_capacity
):
    """228 / 0.57 is exactly 400 and 95 x 1.5 / 0.57 is exactly 250 (by hand).

    In binary floats they are 400.00000000000006 and 250.00000000000003, which
    would wrongly fail an exact-fit package.
    """
    assert float(kw) * (1 + margin / 100) / float(pf) > kva_capacity  # the trap
    ev = run(kw, pf, margin)
    package = "b" if kva_capacity == 400 else "a"
    assert row(ev, package)["KVA_CAPACITY"] == (
        "pass",
        float(kva_capacity),
        kva_capacity,
        0.0,
        0.0,
    )


def test_case_6_kva_passes_while_kw_fails():
    ev = run(340, "0.85")  # 340 / 0.85 = 400 kVA exactly
    assert ev.demand.apparent_power_kva == 400.0
    assert row(ev, "b") == {
        "KW_CAPACITY": ("fail", 340.0, 320, -20.0, -5.88),
        "KVA_CAPACITY": ("pass", 400.0, 400, 0.0, 0.0),
    }


def test_case_7_power_factor_one_makes_kva_equal_kw():
    ev = run(200, "1.00")
    assert ev.demand.apparent_power_kva == 200.0
    assert row(ev, "a") == {
        "KW_CAPACITY": ("pass", 200.0, 200, 0.0, 0.0),
        "KVA_CAPACITY": ("pass", 200.0, 250, 50.0, 25.0),
    }


def test_case_8_extremes():
    smallest = run(1, "1.00")
    assert all(p.both_requirements_pass for p in smallest.packages)
    assert row(smallest, "a")["KW_CAPACITY"] == ("pass", 1.0, 200, 199.0, 19900.0)

    largest = run(2000, "0.50", margin=50)
    assert largest.demand.apparent_power_kva == 4000.0
    assert (largest.demand.required_kw, largest.demand.required_kva) == (
        3000.0,
        6000.0,
    )
    assert not any(p.both_requirements_pass for p in largest.packages)
    assert row(largest, "d") == {
        "KW_CAPACITY": ("fail", 3000.0, 640, -2360.0, -78.67),
        "KVA_CAPACITY": ("fail", 6000.0, 800, -5200.0, -86.67),
    }


def test_case_9_display_rounds_half_up_not_to_even():
    # 2 / 0.64 = 3.125 exactly; half-up gives 3.13 (round-half-even would give 3.12).
    ev = run(2, "0.64")
    assert ev.demand.apparent_power_kva == 3.13
    # 250 - 3.125 = 246.875 -> 246.88; 246.875 / 3.125 = 79 -> 7900.00 %.
    assert row(ev, "a")["KVA_CAPACITY"] == ("pass", 3.13, 250, 246.88, 7900.0)


def test_explanations_state_the_exact_numbers():
    ev = run(300, "0.70")
    b = next(p for p in ev.packages if p.id == "synthetic-b")
    assert b.requirements[0].explanation == (
        "Required real power is 300.00 kW (demand), within the 320 kW rating; "
        "20.00 kW spare."
    )
    assert b.requirements[1].explanation == (
        "Required apparent power is 428.57 kVA (demand), above the 400 kVA "
        "rating by 28.57 kVA."
    )
    with_margin = run(400, "1.00", margin=21)
    c = next(p for p in with_margin.packages if p.id == "synthetic-c")
    assert "demand plus 21% margin" in c.requirements[0].explanation


def test_no_negative_zero_in_displayed_values():
    # 2 / 0.64 with margin leaves tiny exact remainders; none may print as -0.0.
    for kw, pf, margin in [(1, "0.50", 0), (3, "0.60", 7), (228, "0.57", 0)]:
        text = run(kw, pf, margin).model_dump_json()
        assert "-0.0," not in text and "-0.0}" not in text


def test_evidence_has_no_score_ranking_or_recommendation():
    ev = run(400, "0.80")
    # The assumptions legitimately say "not a product recommendation"; everything
    # else (field names and results) must carry no such concept.
    text = ev.model_copy(update={"assumptions": ()}).model_dump_json().lower()
    for banned in ("recommend", "score", "rank", "best", "winner", "suitable"):
        assert banned not in text
    assert set(ev.model_dump()) == {
        "model_version",
        "inputs",
        "demand",
        "assumptions",
        "packages",
    }
    assert [p.id for p in ev.packages] == [
        "synthetic-a",
        "synthetic-b",
        "synthetic-c",
        "synthetic-d",
    ]
    ids = [a.id for a in ev.assumptions]
    assert ids == [f"A{i}" for i in range(1, len(ids) + 1)]
    joined = " ".join(a.text for a in ev.assumptions).lower()
    assert "not cummins products" in joined and "not a complete sizing" in joined


def test_identical_input_gives_identical_evidence():
    first = run(300, "0.70", 5).model_dump_json()
    assert run(300, "0.70", 5).model_dump_json() == first


def fields_failing(**values):
    with pytest.raises(ValidationError) as excinfo:
        CapacityCheckInput.model_validate(values)
    return {d["field"]: d["reason"] for d in validation_details(excinfo.value)}


GOOD = {"real_power_kw": 400, "power_factor": Decimal("0.8")}


@pytest.mark.parametrize("value", [0, 2001, -1, 1.5, "400", True, None, Decimal(400)])
def test_real_power_must_be_a_whole_number_from_1_to_2000(value):
    errors = fields_failing(**{**GOOD, "real_power_kw": value})
    assert set(errors) == {"real_power_kw"}


@pytest.mark.parametrize(
    "value",
    [
        Decimal("0.49"),
        Decimal("1.01"),
        Decimal("0.855"),
        "0.8",
        True,
        None,
        0,
        2,
        0.8,
    ],
)
def test_power_factor_must_be_an_exact_number_from_0_50_to_1_00(value):
    errors = fields_failing(**{**GOOD, "power_factor": value})
    assert set(errors) == {"power_factor"}


def test_power_factor_accepts_the_bounds_and_the_integer_one():
    assert CapacityCheckInput(real_power_kw=1, power_factor=1).power_factor == 1
    assert CapacityCheckInput(
        real_power_kw=1, power_factor=Decimal("0.50")
    ).power_factor == Decimal("0.50")
    assert CapacityCheckInput(
        real_power_kw=1, power_factor=Decimal("1.00")
    ).power_factor == Decimal("1.00")


@pytest.mark.parametrize("value", [-1, 51, 10.5, "10", True, None])
def test_margin_must_be_a_whole_number_from_0_to_50(value):
    errors = fields_failing(**{**GOOD, "capacity_margin_pct": value})
    assert set(errors) == {"capacity_margin_pct"}


def test_margin_is_optional_and_defaults_to_zero_but_the_others_are_required():
    assert CapacityCheckInput.model_validate(GOOD).capacity_margin_pct == 0
    assert fields_failing(power_factor=Decimal("0.8")) == {"real_power_kw": "Required"}
    assert fields_failing(real_power_kw=400) == {"power_factor": "Required"}


def test_unknown_fields_are_rejected_and_values_are_never_echoed():
    errors = fields_failing(**GOOD, snapshot={"x": 1}, real_power_kw_extra=7)
    assert errors == {
        "snapshot": "Unknown field",
        "real_power_kw_extra": "Unknown field",
    }
    secret = fields_failing(**{**GOOD, "real_power_kw": "SECRET-VALUE"})
    assert "SECRET-VALUE" not in str(secret)
