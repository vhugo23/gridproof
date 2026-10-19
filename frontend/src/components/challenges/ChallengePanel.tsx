"use client";

import { useId, useState } from "react";
import type { CurrentConfiguration, SystemConfigV1 } from "@/lib/types";
import type {
  ComparisonResult,
  ComparisonStatus,
} from "@/lib/useStartupComparison";
import {
  BATTERY_LOAD_PRESET_KW,
  G1_LONG_DELAY_PRESET_S,
  G1_READY_LIMIT_S,
  deriveBattery,
  deriveG1,
  makePrediction,
  observeG1Failure,
  setCriticalLoad,
  setG1StartupDelay,
  type ChallengeId,
  type BatteryView,
  type G1Failure,
  type G1View,
  type Prediction,
  type PredictionChoice,
  type Step,
} from "./deriveChallenge";

type Props = {
  challenge: ChallengeId;
  server: CurrentConfiguration;
  draft: SystemConfigV1;
  dirty: boolean;
  result: ComparisonResult | null;
  runStatus: ComparisonStatus;
  runBlockedReason: string | null;
  onChangeDraft: (update: (c: SystemConfigV1) => SystemConfigV1) => void;
  onOpenInspector: () => void;
  onDismiss: () => void;
};

const TITLE: Record<ChallengeId, string> = {
  "g1-startup": "G1 startup challenge",
  "battery-continuity": "Battery continuity challenge",
};

const STATUS_WORD = { done: "Done", current: "Current", todo: "To do" };

const buttonClass =
  "rounded-md border border-gp-line-strong px-2.5 py-1.5 text-xs font-medium text-gp-text hover:bg-gp-surface-2";

