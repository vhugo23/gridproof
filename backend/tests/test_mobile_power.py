"""Mobile-site power model (doc 05 API-19). Expected values are computed by hand.

Sample site, 25 % margin (load: quantity x rated kW = connected kW, x simultaneity =
demand kW):

    LED floodlights    8 x  0.40 =  3.20, x 1.00 =  3.20
    Cabin HVAC         2 x  7.50 = 15.00, x 0.80 = 12.00
    Welding machines   3 x 12.00 = 36.00, x 0.50 = 18.00
    Air compressor     1 x 22.00 = 22.00, x 0.75 = 16.50
    Water pumps        2 x  5.50 = 11.00, x 0.50 =  5.50

Connected 87.20 kW; demand 55.20 kW; overall simultaneity 55.2 / 87.2 = 63.30 %.
Required = 55.2 x 1.25 = 69.00 kW; all-simultaneous = 87.2 x 1.25 = 109.00 kW.
Shares of demand: 3.2 / 55.2 = 5.80 %, 12 / 55.2 = 21.74 %, 18 / 55.2 = 32.61 %,
16.5 / 55.2 = 29.89 %, 5.5 / 55.2 = 9.96 % (sum 100.00).
Packages (30 / 60 / 100 / 150 kW), utilization = required / rating:
    M1: 69 / 30 = 230.00 %, headroom -39.00; 109 / 30 = 363.33 %, headroom -79.00
    M2: 69 / 60 = 115.00 %, headroom -9.00;  109 / 60 = 181.67 %, headroom -49.00
    M3: 69 / 100 = 69.00 %, headroom 31.00;  109 / 100 = 109.00 %, headroom -9.00
    M4: 69 / 150 = 46.00 %, headroom 81.00;  109 / 150 = 72.67 %, headroom 41.00
"""

import math
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.domain.mobile_power import (
    MODEL_VERSION,
    MobilePowerInput,
    cross_field_errors,
    run_mobile_power,
)
from app.domain.system_config import validation_details

D = Decimal

SAMPLE = [
    ("LED floodlights", 8, "0.40", "1.00"),
    ("Cabin HVAC", 2, "7.50", "0.80"),
    ("Welding machines", 3, "12.00", "0.50"),
    ("Air compressor", 1, "22.00", "0.75"),
    ("Water pumps", 2, "5.50", "0.50"),
]

NOT_MET = "does_not_meet_modeled"
MODELED_ONLY = "meets_modeled_only"
BOTH = "meets_modeled_and_all_simultaneous"


def payload(loads=SAMPLE, margin=25):
    body = {
        "loads": [
            {
                "name": n,
                "quantity": q,
                "rated_kw": D(kw),
                "simultaneity_factor": D(s),
            }
            for n, q, kw, s in loads
        ],
    }
    if margin is not None:
        body["capacity_margin_pct"] = margin
    return body


def make(loads=SAMPLE, margin=25) -> MobilePowerInput:
    return MobilePowerInput.model_validate(payload(loads, margin))


def run(loads=SAMPLE, margin=25):
    return run_mobile_power(make(loads, margin))


def errors_for(body) -> list[dict[str, str]]:
    try:
        request = MobilePowerInput.model_validate(body)
    except ValidationError as exc:
        return validation_details(exc)
    return cross_field_errors(request)


def package(result, package_id):
    return next(p for p in result.packages if p.id == package_id)


# ---------- hand-calculated sample ----------


def test_the_hand_calculated_sample_totals():
    result = run()
    assert result.model_version == MODEL_VERSION == "mobile-power-v1"
    assert result.totals.connected_kw == 87.2
    assert result.totals.demand_kw == 55.2
    assert result.totals.overall_simultaneity_pct == 63.3
    assert result.totals.required_kw == 69.0
    assert result.totals.all_simultaneous_required_kw == 109.0
    assert result.inputs.capacity_margin_pct == 25


def test_the_hand_calculated_sample_loads():
    result = run()
    assert [l.id for l in result.loads] == [f"load-{i}" for i in range(1, 6)]
    assert [l.connected_kw for l in result.loads] == [3.2, 15.0, 36.0, 22.0, 11.0]
    assert [l.demand_kw for l in result.loads] == [3.2, 12.0, 18.0, 16.5, 5.5]
    assert [l.share_of_demand_pct for l in result.loads] == [
        5.8,
        21.74,
        32.61,
        29.89,
        9.96,
    ]
    assert sum(l.share_of_demand_pct for l in result.loads) == pytest.approx(100.0)
    assert [l.is_dominant for l in result.loads] == [False, False, True, False, False]
    assert result.dominant_load_ids == ("load-3",)
    assert result.loads[2].name == "Welding machines"
    assert result.loads[0].quantity == 8
    assert result.loads[0].rated_kw == 0.4
    assert result.loads[0].simultaneity_factor == 1.0


