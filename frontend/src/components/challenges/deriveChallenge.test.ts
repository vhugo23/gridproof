import { describe, expect, it } from "vitest";
import type { CurrentConfiguration, SystemConfigV1 } from "@/lib/types";
import type { ComparisonResult } from "@/lib/useStartupComparison";
import { config, current, evidence } from "@/test/fixtures";
import {
  deriveBattery,
  deriveG1,
  makePrediction,
  observeG1Failure,
  qualifyingEvidence,
  revealBattery,
  setCriticalLoad,
  setG1StartupDelay,
  type G1Failure,
} from "./deriveChallenge";

type Evidence = ReturnType<typeof evidence>;

function server(
  version: number,
  mutate: (c: SystemConfigV1) => void = () => {},
): CurrentConfiguration {
  const base = current(version);
  const snapshot = structuredClone(base.snapshot);
  mutate(snapshot);
  return { ...base, snapshot };
}

const withDelay = (s: number) => (c: SystemConfigV1) => {
  c.equipment.g1.startup_delay_s = s;
};
const withLoad = (kw: number) => (c: SystemConfigV1) => {
  c.equipment.load.critical_kw = kw;
};

function live(ev: Evidence, seq: number): ComparisonResult {
  return { mode: "live", baseline: ev, modified: ev, sameVersion: false, seq };
}
function recorded(ev: Evidence, seq: number): ComparisonResult {
  return { ...live(ev, seq), mode: "recorded" };
}

const status = (view: { steps: Array<{ id: string; status: string }> }) =>
  Object.fromEntries(view.steps.map((s) => [s.id, s.status]));

function g1(
  saved: CurrentConfiguration,
  draft: SystemConfigV1,
  result: ComparisonResult | null = null,
  remembered: G1Failure | null = null,
  dirty = false,
) {
  return deriveG1({
    server: saved,
    draft,
    dirty,
    result,
    remembered,
    runBlockedReason: null,
  });
}

describe("G1 challenge progress", () => {
  it("starts at the first step from the default v1 / 5 s configuration", () => {
    const s = server(1);
    const view = g1(s, s.snapshot);
    expect(status(view)).toEqual({
      configure: "current",
      save: "todo",
      run: "todo",
      inspect: "todo",
    });
    expect(view.showSlowPreset).toBe(true);
    expect(view.repair.status).toBe("todo");
  });

  it("treats an unsaved draft above 10 s as configured but not saved", () => {
    const s = server(1);
    const view = g1(s, config(15), null, null, true);
    expect(status(view)).toMatchObject({ configure: "done", save: "current" });
    expect(view.notes.join(" ")).toMatch(/whole draft/);
  });

  it("does not count a draft above 10 s when G1 is disabled, and explains why", () => {
    const s = server(1);
    const draft = config(15);
    draft.equipment.g1.enabled = false;
    const view = g1(s, draft);
    expect(status(view).configure).toBe("current");
    expect(view.notes.join(" ")).toMatch(/G1 is disabled/);
  });

  it("does not assume v1 or 5 s: a saved v3 at 12 s needs no new save", () => {
    const s = server(3, withDelay(12));
    const view = g1(s, s.snapshot);
    expect(status(view)).toEqual({
      configure: "done",
      save: "done",
      run: "current",
      inspect: "todo",
    });
  });

  it("uses 10 s as the inclusive boundary: 10 s is not above, 11 s is", () => {
    expect(
      status(g1(server(2, withDelay(10)), server(2, withDelay(10)).snapshot))
        .configure,
    ).toBe("current");
    expect(
      status(g1(server(2, withDelay(11)), server(2, withDelay(11)).snapshot))
        .configure,
    ).toBe("done");
  });

  it("ignores recorded playback and stale results", () => {
    const s = server(2, withDelay(15));
    const fail = evidence({ version: 2, delay: 15 });
    expect(status(g1(s, s.snapshot, recorded(fail, 1))).run).toBe("current");
    const older = evidence({ version: 1, delay: 5 });
    const staleView = g1(s, s.snapshot, live(older, 1));
    expect(status(staleView).run).toBe("current");
    expect(staleView.notes.join(" ")).toMatch(/earlier saved version/);
    const otherWorkspace = evidence({
      version: 2,
      delay: 15,
      configurationId: "99999999-9999-4999-8999-999999999999",
    });
    expect(status(g1(s, s.snapshot, live(otherWorkspace, 1))).run).toBe(
      "current",
    );
  });

  it("completes the failure steps from fresh live evidence and quotes it", () => {
    const s = server(2, withDelay(15));
    const view = g1(
      s,
      s.snapshot,
      live(evidence({ version: 2, delay: 15 }), 1),
    );
    expect(status(view)).toEqual({
      configure: "done",
      save: "done",
      run: "done",
      inspect: "done",
    });
    const inspect = view.steps.find((x) => x.id === "inspect")!;
    expect(inspect.detail).toContain("15000 ms");
    expect(inspect.detail).toContain("10000 ms");
  });

  it("does not count a failed run of a version with G1 disabled", () => {
    const s = server(2, (c) => {
      c.equipment.g1.enabled = false;
    });
    expect(
      observeG1Failure(
        s,
        live(evidence({ version: 2, delay: 5, g1Enabled: false }), 1),
      ),
    ).toBeNull();
  });

  it("keeps the observed failure and completes the repair on a fresh pass", () => {
    const failed = observeG1Failure(
      server(2, withDelay(15)),
      live(evidence({ version: 2, delay: 15 }), 1),
    )!;
    expect(failed).toMatchObject({ version: 2, observedMs: 15000 });

    const repaired = server(3, withDelay(10));
    const before = g1(repaired, repaired.snapshot, null, failed);
    expect(before.repair.status).toBe("current");
    expect(before.steps.every((x) => x.status === "done")).toBe(true);

    const after = g1(
      repaired,
      repaired.snapshot,
      live(evidence({ version: 3, delay: 10 }), 2),
      failed,
    );
    expect(after.repair.status).toBe("done");
    expect(after.repair.detail).toContain("10000 ms");
  });

  it("does not complete a repair from an unsaved draft or a stale pass", () => {
    const failed: G1Failure = {
      configurationId: current().configuration_id,
      version: 2,
      observedMs: 15000,
      limitMs: 10000,
    };
    const s = server(2, withDelay(15));
    const draft = config(8);
    const view = g1(s, draft, null, failed, true);
    expect(view.repair.status).toBe("current");
    expect(view.notes.join(" ")).toMatch(/Save the repaired draft/);
    expect(view.showRepairPreset).toBe(false);
    const stalePass = live(evidence({ version: 1, delay: 5 }), 2);
    expect(g1(s, s.snapshot, stalePass, failed).repair.status).toBe("current");
  });

  it("ignores a remembered failure from another configuration", () => {
    const other: G1Failure = {
      configurationId: "99999999-9999-4999-8999-999999999999",
      version: 2,
      observedMs: 15000,
      limitMs: 10000,
    };
    const s = server(1);
    expect(status(g1(s, s.snapshot, null, other)).configure).toBe("current");
  });
});

