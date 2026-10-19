// Progress for the guided challenges, derived from real state only: the draft,
// the latest saved version and live startup-check evidence returned by the
// backend. Nothing here advances because a button was clicked, and nothing
// recomputes power, energy or pass/fail: those values are read from the evidence.

import type {
  CurrentConfiguration,
  EvidenceRequirement,
  StartupCheckEvidence,
  SystemConfigV1,
} from "@/lib/types";
import type { ComparisonResult } from "@/lib/useStartupComparison";

export type ChallengeId = "g1-startup" | "battery-continuity";

export const READY_REQUIREMENT_ID = "G1_READY_WITHIN_10S";
export const CONTINUITY_REQUIREMENT_ID = "CRITICAL_LOAD_CONTINUITY";

/** The delay named by G1_READY_WITHIN_10S. The verdict itself comes from the backend. */
export const G1_READY_LIMIT_S = 10;
export const G1_LONG_DELAY_PRESET_S = 15;
export const BATTERY_LOAD_PRESET_KW = 400;

export type StepStatus = "done" | "current" | "todo";
export type Step = {
  id: string;
  label: string;
  status: StepStatus;
  detail: string | null;
};

type StepDef = Omit<Step, "status"> & { done: boolean };

/** The first unfinished step is the current one. */
function toSteps(defs: StepDef[]): Step[] {
  let currentFound = false;
  return defs.map(({ done, ...rest }) => {
    if (done) return { ...rest, status: "done" };
    if (!currentFound) {
      currentFound = true;
      return { ...rest, status: "current" };
    }
    return { ...rest, status: "todo" };
  });
}

// ---- draft-only presets (each changes exactly the field it names) -----------

export const setG1StartupDelay =
  (seconds: number) =>
  (c: SystemConfigV1): SystemConfigV1 => ({
    ...c,
    equipment: {
      ...c.equipment,
      g1: { ...c.equipment.g1, startup_delay_s: seconds },
    },
  });

export const setCriticalLoad =
  (kw: number) =>
  (c: SystemConfigV1): SystemConfigV1 => ({
    ...c,
    equipment: {
      ...c.equipment,
      load: { ...c.equipment.load, critical_kw: kw },
    },
  });

// ---- evidence helpers --------------------------------------------------------

/**
 * Live evidence for exactly the latest saved version of this workspace's
 * configuration. Recorded playback and results for older versions never count.
 */
export function freshLiveEvidence(
  server: CurrentConfiguration,
  result: ComparisonResult | null,
): StartupCheckEvidence | null {
  if (!result || result.mode !== "live") return null;
  const source = result.modified.source;
  return source.configuration_id === server.configuration_id &&
    source.version_number === server.latest_version
    ? result.modified
    : null;
}

function requirementOf(
  evidence: StartupCheckEvidence | null,
  id: string,
): EvidenceRequirement | null {
  return evidence?.requirements.find((r) => r.requirement_id === id) ?? null;
}

function staleNote(
  server: CurrentConfiguration,
  result: ComparisonResult | null,
): string | null {
  if (!result) return null;
  if (result.mode === "recorded") {
    return "Recorded demo playback does not count. Run the live test.";
  }
  if (!freshLiveEvidence(server, result)) {
    return `The last live result is for an earlier saved version; the latest is v${server.latest_version}. Run the test again.`;
  }
  return null;
}

// ---- G1 startup challenge ----------------------------------------------------

/** What the visitor observed: a failed readiness requirement at a saved version. */
export type G1Failure = {
  configurationId: string;
  version: number;
  observedMs: number | null;
  limitMs: number;
};

/** A fresh, live readiness failure of a version whose G1 was enabled and slow. */
export function observeG1Failure(
  server: CurrentConfiguration,
  result: ComparisonResult | null,
): G1Failure | null {
  const evidence = freshLiveEvidence(server, result);
  const requirement = requirementOf(evidence, READY_REQUIREMENT_ID);
  if (
    !evidence ||
    !requirement ||
    requirement.status !== "fail" ||
    !evidence.inputs.g1_enabled ||
    evidence.inputs.g1_startup_delay_s <= G1_READY_LIMIT_S
  ) {
    return null;
  }
  return {
    configurationId: evidence.source.configuration_id,
    version: evidence.source.version_number,
    observedMs: requirement.observed,
    limitMs: requirement.threshold,
  };
}

