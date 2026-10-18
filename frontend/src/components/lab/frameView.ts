import type { EvidenceFrame } from "@/lib/types";
import type { AssetId } from "./assets";

// Display-only mapping of one evidence frame onto the lab scene. Every number and
// state shown comes from the frame itself; nothing is computed or inferred here.

export type Tone = "normal" | "warn" | "bad";

export type FrameAssetView = {
  title: string;
  value: string;
  tone: Tone;
  dim: boolean;
};

const G1_STATE_LABEL: Record<EvidenceFrame["states"]["g1"], string> = {
  disabled: "DISABLED",
  starting: "STARTING",
  ready: "READY",
  online: "ONLINE",
};

export function frameAssetView(
  id: AssetId,
  frame: EvidenceFrame,
): FrameAssetView {
  const { states, power_kw: p } = frame;
  switch (id) {
    case "utility":
      return { title: "UTILITY", value: "LOST", tone: "bad", dim: true };
    case "g1":
      return {
        title: `G1 · ${G1_STATE_LABEL[states.g1]}`,
        value: `${p.g1_kw} kW`,
        tone: states.g1 === "starting" ? "warn" : "normal",
        dim: states.g1 === "disabled" || states.g1 === "starting",
      };
    case "g2":
      return { title: "G2", value: "NOT COMMANDED", tone: "normal", dim: true };
    case "battery":
      return {
        title: `BATTERY · ${states.battery.toUpperCase()}`,
        value: `${frame.battery_soc_pct}% SoC · ${p.battery_kw} kW`,
        tone: states.battery === "depleted" ? "bad" : "normal",
        dim: false,
      };
    case "load":
      return {
        title: "CRITICAL LOAD",
        value: `${p.served_kw}/${p.load_kw} kW served`,
        tone:
          states.load === "served"
            ? "normal"
            : states.load === "unserved"
              ? "bad"
              : "warn",
        dim: false,
      };
    case "switchgear":
      return {
        title: "SWITCHGEAR",
        value: "Mode: auto",
        tone: "normal",
        dim: false,
      };
  }
}

/** Whether power flows on an asset connection in this frame, and how much. */
export function frameFlow(
  from: AssetId,
  frame: EvidenceFrame,
): { active: boolean; kw: number | null } {
  const p = frame.power_kw;
  switch (from) {
    case "g1":
      return { active: p.g1_kw > 0, kw: p.g1_kw };
    case "battery":
      return { active: p.battery_kw > 0, kw: p.battery_kw };
    case "load":
      return { active: p.served_kw > 0, kw: p.served_kw };
    default:
      return { active: false, kw: null }; // utility is lost; G2 is not commanded
  }
}
