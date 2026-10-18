"""Hand-calculated checks of the startup-delay model (no database).

Every expected number below was worked out on paper from the stated assumptions, not
produced by running the model. Conversions used:

    1 kWh = 3_600 kW*s = 3_600_000 kW*ms
    available battery energy = usable_kwh * (initial_soc - min_soc) / 100
                             = 500 * (soc - 20) / 100 kWh   (usable 500, min 20)
    battery SoC drop (%)     = energy_delivered_kwh / 500 * 100
"""

import copy

import pytest
from pydantic import ValidationError

import app.domain.startup_check as sc
from app.domain.startup_check import EvidenceSource, run_startup_check
from app.domain.system_config import default_system_config, from_snapshot, to_snapshot

SOURCE = EvidenceSource(
    configuration_id="11111111-1111-4111-8111-111111111111",
    version_id="22222222-2222-4222-8222-222222222222",
    version_number=3,
    schema_version="config-v1",
)


def run(delay=5, load=180, soc=80, g1_enabled=True, g2_enabled=True, g2_delay=5):
    data = copy.deepcopy(to_snapshot(default_system_config()))
    eq = data["equipment"]
    eq["g1"].update(startup_delay_s=delay, enabled=g1_enabled)
    eq["g2"].update(startup_delay_s=g2_delay, enabled=g2_enabled)
    eq["load"]["critical_kw"] = load
    eq["battery"]["initial_soc_pct"] = soc
    return run_startup_check(from_snapshot(data), SOURCE)


def types(ev):
    return [(e.at_ms, e.type) for e in ev.events]


def req(ev, requirement_id):
    return next(r for r in ev.requirements if r.requirement_id == requirement_id)


READY = "G1_READY_WITHIN_10S"
CONTINUITY = "CRITICAL_LOAD_CONTINUITY"


# ---------- the demonstration pair: 5 s versus 15 s at 180 kW, 80% SoC ----------


def test_five_second_startup_passes_readiness_and_continuity():
    ev = run(delay=5)
    # G1 ready at 5 * 1000 = 5000 ms. Battery carries 180 kW for 5 s:
    # 180 * 5 = 900 kW*s = 0.25 kWh. SoC = 80 - 0.25 / 500 * 100 = 79.95 %.
    assert types(ev) == [
        (0, "utility_outage"),
        (0, "start_generator"),
        (5000, "g1_ready"),
        (5000, "g1_transfer_complete"),
        (300000, "horizon_reached"),
    ]
    m = ev.metrics
    assert m.g1_ready_ms == 5000 and m.g1_transfer_complete_ms == 5000
    assert m.battery_bridge_energy_kwh == 0.25
    assert m.battery_energy_delivered_kwh == 0.25
    assert m.unserved_energy_kwh == 0.0
    assert m.battery_peak_kw == 180
    assert m.battery_soc_end_pct == 79.95
    assert m.battery_depleted_ms is None
    assert req(ev, READY).status == "pass" and req(ev, READY).observed == 5000
    assert req(ev, CONTINUITY).status == "pass" and req(ev, CONTINUITY).observed == 0.0


def test_fifteen_second_startup_fails_readiness_but_keeps_continuity():
    ev = run(delay=15)
    # 180 * 15 = 2700 kW*s = 0.75 kWh. SoC = 80 - 0.75 / 500 * 100 = 79.85 %.
    m = ev.metrics
    assert m.g1_ready_ms == 15000
    assert m.battery_bridge_energy_kwh == 0.75
    assert m.unserved_energy_kwh == 0.0
    assert m.battery_soc_end_pct == 79.85
    assert req(ev, READY).status == "fail" and req(ev, READY).observed == 15000
    assert req(ev, CONTINUITY).status == "pass"


def test_available_battery_energy_follows_the_stated_formula():
    # 500 * (80 - 20) / 100 = 300 kWh
    assert run().inputs.battery_available_kwh == 300.0


# ---------- readiness threshold boundary and extremes ----------