export type G1View = {
  steps: Step[];
  repair: { status: StepStatus; detail: string | null };
  notes: string[];
  showSlowPreset: boolean;
  showRepairPreset: boolean;
};

export function deriveG1(input: {
  server: CurrentConfiguration;
  draft: SystemConfigV1;
  dirty: boolean;
  result: ComparisonResult | null;
  /** Failure remembered from an earlier fresh run (the saved version may have moved on). */
  remembered: G1Failure | null;
  runBlockedReason: string | null;
}): G1View {
  const { server, draft, dirty, result, runBlockedReason } = input;
  const saved = server.snapshot.equipment.g1;
  const drafted = draft.equipment.g1;
  const evidence = freshLiveEvidence(server, result);
  const failure =
    input.remembered?.configurationId === server.configuration_id
      ? input.remembered
      : observeG1Failure(server, result);

  const savedSlow = saved.enabled && saved.startup_delay_s > G1_READY_LIMIT_S;
  const draftSlow =
    drafted.enabled && drafted.startup_delay_s > G1_READY_LIMIT_S;
  const ranSlow = savedSlow && evidence !== null;

  const steps = toSteps([
    {
      id: "configure",
      label: `Set G1's startup delay above ${G1_READY_LIMIT_S} s`,
      done: failure !== null || savedSlow || draftSlow,
      detail:
        savedSlow && failure === null
          ? `Saved v${server.latest_version} already has G1 at ${saved.startup_delay_s} s.`
          : null,
    },
    {
      id: "save",
      label: "Save it as a configuration version",
      done: failure !== null || savedSlow,
      detail:
        failure !== null
          ? `Observed on saved v${failure.version}.`
          : savedSlow
            ? "No new save needed; the saved version already qualifies."
            : null,
    },
    {
      id: "run",
      label: "Run the startup check",
      done: failure !== null || ranSlow,
      detail: null,
    },
    {
      id: "inspect",
      label: "Inspect the failed readiness requirement",
      done: failure !== null,
      detail:
        failure === null
          ? null
          : failure.observedMs === null
            ? "G1 never became ready."
            : `Evidence: G1 was ready ${failure.observedMs} ms after the outage; the limit is ${failure.limitMs} ms.`,
    },
  ]);
  const current = steps.find((s) => s.status === "current")?.id ?? null;

  const notes: string[] = [];
  if (current === "configure" && !drafted.enabled) {
    notes.push(
      "G1 is disabled in your draft. Enable it in the Inspector; the preset below changes only the startup delay.",
    );
  }
  if (current === "save") {
    notes.push(
      dirty
        ? "Save stores your whole draft, including any other unsaved edits."
        : "Save as new version is in the Inspector.",
    );
  }
  if (current === "run") {
    notes.push(
      runBlockedReason ??
        'Press "Run Utility-Outage Test" at the top of the page.',
    );
    const stale = staleNote(server, result);
    if (stale) notes.push(stale);
  }

  // Optional repair.
  const savedFast = saved.enabled && saved.startup_delay_s <= G1_READY_LIMIT_S;
  const readiness = requirementOf(evidence, READY_REQUIREMENT_ID);
  const repaired =
    failure !== null && savedFast && readiness?.status === "pass";
  let repair: G1View["repair"];
  if (failure === null) {
    repair = { status: "todo", detail: null };
  } else if (repaired && readiness) {
    repair = {
      status: "done",
      detail: `Saved v${server.latest_version}: G1 was ready ${readiness.observed} ms after the outage; the limit is ${readiness.threshold} ms.`,
    };
  } else {
    repair = { status: "current", detail: null };
    const draftFast =
      drafted.enabled && drafted.startup_delay_s <= G1_READY_LIMIT_S;
    if (!draftFast && !savedFast) {
      notes.push(
        `To repair, set G1 to ${G1_READY_LIMIT_S} s or less (G1 must stay enabled), save, then run again.`,
      );
    } else if (draftFast && !savedFast) {
      notes.push("Save the repaired draft, then run the test again.");
    } else {
      notes.push(runBlockedReason ?? "Run the test on the repaired version.");
      const stale = staleNote(server, result);
      if (stale) notes.push(stale);
    }
  }

  return {
    steps,
    repair,
    notes,
    showSlowPreset:
      failure === null &&
      !savedSlow &&
      drafted.startup_delay_s <= G1_READY_LIMIT_S,
    showRepairPreset:
      failure !== null &&
      !repaired &&
      drafted.startup_delay_s > G1_READY_LIMIT_S,
  };
}

