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