@pytest.mark.parametrize(
    ("delay", "status"), [(0, "pass"), (9, "pass"), (10, "pass"), (11, "fail")]
)
def test_ready_limit_is_inclusive_at_ten_seconds(delay, status):
    assert req(run(delay=delay), READY).status == status


def test_zero_second_startup_has_no_bridge_energy():
    ev = run(delay=0)
    assert ev.metrics.battery_bridge_energy_kwh == 0.0
    # All four events share t = 0 and keep the documented order.
    assert [t for at, t in types(ev) if at == 0] == [
        "utility_outage",
        "start_generator",
        "g1_ready",
        "g1_transfer_complete",
    ]


def test_maximum_startup_delay():
    ev = run(delay=120)
    # 180 * 120 = 21_600 kW*s = 6.0 kWh; 80 - 6 / 500 * 100 = 78.8 %.
    assert ev.metrics.battery_bridge_energy_kwh == 6.0
    assert ev.metrics.battery_soc_end_pct == 78.8
    assert req(ev, READY).status == "fail"


# ---------- G1 disabled ----------


def test_disabled_g1_fails_readiness_and_the_battery_survives_the_horizon():
    ev = run(g1_enabled=False)
    # Battery alone carries 180 kW for 300 s = 54_000 kW*s = 15 kWh of the 300 kWh.
    # Not depleted: no battery_depleted event. SoC = 80 - 15 / 500 * 100 = 77.0 %.
    assert types(ev) == [(0, "utility_outage"), (300000, "horizon_reached")]
    assert ev.metrics.g1_ready_ms is None
    assert ev.metrics.battery_depleted_ms is None
    assert ev.metrics.battery_energy_delivered_kwh == 15.0
    assert ev.metrics.battery_soc_end_pct == 77.0
    ready = req(ev, READY)
    assert ready.status == "fail" and ready.observed is None
    assert req(ev, CONTINUITY).status == "pass"
    assert ev.frames[0].states.g1 == "disabled"


# ---------- dispatch limits ----------


def test_load_above_inverter_rating_leaves_a_shortfall_until_g1_transfers():
    ev = run(delay=5, load=300)
    # Before transfer: battery 250 kW (inverter limit), 50 kW unserved for 5 s:
    #   unserved = 50 * 5 = 250 kW*s = 250_000 kW*ms -> 0.069444 kWh.
    # After transfer: G1 supplies 250 kW, battery the remaining 50 kW for 295 s.
    #   battery total = 250*5 + 50*295 = 1_250 + 14_750 = 16_000 kW*s = 4.444444 kWh
    #   bridge (before transfer) = 1_250 kW*s = 0.347222 kWh
    #   SoC = 80 - 4.4444.. / 500 * 100 = 79.1111 %
    m = ev.metrics
    assert m.unserved_energy_kwh == 0.069444
    assert m.battery_energy_delivered_kwh == 4.444444
    assert m.battery_bridge_energy_kwh == 0.347222
    assert m.battery_peak_kw == 250
    assert m.battery_soc_end_pct == 79.1111
    assert req(ev, READY).status == "pass"
    cont = req(ev, CONTINUITY)
    assert cont.status == "fail" and cont.observed == 0.069444
    online = next(f for f in ev.frames if f.states.g1 == "online")
    assert (online.power_kw.g1_kw, online.power_kw.battery_kw) == (250, 50)
    assert online.power_kw.unserved_kw == 0


def test_g1_supplies_up_to_its_rating_and_battery_covers_the_rest():
    ev = run(delay=5, load=400)
    online = next(f for f in ev.frames if f.states.g1 == "online")
    assert (online.power_kw.g1_kw, online.power_kw.battery_kw) == (250, 150)
    # Before transfer the battery supplies 250 kW (inverter limit) of 400 kW, so
    # 150 kW is unserved for 5 s = 750 kW*s = 0.208333 kWh.
    assert ev.metrics.unserved_energy_kwh == 0.208333


