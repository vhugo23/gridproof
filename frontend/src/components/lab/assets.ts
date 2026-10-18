import type { SystemConfigV1 } from "@/lib/types";

export type AssetId =
  "utility" | "switchgear" | "g1" | "g2" | "battery" | "load";

export const ASSET_LABEL: Record<AssetId, string> = {
  utility: "Utility Supply",
  switchgear: "Switchgear",
  g1: "Generator G1",
  g2: "Generator G2",
  battery: "Battery Storage",
  load: "Critical Load",
};

export const ASSET_IDS = Object.keys(ASSET_LABEL) as AssetId[];

/** Short tag shown on the scene. Every value comes from the saved/draft configuration. */
export function assetTag(
  id: AssetId,
  config: SystemConfigV1,
): [string, string] {
  const eq = config.equipment;
  switch (id) {
    case "g1":
    case "g2": {
      const g = eq[id];
      return [
        id.toUpperCase(),
        g.enabled
          ? `${g.startup_delay_s} s start · ${g.rated_kw} kW`
          : "DISABLED",
      ];
    }
    case "battery":
      return [
        "BATTERY",
        `${eq.battery.initial_soc_pct}% SoC · ${eq.battery.inverter_kw} kW`,
      ];
    case "load":
      return ["CRITICAL LOAD", `${eq.load.critical_kw} kW`];
    case "utility":
      return ["UTILITY", eq.utility.available ? "Available" : "Unavailable"];
    case "switchgear":
      return ["SWITCHGEAR", `Mode: ${eq.switchgear.mode}`];
  }
}
