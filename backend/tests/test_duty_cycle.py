"""Duty-cycle model (doc 05 API-18). Expected values are computed by hand.

Sample cycle: Loading 120 kW x 3 min = 6 kWh, Hauling 300 kW x 12 min = 60 kWh,
Dumping 90 kW x 2 min = 3 kWh, Returning 60 kW x 8 min = 8 kWh. That is 77 kWh in
25 min, so 77 x 60 / 25 = 184.8 kW average; 18 cycles are 1386 kWh in 450 min.
Shares: 6/77 = 7.79 %, 60/77 = 77.92 %, 3/77 = 3.90 %, 8/77 = 10.39 %.
"""

from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.domain.duty_cycle import (
    MODEL_VERSION,
    DutyCycleInput,
    cross_field_errors,
    run_duty_cycle,
)
from app.domain.system_config import RuleError, validation_details

D = Decimal

SAMPLE = [
    ("Loading", "120", "3"),
    ("Hauling", "300", "12"),
    ("Dumping", "90", "2"),
    ("Returning", "60", "8"),
]


def payload(segments=SAMPLE, cycles=18):
    return {
        "segments": [
            {"name": n, "power_kw": D(p), "duration_min": D(m)} for n, p, m in segments
        ],
        "cycles_per_shift": cycles,
    }


def make(segments=SAMPLE, cycles=18) -> DutyCycleInput:
    return DutyCycleInput.model_validate(payload(segments, cycles))


def errors_for(body) -> list[dict[str, str]]:
    try:
        request = DutyCycleInput.model_validate(body)
    except ValidationError as exc:
        return validation_details(exc)
    return cross_field_errors(request)


# ---------- hand-calculated sample ----------


def test_the_hand_calculated_sample():
    result = run_duty_cycle(make())
    assert result.model_version == MODEL_VERSION == "duty-cycle-v1"
    assert [s.energy_kwh for s in result.segments] == [6.0, 60.0, 3.0, 8.0]
    assert [s.share_of_cycle_energy_pct for s in result.segments] == [
        7.79,
        77.92,
        3.90,
        10.39,
    ]
    assert result.cycle.energy_kwh == 77.0
    assert result.cycle.duration_min == 25.0
    assert result.cycle.average_power_kw == 184.8
    assert result.cycle.peak_power_kw == 300.0
    assert result.shift.cycles == 18
    assert result.shift.energy_kwh == 1386.0
    assert result.shift.duration_min == 450.0
    assert result.dominant_segment_ids == ("segment-2",)
    assert [s.is_dominant for s in result.segments] == [False, True, False, False]
    assert result.explanation == (
        "Hauling uses the most energy: 60.00 kWh of 77.00 kWh (77.92% of cycle "
        "energy), from 300.00 kW for 12.00 min (48.00% of cycle time). It also has "
        "the highest power."
    )


def test_the_response_echoes_the_inputs_and_lists_assumptions():
    result = run_duty_cycle(make())
    assert result.inputs.cycles_per_shift == 18
    assert [(s.name, s.power_kw, s.duration_min) for s in result.inputs.segments] == [
        ("Loading", 120.0, 3.0),
        ("Hauling", 300.0, 12.0),
        ("Dumping", 90.0, 2.0),
        ("Returning", 60.0, 8.0),
    ]
    assert [a.id for a in result.assumptions] == [f"A{i}" for i in range(1, 9)]
    text = " ".join(a.text for a in result.assumptions)
    assert "not validated haul-truck" in text
    assert "differ slightly from 100%" in text


def test_a_single_segment_is_the_whole_cycle():
    result = run_duty_cycle(make([("Idle", "50", "30")], cycles=2))
    # 50 kW x 30 min / 60 = 25 kWh; two cycles = 50 kWh in 60 min.
    assert result.cycle.energy_kwh == 25.0
    assert result.shift.energy_kwh == 50.0
    assert result.shift.duration_min == 60.0
    assert result.cycle.average_power_kw == 50.0
    assert result.segments[0].share_of_cycle_energy_pct == 100.0
    assert result.dominant_segment_ids == ("segment-1",)


def test_highest_power_segment_can_differ_from_the_dominant_energy_segment():
    # Peak: 200 kW x 3 min = 10 kWh. Long: 50 kW x 30 min = 25 kWh (dominant).
    result = run_duty_cycle(make([("Peak", "200", "3"), ("Long", "50", "30")], 1))
    assert result.dominant_segment_ids == ("segment-2",)
    assert result.cycle.peak_power_kw == 200.0
    assert result.explanation == (
        "Long uses the most energy: 25.00 kWh of 35.00 kWh (71.43% of cycle "
        "energy), from 50.00 kW for 30.00 min (90.91% of cycle time). The "
        "highest-power segment is Peak at 200.00 kW."
    )


# ---------- ties, zero energy and exact arithmetic ----------