def test_the_hand_calculated_sample_packages():
    result = run()
    assert [p.id for p in result.packages] == [
        "mobile-m1",
        "mobile-m2",
        "mobile-m3",
        "mobile-m4",
    ]
    assert [p.rated_kw for p in result.packages] == [30, 60, 100, 150]
    assert [p.label for p in result.packages] == [
        f"Synthetic Mobile Package M{i}" for i in range(1, 5)
    ]
    expected = {
        # id: (modeled headroom, modeled util, all-sim headroom, all-sim util)
        "mobile-m1": (-39.0, 230.0, -79.0, 363.33),
        "mobile-m2": (-9.0, 115.0, -49.0, 181.67),
        "mobile-m3": (31.0, 69.0, -9.0, 109.0),
        "mobile-m4": (81.0, 46.0, 41.0, 72.67),
    }
    for package_id, (mh, mu, sh, su) in expected.items():
        p = package(result, package_id)
        assert p.modeled_demand.required == 69.0
        assert p.modeled_demand.capacity == p.rated_kw
        assert p.modeled_demand.headroom_kw == mh
        assert p.modeled_demand.utilization_pct == mu
        assert p.modeled_demand.comparator == "<="
        assert p.all_simultaneous.required == 109.0
        assert p.all_simultaneous.capacity == p.rated_kw
        assert p.all_simultaneous.headroom_kw == sh
        assert p.all_simultaneous.utilization_pct == su
    assert [p.modeled_demand.status for p in result.packages] == [
        "does_not_meet",
        "does_not_meet",
        "meets",
        "meets",
    ]
    assert [p.all_simultaneous.status for p in result.packages] == [
        "does_not_meet",
        "does_not_meet",
        "does_not_meet",
        "meets",
    ]
    assert [p.category for p in result.packages] == [
        NOT_MET,
        NOT_MET,
        MODELED_ONLY,
        BOTH,
    ]
    assert [p.category_label for p in result.packages] == [
        "Does not meet modeled demand",
        "Does not meet modeled demand",
        "Meets modeled demand only",
        "Meets both modeled and all-simultaneous demand",
    ]


def test_explanations_are_server_text_without_ranking_or_recommendation():
    result = run()
    assert result.explanation.startswith(
        "The load with the most modeled demand is Welding machines: 18.00 kW of 55.20 kW "
        "(32.61% of modeled demand)"
    )
    # 55.20 kW is modeled demand from the user's assumptions, never a measured peak.
    assert "modeled demand is 55.20 kW" in result.explanation
    assert "follows from your simultaneity assumptions" in result.explanation
    assert "not a measured or guaranteed peak" in result.explanation
    m3 = package(result, "mobile-m3")
    assert "69.00 kW" in m3.explanation and "100.00 kW" in m3.explanation
    assert "109.00 kW" in m3.explanation
    everything = " ".join(
        [result.explanation, *(p.explanation for p in result.packages)]
    ).lower()
    for word in ("recommend", "best", "ranked", "smallest", "choose", "select"):
        assert word not in everything


def test_assumptions_state_the_user_entered_and_kw_only_limits():
    result = run()
    text = " ".join(a.text for a in result.assumptions)
    assert [a.id for a in result.assumptions][:2] == ["A1", "A2"]
    assert "not Cummins" in text
    # Refinement A: simultaneity is a planning assumption, not a measurement.
    assert "user-entered planning assumption" in text
    assert "not a measured peak concurrency" in text
    assert "operating schedule" in text
    # Refinement B: steady-state kW only.
    assert "steady-state real power (kW) only" in text
    for word in (
        "kVA",
        "power factor",
        "voltage",
        "motor starting",
        "step loading",
        "derating",
        "protection",
        "fuel",
        "emissions",
        "equipment suitability",
    ):
        assert word in text, word


# ---------- boundaries and exact comparison ----------


def test_equality_passes_exactly_at_the_package_rating():
    # 80.00 x 1.25 = 100 exactly.
    result = run([("Load", 1, "80.00", "1.00")])
    m3 = package(result, "mobile-m3")
    assert m3.modeled_demand.status == "meets"
    assert m3.modeled_demand.headroom_kw == 0.0
    assert m3.modeled_demand.utilization_pct == 100.0
    assert m3.category == BOTH