// ---- battery continuity challenge ---------------------------------------------

export type PredictionChoice = "served" | "unserved" | "unsure";

/** Tied to a saved version (configuration id + number), plus the run count when it was made. */
export type Prediction = {
  configurationId: string;
  version: number;
  choice: PredictionChoice;
  /** `ComparisonResult.seq` at prediction time (0 if none). A qualifying run has a larger seq. */
  afterSeq: number;
};

export function makePrediction(
  server: CurrentConfiguration,
  result: ComparisonResult | null,
  choice: PredictionChoice,
): Prediction {
  return {
    configurationId: server.configuration_id,
    version: server.latest_version,
    choice,
    afterSeq: result?.seq ?? 0,
  };
}

/** Live evidence of the predicted version from a run that finished after the prediction. */
export function qualifyingEvidence(
  prediction: Prediction | null,
  result: ComparisonResult | null,
): StartupCheckEvidence | null {
  if (!prediction || !result || result.mode !== "live") return null;
  if (result.seq <= prediction.afterSeq) return null;
  const source = result.modified.source;
  return source.configuration_id === prediction.configurationId &&
    source.version_number === prediction.version
    ? result.modified
    : null;
}

export type BatteryReveal = {
  verdict: "pass" | "fail" | "missing";
  match: "matched" | "did_not_match" | "no_prediction";
  version: number;
  unservedKwh: number;
  explanation: string | null;
  lines: string[];
};

/** Every number below is read from the evidence; none is calculated here. */
export function revealBattery(
  evidence: StartupCheckEvidence,
  choice: PredictionChoice,
): BatteryReveal {
  const requirement = requirementOf(evidence, CONTINUITY_REQUIREMENT_ID);
  const verdict = requirement ? requirement.status : "missing";
  const { inputs, metrics } = evidence;
  const outage = evidence.events.find((e) => e.type === "utility_outage");
  const frame = outage
    ? evidence.frames.find((f) => f.event_id === outage.id)
    : undefined;

  const lines = [
    `Critical load: ${inputs.load_kw} kW. Battery inverter limit: ${inputs.battery_inverter_kw} kW.`,
  ];
  if (frame) {
    lines.push(
      `At the outage the battery supplied ${frame.power_kw.battery_kw} kW and ${frame.power_kw.unserved_kw} kW of demand went unserved.`,
    );
    if (
      frame.power_kw.unserved_kw > 0 &&
      frame.power_kw.battery_kw === inputs.battery_inverter_kw
    ) {
      lines.push(
        "The battery was already at its inverter limit, so demand above that limit had no other source until G1 took over.",
      );
    }
  }
  if (metrics.g1_ready_ms !== null) {
    lines.push(
      `G1 was ready ${metrics.g1_ready_ms} ms after the outage (startup delay ${inputs.g1_startup_delay_s} s).`,
    );
  }
  lines.push(`Unserved energy reported: ${metrics.unserved_energy_kwh} kWh.`);

  let match: BatteryReveal["match"] = "no_prediction";
  if (choice !== "unsure" && verdict !== "missing") {
    match =
      (choice === "served") === (verdict === "pass")
        ? "matched"
        : "did_not_match";
  }
  return {
    verdict,
    match,
    version: evidence.source.version_number,
    unservedKwh: metrics.unserved_energy_kwh,
    explanation: requirement?.explanation ?? null,
    lines,
  };
}

