import type {
  CapacityCheckEvidence,
  CapacityRequirement,
  CurrentConfiguration,
  DutyCycleEvidence,
  Facility,
  StartupCheckEvidence,
  SystemConfigV1,
} from "@/lib/types";

export function config(g1Delay = 5): SystemConfigV1 {
  return {
    facility_id: "fridley",
    equipment: {
      g1: { rated_kw: 250, startup_delay_s: g1Delay, enabled: true },
      g2: { rated_kw: 250, startup_delay_s: 5, enabled: true },
      battery: {
        inverter_kw: 250,
        usable_kwh: 500,
        min_soc_pct: 20,
        initial_soc_pct: 80,
      },
      utility: { available: true },
      switchgear: { mode: "auto" },
      load: { critical_kw: 180 },
    },
  };
}

export function current(version = 1, g1Delay = 5): CurrentConfiguration {
  return {
    configuration_id: "11111111-1111-4111-8111-111111111111",
    name: "Fridley Test Configuration",
    latest_version: version,
    version_id: `22222222-2222-4222-8222-22222222222${version}`,
    schema_version: "config-v1",
    snapshot: config(g1Delay),
    saved_at: "2026-10-18T12:00:00Z",
  };
}

function facility(
  id: string,
  city: string,
  region: string,
  country: string,
  latitude: number,
  longitude: number,
  interactive: boolean,
): Facility {
  return {
    id,
    name: `${city} site`,
    city,
    region,
    country,
    latitude,
    longitude,
    facility_type: interactive ? "integration_testing" : "manufacturing_site",
    is_interactive: interactive,
    description: "Synthetic test description.",
    source_url: null,
    source_note: "approximate",
  };
}

export const facilities: Facility[] = [
  facility("fridley", "Fridley", "MN", "US", 45.08417, -93.25667, true),
  facility("seymour", "Seymour", "IN", "US", 38.95722, -85.89444, false),
  facility(
    "daventry",
    "Daventry",
    "Northamptonshire",
    "GB",
    52.25778,
    -1.16278,
    false,
  ),
];

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function apiError(
  status: number,
  code: string,
  details: Array<{ field: string; reason: string }> = [],
): Response {
  return json(status, {
    error: { code, message: `${code} message`, details, request_id: "req_t" },
  });
}

/**
 * Hand-built startup-check evidence in the shape of API-16, for tests of how the
 * UI reads evidence. Values are literals chosen by hand; the real model is
 * checked by the backend tests and the local end-to-end run. Assumes the fixed
 * 250 kW inverter and 250 kW generator.
 */