def test_80_01_kw_with_25_percent_margin_fails_the_100_kw_package():
    # 80.01 x 1.25 = 100.0125 exactly, shown as 100.01 kW.
    result = run([("Load", 1, "80.01", "1.00")])
    assert result.totals.required_kw == 100.01
    m3 = package(result, "mobile-m3")
    assert m3.modeled_demand.required == 100.01
    assert m3.modeled_demand.status == "does_not_meet"
    assert m3.modeled_demand.headroom_kw == -0.01
    assert m3.category == NOT_MET


def test_the_100_003125_kw_requirement_is_exactly_above_100_though_it_serializes_as_100():
    from fractions import Fraction

    # Premise, in exact arithmetic: 320.01 kW x 0.25 x 1.25 is 100.003125 kW.
    exact = Fraction(32001, 100) * Fraction(25, 100) * Fraction(125, 100)
    assert exact == Fraction(100003125, 1000000)
    assert exact > 100
    assert round(float(exact), 2) == 100.0  # what a 2-decimal display shows

    result = run([("Load", 1, "320.01", "0.25")])
    m3 = package(result, "mobile-m3")
    # The serialized requirement equals the rating, yet the verdict is "does not meet".
    assert m3.modeled_demand.required == m3.modeled_demand.capacity == 100.0
    assert m3.modeled_demand.status == "does_not_meet"
    assert m3.modeled_demand.headroom_kw == 0.0
    assert m3.modeled_demand.utilization_pct == 100.0
    assert m3.category == NOT_MET
    # The 150 kW package meets modeled demand; the all-simultaneous 400.01 kW is above it.
    assert package(result, "mobile-m4").category == MODELED_ONLY
    # The server's own explanation says why an apparent equality fails.
    assert "above the 100.00 kW rating by less than 0.01 kW" in m3.explanation
    assert "exact values" in m3.explanation
    assert "does not meet modeled demand" in m3.explanation


def test_a_shortfall_hidden_by_rounding_still_fails_on_the_exact_value():
    # 320.01 kW x 0.25 = 80.0025 kW demand; x 1.25 = 100.003125 kW required, which
    # displays as exactly 100.00 kW but is above the 100 kW rating.
    result = run([("Load", 1, "320.01", "0.25")])
    assert result.totals.required_kw == 100.0
    m3 = package(result, "mobile-m3")
    assert m3.modeled_demand.required == 100.0
    assert m3.modeled_demand.capacity == 100.0
    assert m3.modeled_demand.status == "does_not_meet"
    assert m3.category == NOT_MET
    # The displayed headroom is zero, never negative zero.
    assert m3.modeled_demand.headroom_kw == 0.0
    assert math.copysign(1, m3.modeled_demand.headroom_kw) == 1.0
    assert "less than 0.01 kW" in m3.explanation


def test_a_pass_that_displays_as_the_rating_still_passes_on_the_exact_value():
    # 499.98 x 0.16 = 79.9968 demand; x 1.25 = 99.996 required, displayed 100.00.
    result = run([("Load", 1, "499.98", "0.16")])
    assert result.totals.required_kw == 100.0
    m3 = package(result, "mobile-m3")
    assert m3.modeled_demand.status == "meets"
    assert m3.modeled_demand.headroom_kw == 0.0
    assert math.copysign(1, m3.modeled_demand.headroom_kw) == 1.0


def test_exact_arithmetic_beats_binary_floats_when_summing_loads():
    # 4.83 + 20.30 + 4.87 is exactly 30.00 kW, but binary floats add up to
    # 30.000000000000004 and would wrongly fail the 30 kW package.
    assert 4.83 + 20.30 + 4.87 > 30.0
    result = run(
        [("A", 1, "4.83", "1.00"), ("B", 1, "20.30", "1.00"), ("C", 1, "4.87", "1.00")],
        margin=0,
    )
    m1 = package(result, "mobile-m1")
    assert result.totals.required_kw == 30.0
    assert m1.modeled_demand.status == "meets"
    assert m1.all_simultaneous.status == "meets"
    assert m1.category == BOTH


def test_demand_above_every_package_means_no_package_meets_it():
    result = run([("Big", 1, "200.00", "1.00")], margin=0)
    assert [p.category for p in result.packages] == [NOT_MET] * 4
    assert [p.modeled_demand.headroom_kw for p in result.packages] == [
        -170.0,
        -140.0,
        -100.0,
        -50.0,
    ]
    assert "no single synthetic package" in result.explanation.lower()
    assert "paralleling" in result.explanation.lower()