def test_three_equal_segments_tie_and_rounded_shares_do_not_total_100():
    # 100 kW x 20 min = 33.333... kWh each; total exactly 100 kWh in 60 min.
    result = run_duty_cycle(
        make([("A", "100", "20"), ("B", "100", "20"), ("C", "100", "20")], 1)
    )
    assert [s.energy_kwh for s in result.segments] == [33.33] * 3
    assert [s.share_of_cycle_energy_pct for s in result.segments] == [33.33] * 3
    assert round(sum(s.share_of_cycle_energy_pct for s in result.segments), 2) == 99.99
    assert result.cycle.energy_kwh == 100.0
    assert result.cycle.average_power_kw == 100.0
    assert result.dominant_segment_ids == ("segment-1", "segment-2", "segment-3")
    assert result.explanation == (
        "A, B and C tie for the most energy, each with 33.33 kWh of 100.00 kWh "
        "(33.33% of cycle energy). They also have the highest power."
    )


def test_exact_arithmetic_finds_a_tie_that_binary_floats_miss():
    # 0.10 kW x 6 min and 0.60 kW x 1 min are both exactly 0.01 kWh. In binary
    # floats 0.1 * 6 / 60 is 0.010000000000000002, so floats would crown the first.
    assert 0.1 * 6 / 60 != 0.6 * 1 / 60
    result = run_duty_cycle(make([("Slow", "0.10", "6"), ("Fast", "0.60", "1")], 1))
    assert result.dominant_segment_ids == ("segment-1", "segment-2")
    assert [s.energy_kwh for s in result.segments] == [0.01, 0.01]
    assert result.explanation.startswith("Slow and Fast tie for the most energy")
    assert "The highest-power segment is Fast at 0.60 kW." in result.explanation


def test_rounding_is_half_up_on_the_exact_value():
    # 0.30 kW x 1 min = 0.005 kWh exactly (banker's rounding would give 0.00).
    one = run_duty_cycle(make([("Tiny", "0.30", "1")], 1))
    assert one.cycle.energy_kwh == 0.01
    assert one.cycle.average_power_kw == 0.3
    # 3 cycles = 0.015 kWh exactly -> 0.02; 2 cycles = 0.010 -> 0.01.
    assert run_duty_cycle(make([("Tiny", "0.30", "1")], 3)).shift.energy_kwh == 0.02
    assert run_duty_cycle(make([("Tiny", "0.30", "1")], 2)).shift.energy_kwh == 0.01


def test_a_cycle_with_no_energy_has_no_dominant_segment():
    result = run_duty_cycle(make([("Off", "0", "10"), ("Standby", "0", "5")], 4))
    assert result.cycle.energy_kwh == 0.0
    assert result.cycle.average_power_kw == 0.0
    assert result.cycle.peak_power_kw == 0.0
    assert result.shift.duration_min == 60.0
    assert result.dominant_segment_ids == ()
    assert [s.share_of_cycle_energy_pct for s in result.segments] == [0.0, 0.0]
    assert not any(s.is_dominant for s in result.segments)
    assert result.explanation.startswith("The cycle uses no energy")


def test_a_zero_power_segment_adds_time_but_no_energy():
    result = run_duty_cycle(make([("Work", "60", "30"), ("Idle", "0", "30")], 1))
    # 30 kWh over 60 min -> 30 kW average, half the peak.
    assert result.cycle.energy_kwh == 30.0
    assert result.cycle.average_power_kw == 30.0
    assert result.cycle.peak_power_kw == 60.0
    assert result.segments[1].energy_kwh == 0.0


def test_decimal_durations_and_powers_are_exact():
    # A: 12.5 kW x 2.40 min / 60 = 0.5 kWh. B: 7.25 x 0.80 / 60 = 0.09666.. kWh.
    # Cycle total 0.59666.. kWh; ten cycles 5.9666.. kWh (not 10 x the rounded 0.60).
    result = run_duty_cycle(make([("A", "12.5", "2.40"), ("B", "7.25", "0.80")], 10))
    assert [s.energy_kwh for s in result.segments] == [0.5, 0.1]
    assert result.cycle.duration_min == 3.2
    assert result.cycle.energy_kwh == 0.6
    assert result.shift.energy_kwh == 5.97


def test_the_result_is_deterministic():
    first = run_duty_cycle(make())
    second = run_duty_cycle(make())
    assert first == second
    assert first.model_dump_json() == second.model_dump_json()


# ---------- shift duration limit ----------


def test_shift_duration_of_exactly_1440_minutes_is_allowed():
    result = run_duty_cycle(make([("Run", "10", "24")], cycles=60))
    assert result.shift.duration_min == 1440.0
    assert result.shift.energy_kwh == 240.0  # 10 kW x 24 min = 4 kWh, 60 times


def test_over_the_shift_limit_is_rejected_naming_the_cycle_count_that_fits():
    # 25 min x 57 = 1425 fits; 25 min x 58 = 1450 does not.
    assert errors_for(payload(cycles=57)) == []
    [error] = errors_for(payload(cycles=58))
    assert error["field"] == "cycles_per_shift"
    assert error["reason"] == (
        "Cycle duration x cycles per shift must not exceed 1,440 minutes; at "
        "most 57 cycles fit this cycle"
    )
    # 24 min x 61 = 1464.
    [error] = errors_for(payload([("Run", "10", "24")], cycles=61))
    assert "at most 60 cycles" in error["reason"]