export function evidence(options: {
  version?: number;
  configurationId?: string;
  delay: number;
  load?: number;
  /** Hand-calculated, e.g. (400 - 250) kW x 15 s / 3600 = 0.625 kWh. */
  unservedKwh?: number;
  g1Enabled?: boolean;
}): StartupCheckEvidence {
  const {
    version = 1,
    configurationId = "11111111-1111-4111-8111-111111111111",
    delay,
    load = 180,
    unservedKwh = 0,
    g1Enabled = true,
  } = options;
  const readyMs = delay * 1000;
  const unservedKw = Math.max(0, load - 250);
  const ready = g1Enabled && delay <= 10;
  const continuityOk = unservedKwh === 0;
  return {
    model_version: "startup-check-v1",
    source: {
      configuration_id: configurationId,
      version_id: `22222222-2222-4222-8222-22222222222${version}`,
      version_number: version,
      schema_version: "config-v1",
    },
    scenario: {
      id: "utility_outage_g1_startup",
      horizon_ms: 300000,
      outage_at_ms: 0,
      outage_detection_ms: 0,
      transfer_delay_ms: 0,
      commanded_generators: ["g1"],
    },
    assumptions: [],
    inputs: {
      g1_enabled: g1Enabled,
      g1_startup_delay_s: delay,
      g1_rated_kw: 250,
      g2_enabled: true,
      g2_startup_delay_s: 5,
      g2_used: false,
      load_kw: load,
      battery_inverter_kw: 250,
      battery_usable_kwh: 500,
      battery_min_soc_pct: 20,
      battery_initial_soc_pct: 80,
      battery_available_kwh: 300,
    },
    events: [
      {
        id: "evt-01",
        at_ms: 0,
        type: "utility_outage",
        asset: "utility",
        description: "Utility supply lost.",
      },
      {
        id: "evt-02",
        at_ms: 300000,
        type: "horizon_reached",
        asset: "system",
        description: "End of the 300 s evaluation horizon.",
      },
    ],
    frames: [
      {
        event_id: "evt-01",
        at_ms: 0,
        states: {
          utility: "lost",
          g1: g1Enabled ? "starting" : "disabled",
          g2: "not_commanded",
          battery: "discharging",
          load: unservedKw > 0 ? "partially_served" : "served",
        },
        power_kw: {
          g1_kw: 0,
          battery_kw: Math.min(load, 250),
          load_kw: load,
          served_kw: Math.min(load, 250),
          unserved_kw: unservedKw,
        },
        battery_soc_pct: 80,
        battery_energy_remaining_kwh: 300,
      },
    ],
    metrics: {
      g1_ready_ms: g1Enabled ? readyMs : null,
      g1_transfer_complete_ms: g1Enabled ? readyMs : null,
      battery_depleted_ms: null,
      battery_bridge_energy_kwh: 0,
      battery_energy_delivered_kwh: 0,
      unserved_energy_kwh: unservedKwh,
      battery_peak_kw: Math.min(load, 250),
      battery_soc_end_pct: 80,
    },
    requirements: [
      {
        requirement_id: "G1_READY_WITHIN_10S",
        type: "asset_ready_within",
        status: ready ? "pass" : "fail",
        comparator: "<=",
        observed: g1Enabled ? readyMs : null,
        threshold: 10000,
        unit: "ms",
        evidence_event_ids: ["evt-01"],
        explanation: "readiness explanation from the backend",
      },
      {
        requirement_id: "CRITICAL_LOAD_CONTINUITY",
        type: "unserved_energy_at_most",
        status: continuityOk ? "pass" : "fail",
        comparator: "<=",
        observed: unservedKwh,
        threshold: 0,
        unit: "kWh",
        evidence_event_ids: ["evt-01"],
        explanation: continuityOk
          ? "continuity passed (backend text)"
          : `${unservedKwh} kWh of critical load went unserved; the limit is 0 kWh.`,
      },
    ],
  };
}

type ReqSpec = [
  status: "pass" | "fail",
  required: number,
  capacity: number,
  margin: number,
  pct: number,
];

function capacityRequirement(
  id: CapacityRequirement["requirement_id"],
  [status, required, capacity, margin, pct]: ReqSpec,
): CapacityRequirement {
  const unit = id === "KW_CAPACITY" ? "kW" : "kVA";
  return {
    requirement_id: id,
    status,
    comparator: "<=",
    required,
    capacity,
    unit,
    margin,
    margin_pct_of_required: pct,
    explanation: `Backend explanation: required ${required.toFixed(2)} ${unit} against ${capacity} ${unit} (${status}).`,
  };
}

function capacityPackage(
  letter: string,
  kw: number,
  kva: number,
  kwSpec: ReqSpec,
  kvaSpec: ReqSpec,
) {
  return {
    id: `synthetic-${letter.toLowerCase()}`,
    label: `Synthetic Package ${letter}`,
    rated_kw: kw,
    rated_kva: kva,
    rated_power_factor: 0.8,
    requirements: [
      capacityRequirement("KW_CAPACITY", kwSpec),
      capacityRequirement("KVA_CAPACITY", kvaSpec),
    ],
    both_requirements_pass: kwSpec[0] === "pass" && kvaSpec[0] === "pass",
  };
}

const CAPACITY_ASSUMPTIONS = [
  { id: "A1", text: "Backend assumption one: the packages are synthetic." },
  { id: "A7", text: "Backend assumption seven: derating is not checked." },
];