const BATTERY_READY = (c: SystemConfigV1) => {
  c.equipment.load.critical_kw = 400;
  c.equipment.g1.startup_delay_s = 15;
};

function battery(
  saved: CurrentConfiguration,
  draft: SystemConfigV1,
  result: ComparisonResult | null,
  prediction: ReturnType<typeof makePrediction> | null,
  runStatus: "idle" | "running" | "done" | "error" = "idle",
) {
  return deriveBattery({
    server: saved,
    draft,
    dirty: false,
    result,
    runStatus,
    prediction,
    runBlockedReason: null,
  });
}

describe("battery challenge progress", () => {
  it("starts by asking for a load above the inverter limit", () => {
    const s = server(1);
    const view = battery(s, s.snapshot, null, null);
    expect(status(view).prepare).toBe("current");
    expect(view.showLoadPreset).toBe(true);
    expect(view.canPredict).toBe(false);
  });

  it("separates the unsaved draft from the saved version", () => {
    const s = server(1);
    const draft = structuredClone(s.snapshot);
    withLoad(400)(draft);
    const view = battery(s, draft, null, null);
    expect(status(view)).toMatchObject({ prepare: "done", save: "current" });
    expect(view.canPredict).toBe(false);
  });

  it("explains unmet saved prerequisites instead of changing them", () => {
    const s = server(2, (c) => {
      c.equipment.load.critical_kw = 400;
      c.equipment.g1.startup_delay_s = 0;
    });
    const view = battery(s, s.snapshot, null, null);
    expect(view.canPredict).toBe(false);
    expect(
      view.prerequisites.filter((p) => !p.met).map((p) => p.label),
    ).toEqual(["G1 startup delay above 0 s in the saved version"]);
    expect(view.notes.join(" ")).toMatch(/does not touch them/);
  });

  it("allows a prediction once the saved version qualifies", () => {
    const s = server(2, BATTERY_READY);
    const view = battery(s, s.snapshot, null, null);
    expect(status(view).predict).toBe("current");
    expect(view.canPredict).toBe(true);
    expect(battery(s, s.snapshot, null, null, "running").canPredict).toBe(
      false,
    );
  });

  it("requires a run that finished after the prediction", () => {
    const s = server(2, BATTERY_READY);
    const ev = evidence({
      version: 2,
      delay: 15,
      load: 400,
      unservedKwh: 0.625,
    });
    // Evidence already existed (seq 3) when the prediction was made.
    const prediction = makePrediction(s, live(ev, 3), "unserved");
    expect(prediction.afterSeq).toBe(3);
    const waiting = battery(s, s.snapshot, live(ev, 3), prediction);
    expect(waiting.reveal).toBeNull();
    expect(status(waiting)).toMatchObject({ predict: "done", run: "current" });

    const afterRun = battery(s, s.snapshot, live(ev, 4), prediction);
    expect(status(afterRun).reveal).toBe("done");
    expect(afterRun.reveal).toMatchObject({
      verdict: "fail",
      match: "matched",
      version: 2,
      unservedKwh: 0.625,
    });
  });

  it("does not reveal from recorded playback or another version", () => {
    const s = server(2, BATTERY_READY);
    const ev = evidence({
      version: 2,
      delay: 15,
      load: 400,
      unservedKwh: 0.625,
    });
    const prediction = makePrediction(s, null, "served");
    expect(qualifyingEvidence(prediction, recorded(ev, 5))).toBeNull();
    const other = evidence({
      version: 1,
      delay: 5,
      load: 400,
      unservedKwh: 0.2,
    });
    expect(qualifyingEvidence(prediction, live(other, 5))).toBeNull();
    const elsewhere = evidence({
      version: 2,
      delay: 15,
      configurationId: "99999999-9999-4999-8999-999999999999",
    });
    expect(qualifyingEvidence(prediction, live(elsewhere, 5))).toBeNull();
  });

  it("treats a prediction for an older saved version as stale", () => {
    const old = server(2, BATTERY_READY);
    const prediction = makePrediction(old, null, "served");
    const newer = server(3, BATTERY_READY);
    const view = battery(newer, newer.snapshot, null, prediction);
    expect(view.predictionStale).toBe(true);
    expect(view.predictionActive).toBe(false);
    expect(status(view).predict).toBe("current");
    expect(view.canPredict).toBe(true);
  });

  it("keeps showing the revealed evidence of the predicted version after a later save", () => {
    const s2 = server(2, BATTERY_READY);
    const ev = evidence({
      version: 2,
      delay: 15,
      load: 400,
      unservedKwh: 0.625,
    });
    const prediction = makePrediction(s2, null, "unserved");
    const s3 = server(3, BATTERY_READY);
    const view = battery(s3, s3.snapshot, live(ev, 1), prediction);
    expect(view.reveal).not.toBeNull();
    // A newer saved version invites a new prediction...
    expect(view.canPredict).toBe(true);
    // ...but not while the revealed version is still the latest.
    expect(battery(s2, s2.snapshot, live(ev, 1), prediction).canPredict).toBe(
      false,
    );
  });
});