def test_a_single_cycle_longer_than_a_shift_is_rejected():
    four_long = [(f"S{i}", "1", "480") for i in range(4)]  # 1920 min per cycle
    [error] = errors_for(payload(four_long, cycles=1))
    assert error["field"] == "cycles_per_shift"
    assert error["reason"] == (
        "One cycle already exceeds 1,440 minutes; shorten the segment durations"
    )


def test_run_duty_cycle_refuses_an_over_limit_shift_on_its_own():
    with pytest.raises(RuleError):
        run_duty_cycle(make(cycles=58))


# ---------- field validation ----------


def test_segment_count_bounds():
    one = [("A", "1", "1")]
    twelve = [(f"S{i}", "1", "1") for i in range(12)]
    thirteen = [(f"S{i}", "1", "1") for i in range(13)]
    assert errors_for(payload(one, 1)) == []
    assert errors_for(payload(twelve, 1)) == []
    for bad in ([], thirteen):
        assert errors_for(payload(bad, 1)) == [
            {"field": "segments", "reason": "Must contain 1 to 12 segments"}
        ]
    assert errors_for({"segments": "x", "cycles_per_shift": 1}) == [
        {"field": "segments", "reason": "Must be a list of segments"}
    ]


@pytest.mark.parametrize(
    ("power", "ok"),
    [
        ("0", True),
        ("0.01", True),
        ("10000", True),
        ("10000.01", False),
        ("-0.01", False),
        ("1.005", False),
    ],
)
def test_power_bounds_and_precision(power, ok):
    errors = errors_for(payload([("A", power, "1")], 1))
    assert (errors == []) is ok
    if not ok:
        assert errors[0]["field"] == "segments.0.power_kw"


@pytest.mark.parametrize(
    ("duration", "ok"),
    [
        ("0", False),
        ("0.01", True),
        ("480", True),
        ("480.01", False),
        ("-1", False),
        ("1.001", False),
    ],
)
def test_duration_bounds_and_precision(duration, ok):
    errors = errors_for(payload([("A", "1", duration)], 1))
    assert (errors == []) is ok
    if not ok:
        assert errors[0]["field"] == "segments.0.duration_min"


@pytest.mark.parametrize(
    ("cycles", "ok"), [(0, False), (1, True), (500, True), (501, False)]
)
def test_cycles_per_shift_bounds(cycles, ok):
    # One 1-minute segment keeps 500 cycles inside the 1,440-minute limit.
    errors = errors_for(payload([("A", "1", "1")], cycles))
    assert (errors == []) is ok


@pytest.mark.parametrize(
    "bad",
    ["300", True, None, [1], {"x": 1}, Decimal("NaN"), Decimal("Infinity")],
)
def test_power_must_be_a_real_number(bad):
    body = payload()
    body["segments"][0]["power_kw"] = bad
    errors = errors_for(body)
    assert errors and errors[0]["field"] == "segments.0.power_kw"


@pytest.mark.parametrize("bad", ["18", 18.0, Decimal("18.0"), True, None, 1.5])
def test_cycles_must_be_a_whole_number(bad):
    body = payload()
    body["cycles_per_shift"] = bad
    assert [e["field"] for e in errors_for(body)] == ["cycles_per_shift"]


def test_names_are_trimmed_bounded_and_unique_ignoring_case():
    assert errors_for(payload([("x" * 40, "1", "1")], 1)) == []
    assert run_duty_cycle(make([("  Haul  ", "1", "1")], 1)).segments[0].name == "Haul"
    for bad in ("x" * 41, "", "   ", "\t", "a\nb", "\x00x"):
        errors = errors_for(payload([(bad, "1", "1")], 1))
        assert errors and errors[0]["field"] == "segments.0.name", repr(bad)
    dup = errors_for(payload([("Haul", "1", "1"), ("haul ", "1", "1")], 1))
    assert dup == [
        {
            "field": "segments.1.name",
            "reason": "Must be different from the other segment names",
        }
    ]


def test_unknown_fields_and_missing_fields_are_rejected():
    body = payload()
    body["extra"] = 1
    body["segments"][0]["fuel_l"] = 1
    assert {e["field"] for e in errors_for(body)} == {"extra", "segments.0.fuel_l"}
    missing = {"segments": [{"name": "A", "power_kw": D(1)}]}
    assert {e["field"] for e in errors_for(missing)} == {
        "segments.0.duration_min",
        "cycles_per_shift",
    }


def test_reasons_never_repeat_submitted_values():
    body = payload([("SECRET-NAME", "99999", "1")], 1)
    reasons = " ".join(e["reason"] for e in errors_for(body))
    assert "99999" not in reasons and "SECRET-NAME" not in reasons