def test_all_simultaneity_factors_of_one_make_the_two_comparisons_identical():
    result = run([("A", 2, "10.00", "1.00"), ("B", 1, "5.00", "1.00")], margin=10)
    assert result.totals.connected_kw == result.totals.demand_kw == 25.0
    assert result.totals.overall_simultaneity_pct == 100.0
    assert result.totals.required_kw == result.totals.all_simultaneous_required_kw
    assert result.totals.required_kw == 27.5
    for p in result.packages:
        assert p.modeled_demand.status == p.all_simultaneous.status
        assert p.category in (NOT_MET, BOTH)
        assert p.modeled_demand.utilization_pct == p.all_simultaneous.utilization_pct
    assert [p.category for p in result.packages] == [BOTH] * 4


def test_the_all_simultaneous_requirement_is_never_below_the_modeled_one():
    for loads in (SAMPLE, [("A", 1, "1.00", "0.01")], [("A", 3, "9.99", "0.99")]):
        result = run(loads)
        assert result.totals.all_simultaneous_required_kw >= result.totals.required_kw


def test_equal_demands_tie_for_dominance_and_all_are_reported():
    # A: 1 x 10 x 0.5 = 5; B: 1 x 5 x 1.0 = 5; C: 1 x 2 x 1.0 = 2. Demand 12.
    result = run(
        [("A", 1, "10.00", "0.50"), ("B", 1, "5.00", "1.00"), ("C", 1, "2.00", "1.00")],
        margin=0,
    )
    assert result.totals.demand_kw == 12.0
    assert result.totals.connected_kw == 17.0
    assert result.totals.overall_simultaneity_pct == 70.59
    assert [l.share_of_demand_pct for l in result.loads] == [41.67, 41.67, 16.67]
    assert result.dominant_load_ids == ("load-1", "load-2")
    assert [l.is_dominant for l in result.loads] == [True, True, False]
    assert result.explanation.startswith("A and B tie for the most modeled demand")


def test_a_single_load_is_one_hundred_percent_of_demand():
    result = run([("Pump", 2, "3.00", "0.50")], margin=10)
    assert result.totals.connected_kw == 6.0
    assert result.totals.demand_kw == 3.0
    assert result.totals.overall_simultaneity_pct == 50.0
    assert result.totals.required_kw == 3.3
    assert result.totals.all_simultaneous_required_kw == 6.6
    assert result.loads[0].share_of_demand_pct == 100.0
    assert result.dominant_load_ids == ("load-1",)


def test_the_margin_defaults_to_zero():
    result = run_mobile_power(make(margin=None))
    assert result.inputs.capacity_margin_pct == 0
    assert result.totals.required_kw == 55.2
    assert result.totals.all_simultaneous_required_kw == 87.2


def test_the_same_input_gives_identical_output():
    assert run().model_dump_json() == run().model_dump_json()


def test_loads_are_reported_in_the_order_entered_not_sorted():
    result = run([("Small", 1, "1.00", "1.00"), ("Large", 1, "9.00", "1.00")])
    assert [l.name for l in result.loads] == ["Small", "Large"]


# ---------- validation ----------


def valid_load(**changes):
    load = {
        "name": "Load",
        "quantity": 1,
        "rated_kw": D("1.00"),
        "simultaneity_factor": D("1.00"),
    }
    load.update(changes)
    return load


def body_with(**changes):
    return {"loads": [valid_load(**changes)], "capacity_margin_pct": 0}


def test_a_valid_minimal_request_has_no_errors():
    assert errors_for(body_with()) == []