def test_battery_at_its_soc_floor_cannot_bridge_the_startup():
    ev = run(delay=5, soc=20)
    # Available energy 500 * 0 / 100 = 0. 180 kW * 5 s = 900 kW*s = 0.25 kWh unserved.
    assert ev.metrics.unserved_energy_kwh == 0.25
    assert ev.metrics.battery_energy_delivered_kwh == 0.0
    assert [t for at, t in types(ev) if at == 0] == [
        "utility_outage",
        "start_generator",
        "battery_depleted",
    ]
    assert req(ev, CONTINUITY).status == "fail"


def test_battery_depletes_mid_startup():
    ev = run(delay=120, soc=21)
    # Available 500 * 1 / 100 = 5 kWh = 18_000 kW*s. 180 kW lasts 100 s, then 20 s
    # unserved: 180 * 20 = 3_600 kW*s = 1.0 kWh.
    assert (100000, "battery_depleted") in types(ev)
    assert ev.metrics.battery_depleted_ms == 100000
    assert ev.metrics.unserved_energy_kwh == 1.0
    assert ev.metrics.battery_energy_delivered_kwh == 5.0
    assert ev.metrics.battery_soc_end_pct == 20.0
    depleted = next(f for f in ev.frames if f.states.battery == "depleted")
    assert depleted.power_kw.unserved_kw == 180
    assert depleted.states.load == "unserved"
    assert depleted.battery_energy_remaining_kwh == 0.0


def test_depletion_time_rounds_up_to_a_whole_millisecond_but_energy_stays_exact():
    ev = run(delay=0, g1_enabled=False, load=170, soc=21)
    # Available 5 kWh = 18_000_000 kW*ms. 170 kW lasts 18_000_000 / 170 = 105_882.35 ms,
    # recorded at the next whole ms, 105_883. Unserved over the 300 s horizon:
    #   170 * 300_000 - 18_000_000 = 33_000_000 kW*ms = 9.166667 kWh
    assert ev.metrics.battery_depleted_ms == 105883
    assert ev.metrics.unserved_energy_kwh == 9.166667
    assert ev.metrics.battery_energy_delivered_kwh == 5.0


# ---------- horizon boundary ----------


def test_depletion_exactly_at_the_horizon_is_recorded_before_the_horizon_event():
    ev = run(g1_enabled=False, soc=23)
    # Available 500 * 3 / 100 = 15 kWh = 54_000 kW*s = exactly 180 kW * 300 s.
    assert types(ev) == [
        (0, "utility_outage"),
        (300000, "battery_depleted"),
        (300000, "horizon_reached"),
    ]
    assert ev.metrics.unserved_energy_kwh == 0.0
    assert req(ev, CONTINUITY).status == "pass"


def test_depletion_before_the_horizon_leaves_unserved_energy():
    ev = run(g1_enabled=False, soc=22)
    # Available 10 kWh = 36_000 kW*s: lasts 200 s; 180 kW * 100 s = 18_000 kW*s = 5 kWh.
    assert ev.metrics.battery_depleted_ms == 200000
    assert ev.metrics.unserved_energy_kwh == 5.0
    assert req(ev, CONTINUITY).status == "fail"


# ---------- readiness and transfer are distinct ----------


def test_readiness_is_judged_before_transfer(monkeypatch):
    monkeypatch.setattr(sc, "TRANSFER_DELAY_MS", 2000)
    ev = run(delay=8)
    # Ready at 8000 (pass); transfer 2 s later at 10000. Battery bridges until
    # transfer: 180 * 10 = 1_800 kW*s = 0.5 kWh.
    assert (8000, "g1_ready") in types(ev)
    assert (10000, "g1_transfer_complete") in types(ev)
    assert req(ev, READY).status == "pass"
    assert ev.metrics.battery_bridge_energy_kwh == 0.5
    ready_frame = next(f for f in ev.frames if f.states.g1 == "ready")
    assert ready_frame.power_kw.g1_kw == 0 and ready_frame.power_kw.battery_kw == 180


