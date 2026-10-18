// Mirrors docs/05-api-contracts.md and backend/app/domain/system_config.py.

export type Generator = {
  rated_kw: number;
  startup_delay_s: number;
  enabled: boolean;
};

export type SystemConfigV1 = {
  facility_id: string;
  equipment: {
    g1: Generator;
    g2: Generator;
    battery: {
      inverter_kw: number;
      usable_kwh: number;
      min_soc_pct: number;
      initial_soc_pct: number;
    };
    utility: { available: boolean };
    switchgear: { mode: string };
    load: { critical_kw: number };
  };
};

export type Facility = {
  id: string;
  name: string;
  city: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
  facility_type: string;
  is_interactive: boolean;
  description: string;
  source_url: string | null;
  source_note: string;
};

export type FacilitiesResponse = {
  catalog_version: number;
  facilities: Facility[];
};

export type SessionResponse = {
  workspace_id: string;
  expires_at: string;
  is_new: boolean;
};

export type CurrentConfiguration = {
  configuration_id: string;
  name: string;
  latest_version: number;
  version_id: string;
  schema_version: string;
  snapshot: SystemConfigV1;
  saved_at: string;
};

export type SavedVersion = {
  configuration_id: string;
  version_id: string;
  version_number: number;
  schema_version: string;
  saved_at: string;
};

export type ErrorDetail = { field: string; reason: string };

// Startup-check evidence (docs/05-api-contracts.md API-16). Rendered as returned;
// the frontend never recomputes power, energy or requirement results.

export type EvidenceEventType =
  | "utility_outage"
  | "start_generator"
  | "battery_depleted"
  | "g1_ready"
  | "g1_transfer_complete"
  | "horizon_reached";

export type EvidenceEvent = {
  id: string;
  at_ms: number;
  type: EvidenceEventType;
  asset: string;
  description: string;
};

export type EvidenceFrame = {
  event_id: string;
  at_ms: number;
  states: {
    utility: "lost";
    g1: "disabled" | "starting" | "ready" | "online";
    g2: "not_commanded";
    battery: "standby" | "discharging" | "depleted";
    load: "served" | "partially_served" | "unserved";
  };
  power_kw: {
    g1_kw: number;
    battery_kw: number;
    load_kw: number;
    served_kw: number;
    unserved_kw: number;
  };
  battery_soc_pct: number;
  battery_energy_remaining_kwh: number;
};

export type EvidenceRequirement = {
  requirement_id: string;
  type: "asset_ready_within" | "unserved_energy_at_most";
  status: "pass" | "fail";
  comparator: "<=";
  observed: number | null;
  threshold: number;
  unit: "ms" | "kWh";
  evidence_event_ids: string[];
  explanation: string;
};

export type StartupCheckEvidence = {
  model_version: string;
  source: {
    configuration_id: string;
    version_id: string;
    version_number: number;
    schema_version: string;
  };
  scenario: {
    id: string;
    horizon_ms: number;
    outage_at_ms: number;
    outage_detection_ms: number;
    transfer_delay_ms: number;
    commanded_generators: string[];
  };
  assumptions: Array<{ id: string; text: string }>;
  inputs: {
    g1_enabled: boolean;
    g1_startup_delay_s: number;
    g1_rated_kw: number;
    g2_enabled: boolean;
    g2_startup_delay_s: number;
    g2_used: boolean;
    load_kw: number;
    battery_inverter_kw: number;
    battery_usable_kwh: number;
    battery_min_soc_pct: number;
    battery_initial_soc_pct: number;
    battery_available_kwh: number;
  };
  events: EvidenceEvent[];
  frames: EvidenceFrame[];
  metrics: {
    g1_ready_ms: number | null;
    g1_transfer_complete_ms: number | null;
    battery_depleted_ms: number | null;
    battery_bridge_energy_kwh: number;
    battery_energy_delivered_kwh: number;
    unserved_energy_kwh: number;
    battery_peak_kw: number;
    battery_soc_end_pct: number;
  };
  requirements: EvidenceRequirement[];
};
