"""Startup-delay acceptance check (conference demo; doc 05 API-16).

A pure, deterministic model of one fixed scenario: the utility is lost at t = 0 and
only G1 is commanded to start. It answers two requirements:

- ``G1_READY_WITHIN_10S``: G1 reaches ready within 10 s of the outage (inclusive).
- ``CRITICAL_LOAD_CONTINUITY``: no critical-load energy goes unserved.

Pure domain code: no database, HTTP, clock or randomness. Identical input gives
identical output.

Exactness. Time is integer milliseconds and energy is integer kW*ms internally
(1 kWh = 3_600_000 kW*ms). Requirements are evaluated on those exact integers.
Only the serialized display values (kWh to 6 decimals, SoC to 4 decimals) are
rounded, half up.

Readiness and transfer are separate events. ``g1_ready`` is when G1 can accept load;
``g1_transfer_complete`` is when load is actually on G1, ``TRANSFER_DELAY_MS`` later.
The ready requirement is judged on ``g1_ready`` only.

Equal timestamps are ordered by ``_PRIORITY`` and then by creation order. Events at
or before ``HORIZON_MS`` are recorded; nothing after it is.
"""

from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.domain.system_config import SystemConfigV1

MODEL_VERSION = "startup-check-v1"
SCENARIO_ID = "utility_outage_g1_startup"
HORIZON_MS = 300_000
OUTAGE_AT_MS = 0
OUTAGE_DETECTION_MS = 0  # simplification: G1 start command at the outage instant
TRANSFER_DELAY_MS = 0  # simplification: load moves to G1 the instant it is ready
G1_READY_LIMIT_MS = 10_000
KW_MS_PER_KWH = 3_600_000

READY_REQUIREMENT_ID = "G1_READY_WITHIN_10S"
CONTINUITY_REQUIREMENT_ID = "CRITICAL_LOAD_CONTINUITY"

EventType = Literal[
    "utility_outage",
    "start_generator",
    "g1_ready",
    "g1_transfer_complete",
    "battery_depleted",
    "horizon_reached",
]

# Order of events sharing a timestamp.
_PRIORITY: dict[str, int] = {
    "utility_outage": 0,
    "start_generator": 1,
    "battery_depleted": 2,
    "g1_ready": 3,
    "g1_transfer_complete": 4,
    "horizon_reached": 5,
}

ASSUMPTIONS: tuple[tuple[str, str], ...] = (
    (
        "A1",
        ("The utility is lost at t = 0 and stays lost for the 300 s horizon."),
    ),
    (
        "A2",
        (
            "Only G1 receives a start command. G2 is not commanded in this scenario "
            "even when enabled; its settings do not affect the result."
        ),
    ),
    (
        "A3",
        (
            "Outage detection takes 0 ms: the G1 start command is issued at the "
            "outage instant."
        ),
    ),
    (
        "A4",
        (
            "G1 startup_delay_s is the time from the start command to G1 being "
            "ready to accept load."
        ),
    ),
    (
        "A5",
        (
            "Generator readiness and load transfer are separate events. Transfer "
            "takes 0 ms after readiness (simplification: instantaneous transfer)."
        ),
    ),
    (
        "A6",
        (
            "The battery inverter supplies the critical load from the outage "
            "instant with no interruption (simplification: no ride-through gap)."
        ),
    ),
    (
        "A7",
        (
            "After transfer G1 supplies up to its rated power; the battery supplies "
            "any residual load up to its inverter rating and remaining energy."
        ),
    ),
    (
        "A8",
        (
            "Available battery energy = usable_kwh x (initial_soc_pct - "
            "min_soc_pct) / 100, with no conversion losses and no recharging."
        ),
    ),
    (
        "A9",
        (
            "The critical load is constant at critical_kw. Unserved energy is "
            "demand supplied by neither G1 nor the battery."
        ),
    ),
    (
        "A10",
        (
            "Time and energy are tracked as exact integers (ms, kW*ms). Displayed "
            "kWh (6 decimals) and SoC (4 decimals) are rounded; requirements use "
            "the exact values."
        ),
    ),
    (
        "A11",
        (
            "Events with equal timestamps are ordered: utility_outage, "
            "start_generator, battery_depleted, g1_ready, g1_transfer_complete, "
            "horizon_reached. Events at or before the 300 s horizon are recorded."
        ),
    ),
    (
        "A12",
        (
            "battery_depleted is recorded at the first whole millisecond by which "
            "all available battery energy has been supplied while power is still "
            "requested; it is ordered before generator events at that timestamp. "
            "Frames are discrete state snapshots taken right after each event, not "
            "energy-integration intervals; energy metrics come from exact integer "
            "accounting, not from frames."
        ),
    ),
    (
        "A13",
        (
            "Synthetic, simplified demonstration model. Not Cummins equipment data "
            "and not a prediction of real equipment performance."
        ),
    ),
)