@pytest.mark.parametrize(
    ("changes", "field"),
    [
        ({"name": ""}, "loads.0.name"),
        ({"name": "   "}, "loads.0.name"),
        ({"name": "x" * 41}, "loads.0.name"),
        ({"name": "bad\nname"}, "loads.0.name"),
        ({"name": "\u200b"}, "loads.0.name"),
        ({"name": 5}, "loads.0.name"),
        ({"quantity": 0}, "loads.0.quantity"),
        ({"quantity": 101}, "loads.0.quantity"),
        ({"quantity": True}, "loads.0.quantity"),
        ({"quantity": D("2.0")}, "loads.0.quantity"),
        ({"quantity": "2"}, "loads.0.quantity"),
        ({"quantity": None}, "loads.0.quantity"),
        ({"rated_kw": D("0")}, "loads.0.rated_kw"),
        ({"rated_kw": D("-1")}, "loads.0.rated_kw"),
        ({"rated_kw": D("500.01")}, "loads.0.rated_kw"),
        ({"rated_kw": D("1.001")}, "loads.0.rated_kw"),
        ({"rated_kw": "5"}, "loads.0.rated_kw"),
        ({"rated_kw": True}, "loads.0.rated_kw"),
        ({"rated_kw": None}, "loads.0.rated_kw"),
        ({"rated_kw": D("NaN")}, "loads.0.rated_kw"),
        ({"rated_kw": D("Infinity")}, "loads.0.rated_kw"),
        ({"simultaneity_factor": D("0")}, "loads.0.simultaneity_factor"),
        ({"simultaneity_factor": D("0.00")}, "loads.0.simultaneity_factor"),
        ({"simultaneity_factor": D("1.01")}, "loads.0.simultaneity_factor"),
        ({"simultaneity_factor": D("0.005")}, "loads.0.simultaneity_factor"),
        ({"simultaneity_factor": D("-0.5")}, "loads.0.simultaneity_factor"),
        ({"simultaneity_factor": "0.5"}, "loads.0.simultaneity_factor"),
        ({"simultaneity_factor": False}, "loads.0.simultaneity_factor"),
        ({"extra": 1}, "loads.0.extra"),
    ],
)
def test_invalid_load_fields_are_reported_on_their_path(changes, field):
    errors = errors_for(body_with(**changes))
    assert [e["field"] for e in errors] == [field]


@pytest.mark.parametrize(
    "good",
    [
        {"rated_kw": D("0.01")},
        {"rated_kw": D("500")},
        {"simultaneity_factor": D("0.01")},
        {"simultaneity_factor": 1},
        {"quantity": 100},
        {"name": "x" * 40},
    ],
)
def test_the_range_ends_are_accepted(good):
    assert errors_for(body_with(**good)) == []


@pytest.mark.parametrize("margin", [-1, 51, True, D("5.0"), "5", None])
def test_invalid_margins_are_rejected(margin):
    body = body_with()
    body["capacity_margin_pct"] = margin
    assert [e["field"] for e in errors_for(body)] == ["capacity_margin_pct"]


@pytest.mark.parametrize("margin", [0, 25, 50])
def test_valid_margins_are_accepted(margin):
    body = body_with()
    body["capacity_margin_pct"] = margin
    assert errors_for(body) == []


@pytest.mark.parametrize("loads", [[], "x", None, {}])
def test_the_load_list_must_hold_one_to_twelve_loads(loads):
    assert [e["field"] for e in errors_for({"loads": loads})] == ["loads"]


def test_twelve_loads_are_accepted_and_thirteen_are_not():
    def many(n):
        return {"loads": [valid_load(name=f"Load {i}") for i in range(n)]}

    assert errors_for(many(12)) == []
    assert [e["field"] for e in errors_for(many(13))] == ["loads"]


def test_unknown_top_level_fields_and_a_missing_loads_list_are_rejected():
    assert [e["field"] for e in errors_for({"loads": [valid_load()], "x": 1})] == ["x"]
    assert [e["field"] for e in errors_for({})] == ["loads"]


def test_duplicate_names_ignoring_case_are_reported_on_the_later_load():
    body = {
        "loads": [
            valid_load(name="Pump"),
            valid_load(name="Lights"),
            valid_load(name=" pump "),
        ]
    }
    errors = errors_for(body)
    assert [e["field"] for e in errors] == ["loads.2.name"]
    assert "Pump" not in errors[0]["reason"]


def test_total_connected_load_is_capped_at_2000_kw_inclusive():
    at_limit = {"loads": [valid_load(quantity=4, rated_kw=D("500.00"))]}
    assert errors_for(at_limit) == []
    over = {
        "loads": [
            valid_load(name="Big", quantity=4, rated_kw=D("500.00")),
            valid_load(name="Tiny", rated_kw=D("0.01")),
        ]
    }
    errors = errors_for(over)
    assert [e["field"] for e in errors] == ["loads"]
    assert "2,000 kW" in errors[0]["reason"]
    assert "2000.01" not in errors[0]["reason"]


def test_cross_field_rules_run_only_when_every_field_is_valid():
    body = {
        "loads": [
            valid_load(name="A", quantity=100, rated_kw=D("500")),
            valid_load(name="a", rated_kw=D("0")),
        ]
    }
    assert [e["field"] for e in errors_for(body)] == ["loads.1.rated_kw"]


def test_running_an_invalid_request_directly_is_refused_not_computed():
    from app.domain.system_config import RuleError

    request = MobilePowerInput.model_validate(
        {"loads": [valid_load(quantity=100, rated_kw=D("500"))]}
    )
    with pytest.raises(RuleError):
        run_mobile_power(request)
