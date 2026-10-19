import type {
  CurrentConfiguration,
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