describe("battery reveal reads only the evidence", () => {
  // Hand calculation: (400 - 250) kW x 15 s / 3600 = 0.625 kWh.
  const ev = evidence({ version: 2, delay: 15, load: 400, unservedKwh: 0.625 });

  it("quotes returned values and the inverter-limit explanation", () => {
    const reveal = revealBattery(ev, "served");
    expect(reveal.verdict).toBe("fail");
    expect(reveal.match).toBe("did_not_match");
    expect(reveal.unservedKwh).toBe(0.625);
    const text = reveal.lines.join("\n");
    expect(text).toContain(
      "Critical load: 400 kW. Battery inverter limit: 250 kW.",
    );
    expect(text).toContain("battery supplied 250 kW and 150 kW");
    expect(text).toContain("already at its inverter limit");
    expect(text).toContain("15000 ms");
    expect(text).toContain("0.625 kWh");
  });

  it("reports matches and non-predictions without scoring", () => {
    expect(revealBattery(ev, "unserved").match).toBe("matched");
    expect(revealBattery(ev, "unsure").match).toBe("no_prediction");
    const pass = evidence({ version: 2, delay: 15, load: 200 });
    expect(revealBattery(pass, "served").match).toBe("matched");
    expect(revealBattery(pass, "served").lines.join(" ")).not.toContain(
      "inverter limit, so",
    );
  });
});

describe("presets change exactly one field", () => {
  it("load preset", () => {
    const before = config(5);
    const after = setCriticalLoad(400)(before);
    expect(after.equipment.load.critical_kw).toBe(400);
    expect({
      ...after,
      equipment: { ...after.equipment, load: before.equipment.load },
    }).toEqual(before);
    expect(before.equipment.load.critical_kw).toBe(180);
  });

  it("G1 delay preset leaves G1's enabled flag and everything else alone", () => {
    const before = config(5);
    before.equipment.g1.enabled = false;
    const after = setG1StartupDelay(15)(before);
    expect(after.equipment.g1).toEqual({
      rated_kw: 250,
      startup_delay_s: 15,
      enabled: false,
    });
    expect(after.equipment.g2).toEqual(before.equipment.g2);
    expect(after.equipment.load).toEqual(before.equipment.load);
  });
});