/** Hand-calculated: 400 kW at 0.80 pf is 500 kVA (backend test case 1). */
export const CAPACITY_CASE_1: CapacityCheckEvidence = {
  model_version: "capacity-check-v1",
  inputs: { real_power_kw: 400, power_factor: 0.8, capacity_margin_pct: 0 },
  demand: {
    real_power_kw: 400,
    apparent_power_kva: 500,
    required_kw: 400,
    required_kva: 500,
  },
  assumptions: CAPACITY_ASSUMPTIONS,
  packages: [
    capacityPackage(
      "A",
      200,
      250,
      ["fail", 400, 200, -200, -50],
      ["fail", 500, 250, -250, -50],
    ),
    capacityPackage(
      "B",
      320,
      400,
      ["fail", 400, 320, -80, -20],
      ["fail", 500, 400, -100, -20],
    ),
    capacityPackage(
      "C",
      480,
      600,
      ["pass", 400, 480, 80, 20],
      ["pass", 500, 600, 100, 20],
    ),
    capacityPackage(
      "D",
      640,
      800,
      ["pass", 400, 640, 240, 60],
      ["pass", 500, 800, 300, 60],
    ),
  ],
};

/** Hand-calculated: 300 kW at 0.70 pf is 428.57 kVA; B passes kW but fails kVA (case 2). */
export const CAPACITY_CASE_2: CapacityCheckEvidence = {
  model_version: "capacity-check-v1",
  inputs: { real_power_kw: 300, power_factor: 0.7, capacity_margin_pct: 0 },
  demand: {
    real_power_kw: 300,
    apparent_power_kva: 428.57,
    required_kw: 300,
    required_kva: 428.57,
  },
  assumptions: CAPACITY_ASSUMPTIONS,
  packages: [
    capacityPackage(
      "A",
      200,
      250,
      ["fail", 300, 200, -100, -33.33],
      ["fail", 428.57, 250, -178.57, -41.67],
    ),
    capacityPackage(
      "B",
      320,
      400,
      ["pass", 300, 320, 20, 6.67],
      ["fail", 428.57, 400, -28.57, -6.67],
    ),
    capacityPackage(
      "C",
      480,
      600,
      ["pass", 300, 480, 180, 60],
      ["pass", 428.57, 600, 171.43, 40],
    ),
    capacityPackage(
      "D",
      640,
      800,
      ["pass", 300, 640, 340, 113.33],
      ["pass", 428.57, 800, 371.43, 86.67],
    ),
  ],
};

/**
 * Hand-calculated (matches the backend test): Loading 120 kW x 3 min = 6 kWh,
 * Hauling 300 x 12 = 60 kWh, Dumping 90 x 2 = 3 kWh, Returning 60 x 8 = 8 kWh.
 * 77 kWh in 25 min, 18 cycles = 1386 kWh in 450 min, 77 x 60 / 25 = 184.8 kW.
 */
export const DUTY_CYCLE_SAMPLE: DutyCycleEvidence = {
  model_version: "duty-cycle-v1",
  inputs: {
    segments: [
      { name: "Loading", power_kw: 120, duration_min: 3 },
      { name: "Hauling", power_kw: 300, duration_min: 12 },
      { name: "Dumping", power_kw: 90, duration_min: 2 },
      { name: "Returning", power_kw: 60, duration_min: 8 },
    ],
    cycles_per_shift: 18,
  },
  segments: [
    segment(1, "Loading", 120, 3, 6, 7.79, false),
    segment(2, "Hauling", 300, 12, 60, 77.92, true),
    segment(3, "Dumping", 90, 2, 3, 3.9, false),
    segment(4, "Returning", 60, 8, 8, 10.39, false),
  ],
  cycle: {
    duration_min: 25,
    energy_kwh: 77,
    average_power_kw: 184.8,
    peak_power_kw: 300,
  },
  shift: { cycles: 18, duration_min: 450, energy_kwh: 1386 },
  dominant_segment_ids: ["segment-2"],
  explanation:
    "Hauling uses the most energy: 60.00 kWh of 77.00 kWh (77.92% of cycle energy), from 300.00 kW for 12.00 min (48.00% of cycle time). It also has the highest power.",
  assumptions: [
    { id: "A1", text: "Backend assumption one: values are user-entered." },
    { id: "A7", text: "Backend assumption seven: fuel use is not modeled." },
  ],
};

function segment(
  n: number,
  name: string,
  power_kw: number,
  duration_min: number,
  energy_kwh: number,
  share_of_cycle_energy_pct: number,
  is_dominant: boolean,
) {
  return {
    id: `segment-${n}`,
    name,
    power_kw,
    duration_min,
    energy_kwh,
    share_of_cycle_energy_pct,
    is_dominant,
  };
}