# ---------------------------------------------------------------------------
# Evidence (response) models
# ---------------------------------------------------------------------------

_FROZEN = ConfigDict(frozen=True, extra="forbid")


class EvidenceSource(BaseModel):
    """Identifies the immutable saved configuration version that was simulated."""

    model_config = _FROZEN

    configuration_id: str
    version_id: str
    version_number: int
    schema_version: str


class Scenario(BaseModel):
    model_config = _FROZEN

    id: str
    horizon_ms: int
    outage_at_ms: int
    outage_detection_ms: int
    transfer_delay_ms: int
    commanded_generators: tuple[str, ...]


class Assumption(BaseModel):
    model_config = _FROZEN

    id: str
    text: str


class Inputs(BaseModel):
    """The values taken from the saved version (never from the client)."""

    model_config = _FROZEN

    g1_enabled: bool
    g1_startup_delay_s: int
    g1_rated_kw: int
    g2_enabled: bool
    g2_startup_delay_s: int
    g2_used: bool
    load_kw: int
    battery_inverter_kw: int
    battery_usable_kwh: int
    battery_min_soc_pct: int
    battery_initial_soc_pct: int
    battery_available_kwh: float


class Event(BaseModel):
    model_config = _FROZEN

    id: str
    at_ms: int
    type: EventType
    asset: str
    description: str


class FrameStates(BaseModel):
    model_config = _FROZEN

    utility: Literal["lost"]
    g1: Literal["disabled", "starting", "ready", "online"]
    g2: Literal["not_commanded"]
    battery: Literal["standby", "discharging", "depleted"]
    load: Literal["served", "partially_served", "unserved"]


class FramePower(BaseModel):
    model_config = _FROZEN

    g1_kw: int
    battery_kw: int
    load_kw: int
    served_kw: int
    unserved_kw: int


class Frame(BaseModel):
    """System state immediately after the named event (one frame per event)."""

    model_config = _FROZEN

    event_id: str
    at_ms: int
    states: FrameStates
    power_kw: FramePower
    battery_soc_pct: float
    battery_energy_remaining_kwh: float


class Metrics(BaseModel):
    model_config = _FROZEN

    g1_ready_ms: int | None
    g1_transfer_complete_ms: int | None
    battery_depleted_ms: int | None
    battery_bridge_energy_kwh: float
    battery_energy_delivered_kwh: float
    unserved_energy_kwh: float
    battery_peak_kw: int
    battery_soc_end_pct: float


class Requirement(BaseModel):
    model_config = _FROZEN

    requirement_id: str
    type: Literal["asset_ready_within", "unserved_energy_at_most"]
    status: Literal["pass", "fail"]
    comparator: Literal["<="]
    observed: float | int | None
    threshold: float | int
    unit: Literal["ms", "kWh"]
    evidence_event_ids: tuple[str, ...]
    explanation: str


class StartupCheckEvidence(BaseModel):
    model_config = _FROZEN

    model_version: str
    source: EvidenceSource
    scenario: Scenario
    assumptions: tuple[Assumption, ...]
    inputs: Inputs
    events: tuple[Event, ...]
    frames: tuple[Frame, ...]
    metrics: Metrics
    requirements: tuple[Requirement, ...]


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------


def _kwh(kw_ms: int) -> float:
    value = Decimal(kw_ms) / Decimal(KW_MS_PER_KWH)
    return float(value.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP))


def _soc_pct(initial_pct: int, consumed_kw_ms: int, usable_kwh: int) -> float:
    drop = Decimal(consumed_kw_ms) * 100 / (Decimal(usable_kwh) * KW_MS_PER_KWH)
    value = Decimal(initial_pct) - drop
    return float(value.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))