function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((step, index) => (
        <li
          key={step.id}
          aria-current={step.status === "current" ? "step" : undefined}
          className="flex gap-2 text-sm"
        >
          <span
            aria-hidden
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
              step.status === "done"
                ? "bg-gp-ok text-gp-bg"
                : step.status === "current"
                  ? "bg-gp-red text-white"
                  : "bg-gp-surface-2 text-gp-faint"
            }`}
          >
            {step.status === "done" ? "✓" : index + 1}
          </span>
          <span className="min-w-0">
            <span
              className={
                step.status === "todo" ? "text-gp-faint" : "text-gp-text"
              }
            >
              {step.label}
            </span>{" "}
            <span className="text-[11px] text-gp-faint">
              ({STATUS_WORD[step.status]})
            </span>
            {step.detail && (
              <span className="block text-xs text-gp-muted">{step.detail}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs text-gp-muted">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}

function G1Body({
  view,
  onChangeDraft,
  onOpenInspector,
}: {
  view: G1View;
  onChangeDraft: Props["onChangeDraft"];
  onOpenInspector: () => void;
}) {
  return (
    <>
      <StepList steps={view.steps} />
      <Notes notes={view.notes} />
      <div className="mt-3 flex flex-wrap gap-2">
        {view.showSlowPreset && (
          <button
            type="button"
            className={buttonClass}
            onClick={() =>
              onChangeDraft(setG1StartupDelay(G1_LONG_DELAY_PRESET_S))
            }
          >
            Set G1 startup delay to {G1_LONG_DELAY_PRESET_S} s in my draft
          </button>
        )}
        <button type="button" className={buttonClass} onClick={onOpenInspector}>
          Open Inspector
        </button>
      </div>
      {view.showSlowPreset && (
        <p className="mt-1 text-[11px] text-gp-faint">
          The preset changes only G1&apos;s startup delay in your unsaved draft.
          Nothing is saved until you save.
        </p>
      )}
      <div className="mt-3 border-t border-gp-line pt-2">
        <p className="text-xs font-semibold text-gp-text">
          Optional repair{" "}
          <span className="font-normal text-gp-faint">
            ({STATUS_WORD[view.repair.status]})
          </span>
        </p>
        <p className="mt-1 text-xs text-gp-muted">
          {view.repair.detail ??
            `After you have seen the failure, save a G1 startup delay of ${G1_READY_LIMIT_S} s or less and run the test again.`}
        </p>
        {view.showRepairPreset && (
          <button
            type="button"
            className={`${buttonClass} mt-2`}
            onClick={() => onChangeDraft(setG1StartupDelay(G1_READY_LIMIT_S))}
          >
            Set G1 startup delay to {G1_READY_LIMIT_S} s in my draft
          </button>
        )}
      </div>
    </>
  );
}

const CHOICES: Array<[PredictionChoice, string]> = [
  ["served", "The critical load stays fully served the whole time"],
  ["unserved", "Some demand goes unserved before G1 takes over"],
  ["unsure", "Not sure"],
];

function BatteryBody({
  view,
  server,
  draft,
  result,
  runStatus,
  prediction,
  onPredict,
  onResetPrediction,
  onChangeDraft,
  onOpenInspector,
}: {
  view: BatteryView;
  server: CurrentConfiguration;
  draft: SystemConfigV1;
  result: ComparisonResult | null;
  runStatus: ComparisonStatus;
  prediction: Prediction | null;
  onPredict: (choice: PredictionChoice) => void;
  onResetPrediction: () => void;
  onChangeDraft: Props["onChangeDraft"];
  onOpenInspector: () => void;
}) {
  const [choice, setChoice] = useState<PredictionChoice | null>(null);
  const groupId = useId();
  const selected =
    choice ?? (view.predictionActive ? prediction?.choice : null) ?? null;
  const locked = view.predictionActive && prediction !== null;
  void result;
  return (
    <>
      <StepList steps={view.steps} />
      <Notes notes={view.notes} />
      <ul
        aria-label="Prerequisites"
        className="mt-2 space-y-0.5 text-xs text-gp-muted"
      >
        {view.prerequisites.map((p) => (
          <li key={p.label}>
            <span aria-hidden>{p.met ? "✓" : "○"}</span>{" "}
            <span className="sr-only">{p.met ? "Met: " : "Not met: "}</span>
            {p.label}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {view.showLoadPreset && (
          <button
            type="button"
            className={buttonClass}
            onClick={() =>
              onChangeDraft(setCriticalLoad(BATTERY_LOAD_PRESET_KW))
            }
          >
            Set critical load to {BATTERY_LOAD_PRESET_KW} kW in my draft
          </button>
        )}
        <button type="button" className={buttonClass} onClick={onOpenInspector}>
          Open Inspector
        </button>
      </div>
      {view.showLoadPreset && (
        <p className="mt-1 text-[11px] text-gp-faint">
          The preset changes only the critical load in your unsaved draft (now{" "}
          {draft.equipment.load.critical_kw} kW). It does not change G1.
        </p>
      )}

      {(view.canPredict || locked) && (
        <fieldset
          disabled={runStatus === "running"}
          className="mt-3 border-t border-gp-line pt-2"
        >
          <legend className="text-xs font-semibold text-gp-text">
            Prediction for saved v{server.latest_version}: what will the
            continuity requirement show?
          </legend>
          {CHOICES.map(([value, label]) => (
            <label
              key={value}
              className="mt-1.5 flex items-start gap-2 text-sm text-gp-muted"
            >
              <input
                type="radio"
                name={groupId}
                checked={selected === value}
                onChange={() => setChoice(value)}
                className="mt-1"
              />
              {label}
            </label>
          ))}
          <button
            type="button"
            className={`${buttonClass} mt-2 disabled:cursor-not-allowed disabled:opacity-50`}
            disabled={selected === null}
            onClick={() => {
              if (selected) onPredict(selected);
            }}
          >
            {locked ? "Update prediction" : "Lock in prediction"}
          </button>
          {locked && prediction && (
            <p className="mt-1 text-xs text-gp-muted">
              Prediction locked for v{prediction.version}. Now run the test.
            </p>
          )}
        </fieldset>
      )}

      {view.reveal && (
        <div
          className="mt-3 border-t border-gp-line pt-2"
          role="region"
          aria-label="Result and explanation"
        >
          <p className="text-xs font-semibold text-gp-text">
            Evidence for v{view.reveal.version}:{" "}
            {view.reveal.verdict === "pass"
              ? "continuity requirement passed"
              : view.reveal.verdict === "fail"
                ? "continuity requirement failed"
                : "continuity requirement not reported"}
          </p>
          <p className="mt-1 text-xs text-gp-muted">
            {view.reveal.match === "matched" && "Your prediction matched. "}
            {view.reveal.match === "did_not_match" &&
              "Your prediction did not match. "}
            {view.reveal.match === "no_prediction" &&
              "You were not sure beforehand. "}
            {view.reveal.explanation}
          </p>
          <ul className="mt-2 space-y-1 text-xs text-gp-muted">
            {view.reveal.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-gp-faint">
            Model scope: the battery picks up the load with no gap and G1 takes
            over after its startup delay (assumptions A3 to A7 in the test
            results). Synthetic values, not equipment data.
          </p>
          <button
            type="button"
            className={`${buttonClass} mt-2`}
            onClick={() => {
              setChoice(null);
              onResetPrediction();
            }}
          >
            Try another prediction
          </button>
        </div>
      )}
    </>
  );
}

export default function ChallengePanel(props: Props) {
  const { challenge, server, draft, dirty, result, runStatus } = props;
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  // Remember an observed G1 failure: after a repair the saved version no longer
  // fails, but the visitor did see it. State is adjusted during render, guarded.
  const [remembered, setRemembered] = useState<G1Failure | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);

  const observed =
    challenge === "g1-startup" ? observeG1Failure(server, result) : null;
  if (
    observed &&
    (remembered === null ||
      remembered.configurationId !== observed.configurationId ||
      remembered.version !== observed.version)
  ) {
    setRemembered(observed);
  }

  const common = {
    server,
    draft,
    dirty,
    result,
    runBlockedReason: props.runBlockedReason,
  };
  const g1 =
    challenge === "g1-startup" ? deriveG1({ ...common, remembered }) : null;
  const battery =
    challenge === "battery-continuity"
      ? deriveBattery({ ...common, runStatus, prediction })
      : null;
  const steps = (g1 ?? battery)!.steps;
  const index = steps.findIndex((s) => s.status === "current");
  const summary =
    index === -1
      ? g1?.repair.status === "done"
        ? "complete, repaired"
        : "all steps complete"
      : `step ${index + 1} of ${steps.length}: ${steps[index].label}`;

  return (
    <section
      aria-label={TITLE[challenge]}
      className="mb-3 rounded-lg border border-gp-line-strong bg-gp-bg/60"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span aria-hidden className="text-gp-red">
            {open ? "▾" : "▸"}
          </span>
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold tracking-widest text-gp-red uppercase">
              Challenge
            </span>
            <span className="block text-sm font-medium text-gp-text">
              {TITLE[challenge]} · {summary}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={props.onDismiss}
          className="rounded px-2 py-1 text-xs text-gp-muted hover:bg-gp-surface-2 hover:text-gp-text"
        >
          Dismiss
        </button>
      </div>
      <p role="status" className="sr-only">
        {TITLE[challenge]}: {summary}
      </p>
      <div id={bodyId} hidden={!open} className="px-3 pb-3">
        {g1 && (
          <G1Body
            view={g1}
            onChangeDraft={props.onChangeDraft}
            onOpenInspector={props.onOpenInspector}
          />
        )}
        {battery && (
          <BatteryBody
            view={battery}
            server={server}
            draft={draft}
            result={result}
            runStatus={runStatus}
            prediction={prediction}
            onPredict={(choice) =>
              setPrediction(makePrediction(server, result, choice))
            }
            onResetPrediction={() => setPrediction(null)}
            onChangeDraft={props.onChangeDraft}
            onOpenInspector={props.onOpenInspector}
          />
        )}
        <p className="mt-3 text-[11px] leading-snug text-gp-faint">
          Uses your real workspace and the deterministic startup check. Progress
          is read from your saved versions and live results. Synthetic,
          simplified model; not affiliated with Cummins Inc.
        </p>
      </div>
    </section>
  );
}
