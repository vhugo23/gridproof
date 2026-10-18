import type { SystemConfigV1 } from "./types";

/** Decorative values for the landing-page lab thumbnail only (no tags are shown). */
export const PREVIEW_CONFIG: SystemConfigV1 = {
  facility_id: "fridley",
  equipment: {
    g1: { rated_kw: 250, startup_delay_s: 5, enabled: true },
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