def test_detection_delay_shifts_the_start_command_but_not_the_outage(monkeypatch):
    monkeypatch.setattr(sc, "OUTAGE_DETECTION_MS", 1000)
    ev = run(delay=9)
    # Start at 1000, ready at 10000: 10000 ms after the outage, so it still passes.
    assert (1000, "start_generator") in types(ev)
    assert req(ev, READY).observed == 10000 and req(ev, READY).status == "pass"
    assert req(run(delay=10), READY).status == "fail"


# ---------- G2 is not part of this scenario ----------


def test_g2_settings_do_not_change_the_result():
    a = run(g2_enabled=True, g2_delay=5)
    b = run(g2_enabled=False, g2_delay=99)
    assert a.events == b.events and a.frames == b.frames
    assert a.metrics == b.metrics and a.requirements == b.requirements
    assert a.inputs.g2_used is False and a.scenario.commanded_generators == ("g1",)
    assert any("G2 is not commanded" in x.text for x in a.assumptions)


# ---------- determinism, ids and traceability ----------


def test_repeated_runs_are_identical_byte_for_byte():
    assert run(delay=15).model_dump_json() == run(delay=15).model_dump_json()


def test_event_ids_frames_and_evidence_references_are_consistent():
    ev = run(delay=15)
    assert [e.id for e in ev.events] == [f"evt-{i:02d}" for i in range(1, 6)]
    assert [f.event_id for f in ev.frames] == [e.id for e in ev.events]
    assert [f.at_ms for f in ev.frames] == [e.at_ms for e in ev.events]
    known = {e.id for e in ev.events}
    for r in ev.requirements:
        assert r.evidence_event_ids and set(r.evidence_event_ids) <= known
    ready = req(ev, READY)
    by_id = {e.id: e for e in ev.events}
    assert [by_id[i].type for i in ready.evidence_event_ids] == [
        "start_generator",
        "g1_ready",
    ]
    assert ev.source == SOURCE and ev.model_version == "startup-check-v1"
    assert ev.scenario.horizon_ms == 300000
    assert [e.at_ms for e in ev.events] == sorted(e.at_ms for e in ev.events)


def test_assumptions_are_explicit():
    ids = [a.id for a in run().assumptions]
    assert ids == sorted(set(ids), key=lambda i: int(i[1:]))
    text = " ".join(a.text for a in run().assumptions)
    for phrase in ("0 ms", "separate events", "usable_kwh", "300 s horizon"):
        assert phrase in text


def test_evidence_is_immutable():
    ev = run()
    with pytest.raises(ValidationError):
        ev.metrics.unserved_energy_kwh = 9.0  # type: ignore[misc]


def test_display_rounding_is_half_up_and_requirements_follow_exact_energy():
    # 1_800 kW*ms = 0.0005 kWh exactly -> rounds half up to 0.000500 at 6 decimals.
    assert sc._kwh(1_800) == 0.0005
    assert sc._kwh(1) == 0.0
    # Load 1 kW, no battery energy, G1 ready at 1 s: 1 kW * 1000 ms = 1000 kW*ms
    # = 0.000278 kWh (displayed), but any nonzero exact value fails continuity.
    ev = run(delay=1, soc=20, load=1)
    assert req(ev, CONTINUITY).status == "fail"
    assert req(ev, CONTINUITY).observed == 0.000278
    # With G1 ready at 0 s nothing is unserved.
    assert req(run(delay=0, soc=20, load=1), CONTINUITY).status == "pass"


# ---------- frames are consistent discrete snapshots ----------