export type BatteryView = {
  steps: Step[];
  prerequisites: Array<{ label: string; met: boolean }>;
  canPredict: boolean;
  /** A prediction exists for the current latest saved version. */
  predictionActive: boolean;
  /** A prediction exists but the saved version changed before a qualifying run. */
  predictionStale: boolean;
  reveal: BatteryReveal | null;
  notes: string[];
  showLoadPreset: boolean;
};

export function deriveBattery(input: {
  server: CurrentConfiguration;
  draft: SystemConfigV1;
  dirty: boolean;
  result: ComparisonResult | null;
  runStatus: "idle" | "running" | "done" | "error";
  prediction: Prediction | null;
  runBlockedReason: string | null;
}): BatteryView {
  const { server, draft, dirty, result, prediction, runBlockedReason } = input;
  const eq = server.snapshot.equipment;
  const inverterKw = eq.battery.inverter_kw;
  const savedAbove = eq.load.critical_kw > inverterKw;
  const draftAbove =
    draft.equipment.load.critical_kw > draft.equipment.battery.inverter_kw;

  const prerequisites = [
    {
      label: `Saved critical load above the ${inverterKw} kW inverter limit`,
      met: savedAbove,
    },
    { label: "G1 enabled in the saved version", met: eq.g1.enabled },
    {
      label: "G1 startup delay above 0 s in the saved version",
      met: eq.g1.startup_delay_s > 0,
    },
  ];
  const ready = prerequisites.every((p) => p.met);

  const evidence = qualifyingEvidence(prediction, result);
  const matchesVersion =
    prediction !== null &&
    prediction.configurationId === server.configuration_id &&
    prediction.version === server.latest_version;
  const predictionActive = matchesVersion && evidence === null;
  const predictionStale =
    prediction !== null && !matchesVersion && evidence === null;
  const done = evidence !== null;

  const steps = toSteps([
    {
      id: "prepare",
      label: `Set critical load above the ${inverterKw} kW inverter limit`,
      done: done || draftAbove || savedAbove,
      detail: null,
    },
    {
      id: "save",
      label: "Save the configuration",
      done: done || ready,
      detail:
        ready && !done ? `Saved v${server.latest_version} qualifies.` : null,
    },
    {
      id: "predict",
      label: "Predict what the test will show",
      done: done || matchesVersion,
      detail: null,
    },
    {
      id: "run",
      label: "Run the startup check",
      done,
      detail: null,
    },
    {
      id: "reveal",
      label: "Compare with the evidence",
      done,
      detail: null,
    },
  ]);
  const current = steps.find((s) => s.status === "current")?.id ?? null;

  const notes: string[] = [];
  if (current === "save") {
    if (savedAbove) {
      notes.push(
        "The saved version also needs the prerequisites below. Change them in the Inspector and save; the load preset does not touch them.",
      );
    } else {
      notes.push(
        dirty
          ? "Save stores your whole draft, including any other unsaved edits."
          : "Save as new version is in the Inspector.",
      );
    }
  }
  if (current === "predict" && predictionStale) {
    notes.push(
      "Your earlier prediction was for a different saved version. Predict again for the latest one.",
    );
  }
  if (current === "run") {
    notes.push(
      runBlockedReason ??
        'Press "Run Utility-Outage Test" at the top of the page. Only a run after your prediction counts.',
    );
    const stale = staleNote(server, result);
    if (stale) notes.push(stale);
  }

  return {
    steps,
    prerequisites,
    // A newer saved version invites a new prediction even after an earlier reveal.
    canPredict:
      ready && (!done || !matchesVersion) && input.runStatus !== "running",
    predictionActive,
    predictionStale,
    reveal:
      evidence && prediction
        ? revealBattery(evidence, prediction.choice)
        : null,
    notes,
    showLoadPreset: !done && !draftAbove && !savedAbove,
  };
}
