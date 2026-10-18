import type {
  CurrentConfiguration,
  Facility,
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