def test_battery_emptied_exactly_at_transfer_is_recorded_before_the_transfer():
    # Available 5 kWh = 18_000_000 kW*ms = exactly 250 kW * 72 s, so the battery is
    # empty at the instant G1 (72 s) takes over a 300 kW load. After transfer G1
    # carries 250 kW and the other 50 kW has no source for the remaining 228 s:
    #   unserved = 50 * 228 = 11_400 kW*s = 3.166667 kWh, plus the 50 kW shortfall
    #   before transfer, 50 * 72 = 3_600 kW*s = 1.0 kWh  -> 4.166667 kWh in total.
    ev = run(delay=72, load=300, soc=21)
    assert types(ev) == [
        (0, "utility_outage"),
        (0, "start_generator"),
        (72000, "battery_depleted"),
        (72000, "g1_ready"),
        (72000, "g1_transfer_complete"),
        (300000, "horizon_reached"),
    ]
    assert ev.metrics.unserved_energy_kwh == 4.166667
    assert ev.metrics.battery_energy_delivered_kwh == 5.0
    online = next(f for f in ev.frames if f.states.g1 == "online")
    assert online.states.battery == "depleted"
    assert (online.power_kw.g1_kw, online.power_kw.battery_kw) == (250, 0)
    assert online.power_kw.unserved_kw == 50
    assert online.battery_energy_remaining_kwh == 0.0


def test_battery_emptied_exactly_at_transfer_with_no_residual_load():
    # 5 kWh = 180 kW * 100 s exactly; G1 takes the whole 180 kW load at 100 s.
    ev = run(delay=100, load=180, soc=21)
    assert (100000, "battery_depleted") in types(ev)
    assert ev.metrics.unserved_energy_kwh == 0.0
    assert req(ev, CONTINUITY).status == "pass"


@pytest.mark.parametrize("g1_enabled", [True, False])
@pytest.mark.parametrize("soc", [20, 21, 22, 23, 80, 100])
@pytest.mark.parametrize("load", [1, 170, 180, 250, 251, 300, 500])
@pytest.mark.parametrize("delay", [0, 1, 5, 10, 72, 100, 120])
def test_every_frame_is_an_internally_consistent_snapshot(delay, load, soc, g1_enabled):
    ev = run(delay=delay, load=load, soc=soc, g1_enabled=g1_enabled)
    inverter = ev.inputs.battery_inverter_kw
    previous_remaining = ev.inputs.battery_available_kwh
    previous_soc = float(soc)
    previous_ms = -1
    depleted_seen = False
    for frame in ev.frames:
        p = frame.power_kw
        assert p.g1_kw + p.battery_kw + p.unserved_kw == p.load_kw == load
        assert p.served_kw == p.g1_kw + p.battery_kw
        assert 0 <= p.battery_kw <= inverter and 0 <= p.g1_kw <= 250
        assert frame.states.load == (
            "served"
            if p.unserved_kw == 0
            else "unserved"
            if p.unserved_kw == load
            else "partially_served"
        )
        # An empty battery never delivers power; a depleted state never does either.
        if frame.battery_energy_remaining_kwh == 0.0:
            assert p.battery_kw == 0
        if frame.states.battery == "depleted":
            depleted_seen = True
            assert p.battery_kw == 0 and frame.battery_energy_remaining_kwh == 0.0
        if depleted_seen:
            assert frame.states.battery == "depleted"
        assert frame.at_ms >= previous_ms
        assert frame.battery_energy_remaining_kwh <= previous_remaining
        assert frame.battery_soc_pct <= previous_soc
        previous_ms = frame.at_ms
        previous_remaining = frame.battery_energy_remaining_kwh
        previous_soc = frame.battery_soc_pct
    # A depletion event exists exactly when the battery ends up empty while the
    # battery was ever requested to supply power.
    has_depletion_event = any(e.type == "battery_depleted" for e in ev.events)
    assert has_depletion_event == (ev.metrics.battery_depleted_ms is not None)
    if has_depletion_event:
        assert (
            ev.metrics.battery_energy_delivered_kwh == ev.inputs.battery_available_kwh
        )
    assert ev.frames[-1].event_id == ev.events[-1].id == f"evt-{len(ev.events):02d}"
    assert ev.events[-1].type == "horizon_reached"