def _ceil_div(a: int, b: int) -> int:
    return -(-a // b)


_DESCRIPTIONS = {
    "utility_outage": "Utility supply lost.",
    "start_generator": "Start command issued to G1.",
    "g1_ready": "G1 is ready to accept load.",
    "g1_transfer_complete": "Critical load transferred to G1.",
    "battery_depleted": "Battery has no remaining available energy.",
    "horizon_reached": "End of the 300 s evaluation horizon.",
}
_ASSETS = {
    "utility_outage": "utility",
    "start_generator": "g1",
    "g1_ready": "g1",
    "g1_transfer_complete": "g1",
    "battery_depleted": "battery",
    "horizon_reached": "system",
}


def run_startup_check(
    config: SystemConfigV1, source: EvidenceSource
) -> StartupCheckEvidence:
    eq = config.equipment
    g1, g2, battery = eq.g1, eq.g2, eq.battery
    load_kw = eq.load.critical_kw
    energy_start = (
        battery.usable_kwh
        * (battery.initial_soc_pct - battery.min_soc_pct)
        * (KW_MS_PER_KWH // 100)
    )  # kW*ms

    # --- scheduled (non-dynamic) events: (at_ms, type) --------------------------
    scheduled: list[tuple[int, str]] = [(OUTAGE_AT_MS, "utility_outage")]
    ready_ms = transfer_ms = None
    if g1.enabled:
        command_ms = OUTAGE_AT_MS + OUTAGE_DETECTION_MS
        ready_at = command_ms + g1.startup_delay_s * 1000
        transfer_at = ready_at + TRANSFER_DELAY_MS
        scheduled.append((command_ms, "start_generator"))
        scheduled.append((ready_at, "g1_ready"))
        scheduled.append((transfer_at, "g1_transfer_complete"))
    scheduled = [item for item in scheduled if item[0] <= HORIZON_MS]
    scheduled.sort(key=lambda item: (item[0], _PRIORITY[item[1]]))

    # --- integrate energy over the segments between distinct timestamps ---------
    times = sorted({at for at, _ in scheduled} | {HORIZON_MS})
    g1_online = False
    depleted = False
    energy = energy_start
    delivered_total = unserved_total = bridge = peak_kw = 0
    segments: list[tuple[int, int, int, int]] = []  # start, end, request kW, delivered
    depletion_events: list[tuple[int, str]] = []

    for index, t in enumerate(times):
        for at, kind in scheduled:
            if at == t and kind == "g1_transfer_complete":
                g1_online = True
        end = times[index + 1] if index + 1 < len(times) else t
        span = end - t
        served_by_g1 = min(load_kw, g1.rated_kw) if g1_online else 0
        residual = load_kw - served_by_g1
        request = min(residual, battery.inverter_kw)
        delivered = 0
        if request > 0 and not depleted:
            delivered = min(energy, request * span)
            energy -= delivered
            if energy == 0:
                # The battery is empty after supplying power up to this instant
                # (rounded up to a whole ms), so depletion precedes any other event
                # at the same timestamp.
                depletion_events.append(
                    (t + _ceil_div(delivered, request), "battery_depleted")
                )
                depleted = True
        unserved_total += residual * span - delivered
        delivered_total += delivered
        if not g1_online:
            bridge += delivered
        if delivered > 0:
            peak_kw = max(peak_kw, request)
        if span > 0:
            segments.append((t, end, request, delivered))

    def consumed_by(at_ms: int) -> int:
        total = 0
        for start, stop, request, delivered in segments:
            if stop <= at_ms:
                total += delivered
            elif start < at_ms:
                total += min(request * (at_ms - start), delivered)
        return total

    # --- final, ordered event list with deterministic ids -----------------------
    raw = scheduled + depletion_events + [(HORIZON_MS, "horizon_reached")]
    raw.sort(key=lambda item: (item[0], _PRIORITY[item[1]]))  # stable
    events = tuple(
        Event(
            id=f"evt-{number:02d}",
            at_ms=at,
            type=kind,  # type: ignore[arg-type]
            asset=_ASSETS[kind],
            description=_DESCRIPTIONS[kind],
        )
        for number, (at, kind) in enumerate(raw, start=1)
    )
    event_id = {e.type: e.id for e in events}  # each type occurs at most once
    for e in events:
        if e.type == "g1_ready":
            ready_ms = e.at_ms
        elif e.type == "g1_transfer_complete":
            transfer_ms = e.at_ms
    depleted_ms = next((e.at_ms for e in events if e.type == "battery_depleted"), None)

    # --- frames: state right after each event -----------------------------------
    frames: list[Frame] = []
    g1_status: Literal["disabled", "starting", "ready", "online"] = (
        "starting" if g1.enabled else "disabled"
    )
    frame_g1_online = False
    frame_depleted = False
    for e in events:
        if e.type == "g1_ready":
            g1_status = "ready"
        elif e.type == "g1_transfer_complete":
            g1_status = "online"
            frame_g1_online = True
        elif e.type == "battery_depleted":
            frame_depleted = True
        g1_kw = min(load_kw, g1.rated_kw) if frame_g1_online else 0
        residual = load_kw - g1_kw
        consumed = consumed_by(e.at_ms)
        # No power flows from an empty battery, even in a snapshot taken before its
        # depletion event at the same timestamp.
        battery_kw = (
            0
            if frame_depleted or energy_start - consumed == 0
            else min(residual, battery.inverter_kw)
        )
        unserved_kw = residual - battery_kw
        frames.append(
            Frame(
                event_id=e.id,
                at_ms=e.at_ms,
                states=FrameStates(
                    utility="lost",
                    g1=g1_status,
                    g2="not_commanded",
                    battery=(
                        "depleted"
                        if frame_depleted
                        else "discharging"
                        if battery_kw > 0
                        else "standby"
                    ),
                    load=(
                        "served"
                        if unserved_kw == 0
                        else "unserved"
                        if unserved_kw == load_kw
                        else "partially_served"
                    ),
                ),
                power_kw=FramePower(
                    g1_kw=g1_kw,
                    battery_kw=battery_kw,
                    load_kw=load_kw,
                    served_kw=load_kw - unserved_kw,
                    unserved_kw=unserved_kw,
                ),
                battery_soc_pct=_soc_pct(
                    battery.initial_soc_pct, consumed, battery.usable_kwh
                ),
                battery_energy_remaining_kwh=_kwh(energy_start - consumed),
            )
        )

    # --- requirements (exact values) --------------------------------------------
    start_id = event_id.get("start_generator", event_id["utility_outage"])
    if ready_ms is not None:
        observed_ms: int | None = ready_ms - OUTAGE_AT_MS
        ready_ok = observed_ms <= G1_READY_LIMIT_MS
        ready_evidence = (start_id, event_id["g1_ready"])
        ready_text = (
            f"G1 was ready {observed_ms} ms after the outage; the limit is "
            f"{G1_READY_LIMIT_MS} ms."
        )
    else:
        observed_ms = None
        ready_ok = False
        ready_evidence = (event_id["utility_outage"],)
        ready_text = (
            "G1 is disabled, so it was never started and never became ready."
            if not g1.enabled
            else "G1 did not become ready within the horizon."
        )
    continuity_ok = unserved_total == 0
    if continuity_ok:
        continuity_evidence = (event_id["utility_outage"], event_id["horizon_reached"])
        continuity_text = (
            "The critical load was fully served from the outage to the end of the "
            "horizon."
        )
    else:
        continuity_evidence = tuple(
            e.id
            for e in events
            if e.type in ("utility_outage", "g1_transfer_complete", "battery_depleted")
        )
        continuity_text = (
            f"{_kwh(unserved_total)} kWh of critical load went unserved; the limit "
            "is 0 kWh."
        )

    requirements = (
        Requirement(
            requirement_id=READY_REQUIREMENT_ID,
            type="asset_ready_within",
            status="pass" if ready_ok else "fail",
            comparator="<=",
            observed=observed_ms,
            threshold=G1_READY_LIMIT_MS,
            unit="ms",
            evidence_event_ids=ready_evidence,
            explanation=ready_text,
        ),
        Requirement(
            requirement_id=CONTINUITY_REQUIREMENT_ID,
            type="unserved_energy_at_most",
            status="pass" if continuity_ok else "fail",
            comparator="<=",
            observed=_kwh(unserved_total),
            threshold=0,
            unit="kWh",
            evidence_event_ids=continuity_evidence,
            explanation=continuity_text,
        ),
    )

    return StartupCheckEvidence(
        model_version=MODEL_VERSION,
        source=source,
        scenario=Scenario(
            id=SCENARIO_ID,
            horizon_ms=HORIZON_MS,
            outage_at_ms=OUTAGE_AT_MS,
            outage_detection_ms=OUTAGE_DETECTION_MS,
            transfer_delay_ms=TRANSFER_DELAY_MS,
            commanded_generators=("g1",),
        ),
        assumptions=tuple(Assumption(id=i, text=t) for i, t in ASSUMPTIONS),
        inputs=Inputs(
            g1_enabled=g1.enabled,
            g1_startup_delay_s=g1.startup_delay_s,
            g1_rated_kw=g1.rated_kw,
            g2_enabled=g2.enabled,
            g2_startup_delay_s=g2.startup_delay_s,
            g2_used=False,
            load_kw=load_kw,
            battery_inverter_kw=battery.inverter_kw,
            battery_usable_kwh=battery.usable_kwh,
            battery_min_soc_pct=battery.min_soc_pct,
            battery_initial_soc_pct=battery.initial_soc_pct,
            battery_available_kwh=_kwh(energy_start),
        ),
        events=events,
        frames=tuple(frames),
        metrics=Metrics(
            g1_ready_ms=ready_ms,
            g1_transfer_complete_ms=transfer_ms,
            battery_depleted_ms=depleted_ms,
            battery_bridge_energy_kwh=_kwh(bridge),
            battery_energy_delivered_kwh=_kwh(delivered_total),
            unserved_energy_kwh=_kwh(unserved_total),
            battery_peak_kw=peak_kw,
            battery_soc_end_pct=_soc_pct(
                battery.initial_soc_pct, delivered_total, battery.usable_kwh
            ),
        ),
        requirements=requirements,
    )
