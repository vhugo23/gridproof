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

// Daventry capacity check (docs/05-api-contracts.md API-17). Rendered as returned;
// the frontend never recomputes demand, margins or PASS/FAIL.

export type CapacityCheckRequest = {
  real_power_kw: number;
  power_factor: number;
  /** Omitted means 0. */
  capacity_margin_pct?: number;
};

export type CapacityRequirement = {
  requirement_id: "KW_CAPACITY" | "KVA_CAPACITY";
  status: "pass" | "fail";
  comparator: "<=";
  required: number;
  capacity: number;
  unit: "kW" | "kVA";
  margin: number;
  margin_pct_of_required: number;
  explanation: string;
};

export type CapacityPackage = {
  id: string;
  label: string;
  rated_kw: number;
  rated_kva: number;
  rated_power_factor: number;
  requirements: CapacityRequirement[];
  both_requirements_pass: boolean;
};

export type CapacityCheckEvidence = {
  model_version: string;
  inputs: {
    real_power_kw: number;
    power_factor: number;
    capacity_margin_pct: number;
  };
  demand: {
    real_power_kw: number;
    apparent_power_kva: number;
    required_kw: number;
    required_kva: number;
  };
  assumptions: Array<{ id: string; text: string }>;
  packages: CapacityPackage[];
};

// Mining duty-cycle analyzer (docs/05-api-contracts.md API-18). Rendered as returned;
// the frontend never recomputes energy, shares, totals or the dominant segment.

export type DutyCycleSegmentInput = {
  name: string;
  power_kw: number;
  duration_min: number;
};

export type DutyCycleRequest = {
  segments: DutyCycleSegmentInput[];
  cycles_per_shift: number;
};

export type DutyCycleSegment = {
  id: string;
  name: string;
  power_kw: number;
  duration_min: number;
  energy_kwh: number;
  share_of_cycle_energy_pct: number;
  is_dominant: boolean;
};

export type DutyCycleEvidence = {
  model_version: string;
  inputs: DutyCycleRequest;
  segments: DutyCycleSegment[];
  cycle: {
    duration_min: number;
    energy_kwh: number;
    average_power_kw: number;
    peak_power_kw: number;
  };
  shift: { cycles: number; duration_min: number; energy_kwh: number };
  /** Empty when the cycle uses no energy; several ids when energies tie exactly. */
  dominant_segment_ids: string[];
  explanation: string;
  assumptions: Array<{ id: string; text: string }>;
};

// Mobile-Site Power Planner (docs/05-api-contracts.md API-19). Rendered as returned;
// the frontend never recomputes totals, shares, headroom, utilization or categories.

export type MobilePowerLoadInput = {
  name: string;
  quantity: number;
  rated_kw: number;
  simultaneity_factor: number;
};

export type MobilePowerRequest = {
  loads: MobilePowerLoadInput[];
  capacity_margin_pct: number;
};

export type MobilePowerLoad = {
  id: string;
  name: string;
  quantity: number;
  rated_kw: number;
  simultaneity_factor: number;
  connected_kw: number;
  demand_kw: number;
  share_of_demand_pct: number;
  is_dominant: boolean;
};

export type MobilePowerComparison = {
  status: "meets" | "does_not_meet";
  comparator: "<=";
  required: number;
  capacity: number;
  /** Rating minus requirement; negative when the requirement is above the rating. */
  headroom_kw: number;
  utilization_pct: number;
};

export type MobilePowerCategory =
  | "does_not_meet_modeled"
  | "meets_modeled_only"
  | "meets_modeled_and_all_simultaneous";

export type MobilePowerPackage = {
  id: string;
  label: string;
  rated_kw: number;
  modeled_demand: MobilePowerComparison;
  all_simultaneous: MobilePowerComparison;
  category: MobilePowerCategory;
  category_label: string;
  explanation: string;
};

export type MobilePowerEvidence = {
  model_version: string;
  inputs: MobilePowerRequest;
  loads: MobilePowerLoad[];
  totals: {
    connected_kw: number;
    demand_kw: number;
    overall_simultaneity_pct: number;
    required_kw: number;
    all_simultaneous_required_kw: number;
  };
  dominant_load_ids: string[];
  packages: MobilePowerPackage[];
  explanation: string;
  assumptions: Array<{ id: string; text: string }>;
};
