"use client";

import Image from "next/image";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { EnginePlanRequest } from "@/lib/types";
import {
  useEngineTestPlan,
  type EnginePlanSnapshot,
} from "@/lib/useEngineTestPlan";
import { EXPLANATIONS } from "./explanations";
import Results from "./Results";

type ReqRow = EnginePlanSnapshot["requirements"][number];
type PointRow = EnginePlanSnapshot["points"][number];
type Errors = Record<string, string>;
type Focus =
  | { kind: "req-label"; key: number }
  | { kind: "point-label"; key: number }
  | { kind: "add-req" }
  | { kind: "add-point" }
  | { kind: "move"; key: number; dir: "up" | "down" }
  | null;

// Invented for illustration. These are not engine data or Cummins values.
const SAMPLE_OBJECTIVE = "Synthetic mid-speed coverage check";
const SAMPLE_REQUIREMENTS: Array<Omit<ReqRow, "key">> = [
  {
    label: "Low-speed region",
    rpmMin: "800",
    rpmMax: "1200",
    torqueMin: "400",
    torqueMax: "600",
    power: "",
    minPoints: "1",
    minDwell: "10",
  },
  {
    label: "Mid-speed region",
    rpmMin: "1400",
    rpmMax: "1600",
    torqueMin: "900",
    torqueMax: "1100",
    power: "150",
    minPoints: "1",
    minDwell: "0",
  },
  {
    label: "Rated-speed region",
    rpmMin: "1750",
    rpmMax: "1850",
    torqueMin: "700",
    torqueMax: "900",
    power: "",
    minPoints: "2",
    minDwell: "20",
  },
  {
    label: "High-torque region",
    rpmMin: "1100",
    rpmMax: "1300",
    torqueMin: "1350",
    torqueMax: "1500",
    power: "",
    minPoints: "1",
    minDwell: "0",
  },
];
const SAMPLE_POINTS: Array<Omit<PointRow, "key">> = [
  { label: "Point A", rpm: "1000", torque: "500", dwell: "10" },
  { label: "Point B", rpm: "1500", torque: "1000", dwell: "20" },
  { label: "Point C", rpm: "1800", torque: "800", dwell: "15" },
  { label: "Point D", rpm: "1200", torque: "1300", dwell: "15" },
];
// Only used to disable the Add buttons; the server enforces the real limits.
const MAX_REQUIREMENTS = 10;
const MAX_POINTS = 12;

function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function TextInput({
  label,
  prefix,
  value,
  error,
  className,
  inputMode,
  dataAttr,
  hint,
  onChange,
}: {
  label: string;
  prefix: string;
  value: string;
  error?: string;
  className?: string;
  inputMode?: "decimal" | "text" | "numeric";
  dataAttr?: Record<string, number>;
  hint?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="text-[11px] text-gp-faint">
        <span className="sr-only">{prefix} </span>
        {label}
      </label>
      <input
        id={id}
        {...dataAttr}
        inputMode={inputMode}
        autoComplete="off"
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={
          [hint ? `${id}-hint` : null, error ? `${id}-err` : null]
            .filter(Boolean)
            .join(" ") || undefined
        }
        onChange={(event) => onChange(event.target.value)}
        className={`mt-0.5 min-h-11 w-full rounded-md border bg-gp-bg px-2 py-1.5 text-sm text-gp-text ${
          inputMode === "decimal" || inputMode === "numeric"
            ? "text-right font-mono"
            : ""
        } ${error ? "border-gp-error" : "border-gp-line-strong"}`}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-[10px] text-gp-faint">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={`${id}-err`}
          role="alert"
          className="mt-0.5 text-xs text-gp-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function Callout({
  testId,
  tone,
  title,
  children,
}: {
  testId: string;
  tone: "warn" | "info";
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className={`rounded-lg border px-3 py-2 text-xs leading-snug ${
        tone === "warn"
          ? "border-gp-warn/40 bg-gp-warn/10 text-gp-muted"
          : "border-gp-line-strong bg-gp-surface-2 text-gp-muted"
      }`}
    >
      <p className="font-semibold text-gp-text">{title}</p>
      <p className="mt-0.5">{children}</p>
    </div>
  );
}

const sampleReqs = (): ReqRow[] =>
  SAMPLE_REQUIREMENTS.map((row, key) => ({ key, ...row }));
const samplePoints = (): PointRow[] =>
  SAMPLE_POINTS.map((row, key) => ({ key, ...row }));

const sameReq = (a: ReqRow, b: ReqRow) =>
  a.key === b.key &&
  a.label === b.label &&
  a.rpmMin === b.rpmMin &&
  a.rpmMax === b.rpmMax &&
  a.torqueMin === b.torqueMin &&
  a.torqueMax === b.torqueMax &&
  a.power === b.power &&
  a.minPoints === b.minPoints &&
  a.minDwell === b.minDwell;
const samePoint = (a: PointRow, b: PointRow) =>
  a.key === b.key &&
  a.label === b.label &&
  a.rpm === b.rpm &&
  a.torque === b.torque &&
  a.dwell === b.dwell;
const sameList = <T,>(a: T[], b: T[], same: (x: T, y: T) => boolean) =>
  a.length === b.length && a.every((row, i) => same(row, b[i]));

export default function TestPlanWorkbench({ onBack }: { onBack: () => void }) {
  const nextKey = useRef(SAMPLE_REQUIREMENTS.length + SAMPLE_POINTS.length);
  const [objective, setObjective] = useState(SAMPLE_OBJECTIVE);
  const [reqs, setReqs] = useState<ReqRow[]>(sampleReqs);
  const [points, setPoints] = useState<PointRow[]>(samplePoints);
  const [ranWith, setRanWith] = useState<EnginePlanSnapshot | null>(null);
  const [localErrors, setLocalErrors] = useState<Errors>({});
  const [focus, setFocus] = useState<Focus>(null);
  const [moved, setMoved] = useState("");
  const addReqRef = useRef<HTMLButtonElement>(null);
  const addPointRef = useRef<HTMLButtonElement>(null);
  const { status, result, resultSnapshot, error, run } = useEngineTestPlan();

  // Move keyboard focus after a row is added, removed or moved so it is never lost.
  useEffect(() => {
    if (!focus) return;
    if (focus.kind === "add-req") addReqRef.current?.focus();
    else if (focus.kind === "add-point") addPointRef.current?.focus();
    else if (focus.kind === "move") {
      const first = document.querySelector<HTMLButtonElement>(
        `[data-move="${focus.key}-${focus.dir}"]:not(:disabled)`,
      );
      (
        first ??
        document.querySelector<HTMLButtonElement>(
          `[data-move="${focus.key}-${focus.dir === "up" ? "down" : "up"}"]:not(:disabled)`,
        )
      )?.focus();
    } else {
      const attr =
        focus.kind === "req-label" ? "data-req-label" : "data-point-label";
      document
        .querySelector<HTMLInputElement>(`[${attr}="${focus.key}"]`)
        ?.focus();
    }
    setFocus(null);
  }, [focus, reqs, points]);

  const stale =
    result !== null &&
    resultSnapshot !== undefined &&
    (resultSnapshot.objective !== objective ||
      !sameList(resultSnapshot.requirements, reqs, sameReq) ||
      !sameList(resultSnapshot.points, points, samePoint));

  const clearLocal = (path: string) =>
    setLocalErrors((current) => {
      if (!(path in current)) return current;
      const { [path]: _removed, ...rest } = current;
      void _removed;
      return rest;
    });

  const editReq = (key: number, field: keyof ReqRow, value: string) => {
    const index = reqs.findIndex((r) => r.key === key);
    for (const path of Object.keys(localErrors))
      if (path.startsWith(`requirements.${index}.`)) clearLocal(path);
    setReqs((current) =>
      current.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
  };
  const editPoint = (key: number, field: keyof PointRow, value: string) => {
    const index = points.findIndex((p) => p.key === key);
    for (const path of Object.keys(localErrors))
      if (path.startsWith(`points.${index}.`)) clearLocal(path);
    setPoints((current) =>
      current.map((p) => (p.key === key ? { ...p, [field]: value } : p)),
    );
  };

  const addReq = () => {
    if (reqs.length >= MAX_REQUIREMENTS) return;
    const key = nextKey.current++;
    setReqs((current) => [
      ...current,
      {
        key,
        label: "",
        rpmMin: "",
        rpmMax: "",
        torqueMin: "",
        torqueMax: "",
        power: "",
        minPoints: "1",
        minDwell: "0",
      },
    ]);
    setLocalErrors({});
    setFocus({ kind: "req-label", key });
  };
  const addPoint = () => {
    if (points.length >= MAX_POINTS) return;
    const key = nextKey.current++;
    setPoints((current) => [
      ...current,
      { key, label: "", rpm: "", torque: "", dwell: "10" },
    ]);
    setLocalErrors({});
    setFocus({ kind: "point-label", key });
  };

  const removeReq = (key: number) => {
    if (reqs.length <= 1) return;
    const index = reqs.findIndex((r) => r.key === key);
    const neighbour = reqs[index + 1] ?? reqs[index - 1];
    setReqs((current) => current.filter((r) => r.key !== key));
    setLocalErrors({});
    setFocus(
      neighbour
        ? { kind: "req-label", key: neighbour.key }
        : { kind: "add-req" },
    );
  };
  const removePoint = (key: number) => {
    if (points.length <= 1) return;
    const index = points.findIndex((p) => p.key === key);
    const neighbour = points[index + 1] ?? points[index - 1];
    setPoints((current) => current.filter((p) => p.key !== key));
    setLocalErrors({});
    setFocus(
      neighbour
        ? { kind: "point-label", key: neighbour.key }
        : { kind: "add-point" },
    );
  };

  const movePoint = (key: number, dir: "up" | "down") => {
    const index = points.findIndex((p) => p.key === key);
    const target = dir === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= points.length) return;
    const next = points.slice();
    [next[index], next[target]] = [next[target], next[index]];
    setPoints(next);
    setLocalErrors({});
    setMoved(
      `${points[index].label.trim() || `Point ${index + 1}`} moved to position ${target + 1} of ${points.length}.`,
    );
    setFocus({ kind: "move", key, dir });
  };

  const resetSample = () => {
    nextKey.current = SAMPLE_REQUIREMENTS.length + SAMPLE_POINTS.length;
    setObjective(SAMPLE_OBJECTIVE);
    setReqs(sampleReqs());
    setPoints(samplePoints());
    setLocalErrors({});
    setMoved("");
  };

  // A server error applies only while what it refers to still holds what was submitted.
  const serverError = (path: string): string | undefined => {
    const message = error?.fieldErrors[path];
    if (!message || !ranWith) return undefined;
    if (path === "objective")
      return ranWith.objective === objective ? message : undefined;
    if (path === "requirements")
      return sameList(ranWith.requirements, reqs, sameReq)
        ? message
        : undefined;
    if (path === "points")
      return sameList(ranWith.points, points, samePoint) ? message : undefined;
    const match = /^(requirements|points)\.(\d+)\.\w+$/.exec(path);
    if (!match) return undefined;
    const index = Number(match[2]);
    if (match[1] === "requirements") {
      const then = ranWith.requirements[index];
      const now = reqs[index];
      return then && now && sameReq(then, now) ? message : undefined;
    }
    const then = ranWith.points[index];
    const now = points[index];
    return then && now && samePoint(then, now) ? message : undefined;
  };
  const errorFor = (path: string) => localErrors[path] ?? serverError(path);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const errors: Errors = {};
    const num = (path: string, text: string): number | null => {
      const value = parseNumber(text);
      if (value === null) errors[path] = "Enter a number.";
      return value;
    };

    const requirements: EnginePlanRequest["requirements"] = [];
    reqs.forEach((row, i) => {
      const base = `requirements.${i}`;
      const rpmMin = num(`${base}.rpm_min`, row.rpmMin);
      const rpmMax = num(`${base}.rpm_max`, row.rpmMax);
      const torqueMin = num(`${base}.torque_min_nm`, row.torqueMin);
      const torqueMax = num(`${base}.torque_max_nm`, row.torqueMax);
      const minPoints = num(`${base}.min_points`, row.minPoints);
      const minDwell = num(`${base}.min_dwell_min`, row.minDwell);
      let power: number | null = null;
      if (row.power.trim() !== "")
        power = num(`${base}.power_min_kw`, row.power);
      if (
        rpmMin !== null &&
        rpmMax !== null &&
        torqueMin !== null &&
        torqueMax !== null &&
        minPoints !== null &&
        minDwell !== null &&
        !(`${base}.power_min_kw` in errors)
      )
        requirements.push({
          label: row.label,
          rpm_min: rpmMin,
          rpm_max: rpmMax,
          torque_min_nm: torqueMin,
          torque_max_nm: torqueMax,
          power_min_kw: power,
          min_points: minPoints,
          min_dwell_min: minDwell,
        });
    });

    const list: EnginePlanRequest["points"] = [];
    points.forEach((row, i) => {
      const base = `points.${i}`;
      const rpm = num(`${base}.rpm`, row.rpm);
      const torque = num(`${base}.torque_nm`, row.torque);
      const dwell = num(`${base}.dwell_min`, row.dwell);
      if (rpm !== null && torque !== null && dwell !== null)
        list.push({
          label: row.label,
          rpm,
          torque_nm: torque,
          dwell_min: dwell,
        });
    });

    setLocalErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const snapshot: EnginePlanSnapshot = {
      objective,
      requirements: reqs.map((r) => ({ ...r })),
      points: points.map((p) => ({ ...p })),
    };
    setRanWith(snapshot);
    void run({ objective, requirements, points: list }, snapshot);
  };

  const running = status === "running";
  const requirementsError = errorFor("requirements");
  const pointsError = errorFor("points");

  return (
    <div className="gp-lab-in mx-auto max-w-[1280px]">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 rounded-md border border-gp-line-strong px-3 py-1.5 text-sm text-gp-muted hover:bg-gp-surface hover:text-gp-text"
        >
          ← Map
        </button>
        <div className="mr-auto">
          <h1 className="text-lg leading-tight font-semibold text-gp-text">
            Engine Test-Plan Workbench
          </h1>
          <p className="text-xs text-gp-faint">
            Synthetic exercise · you supply the numbers · independent of Cummins
            Inc.
          </p>
        </div>
        <span className="rounded border border-gp-red/50 bg-gp-red/10 px-2 py-1 text-[11px] font-semibold tracking-widest text-gp-red-text uppercase">
          Synthetic
        </span>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)]">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-gp-line bg-gp-bg">
            <Image
              src="/illustrations/seymour-test-plan.svg"
              alt="Diagram of rectangular requirement regions on a speed and torque grid with four numbered planned points joined in order."
              width={780}
              height={262}
              unoptimized
              className="mx-auto h-auto max-h-48 w-full object-contain"
            />
          </div>

          <Callout
            testId="scope-note"
            tone="warn"
            title="Planning coverage is not verification"
          >
            This checks whether your planned speed and torque points cover the
            requirements you define. A matching point does not show that any
            engine can operate there, and GridProof holds no measurements,
            engine limits, fuel, efficiency or emissions data. It never reports
            a performance result.
          </Callout>

          <form
            onSubmit={submit}
            noValidate
            aria-label="Test plan"
            className="space-y-5 rounded-xl border border-gp-line bg-gp-surface p-4"
          >
            <div>
              <h2 className="text-sm font-semibold tracking-wider text-gp-text uppercase">
                Test plan
              </h2>
              <p className="mt-1 text-xs text-gp-muted">
                State an objective, define the regions of speed and torque the
                plan must cover, then list the operating points in the order you
                would run them. The server validates every value and does the
                calculation; nothing is saved.
              </p>
              <p
                data-testid="sample-note"
                className="mt-1 text-[11px] text-gp-warn"
              >
                The starting values are invented for illustration. They are not
                engine data or Cummins values. Replace them with your own.
              </p>
            </div>

            <TextInput
              prefix=""
              label="Objective"
              inputMode="text"
              value={objective}
              error={errorFor("objective")}
              onChange={(v) => {
                clearLocal("objective");
                setObjective(v);
              }}
            />

            <section aria-label="Requirements" className="space-y-2">
              <h3 className="text-sm font-semibold text-gp-text">
                Requirements
              </h3>
              <p className="text-[11px] leading-snug text-gp-muted">
                Each requirement is a speed range and a torque range (bounds
                included), with an optional minimum theoretical power. A minimum
                of planned entries counts entries in your plan, so a repeated
                speed and torque counts more than once without adding a new
                condition.
              </p>
              <ul className="space-y-2" aria-label="Requirement list">
                {reqs.map((row, i) => {
                  const p = `requirements.${i}`;
                  const prefix = `Requirement ${i + 1}`;
                  return (
                    <li key={row.key}>
                      <div
                        role="group"
                        aria-label={prefix}
                        className="grid grid-cols-2 gap-2 rounded-lg border border-gp-line bg-gp-bg/40 p-2.5 sm:grid-cols-4"
                      >
                        <TextInput
                          className="col-span-2 sm:col-span-4"
                          prefix={prefix}
                          label="Label"
                          inputMode="text"
                          dataAttr={{ "data-req-label": row.key }}
                          value={row.label}
                          error={errorFor(`${p}.label`)}
                          onChange={(v) => editReq(row.key, "label", v)}
                        />
                        <TextInput
                          prefix={prefix}
                          label="Speed min (rpm)"
                          inputMode="numeric"
                          value={row.rpmMin}
                          error={errorFor(`${p}.rpm_min`)}
                          onChange={(v) => editReq(row.key, "rpmMin", v)}
                        />
                        <TextInput
                          prefix={prefix}
                          label="Speed max (rpm)"
                          inputMode="numeric"
                          value={row.rpmMax}
                          error={errorFor(`${p}.rpm_max`)}
                          onChange={(v) => editReq(row.key, "rpmMax", v)}
                        />
                        <TextInput
                          prefix={prefix}
                          label="Torque min (N·m)"
                          inputMode="decimal"
                          value={row.torqueMin}
                          error={errorFor(`${p}.torque_min_nm`)}
                          onChange={(v) => editReq(row.key, "torqueMin", v)}
                        />
                        <TextInput
                          prefix={prefix}
                          label="Torque max (N·m)"
                          inputMode="decimal"
                          value={row.torqueMax}
                          error={errorFor(`${p}.torque_max_nm`)}
                          onChange={(v) => editReq(row.key, "torqueMax", v)}
                        />
                        <TextInput
                          prefix={prefix}
                          label="Min power (kW, optional)"
                          inputMode="decimal"
                          value={row.power}
                          error={errorFor(`${p}.power_min_kw`)}
                          onChange={(v) => editReq(row.key, "power", v)}
                        />
                        <TextInput
                          prefix={prefix}
                          label="Min planned entries"
                          inputMode="numeric"
                          value={row.minPoints}
                          error={errorFor(`${p}.min_points`)}
                          onChange={(v) => editReq(row.key, "minPoints", v)}
                        />
                        <TextInput
                          prefix={prefix}
                          label="Min planned hold (min)"
                          inputMode="numeric"
                          value={row.minDwell}
                          error={errorFor(`${p}.min_dwell_min`)}
                          onChange={(v) => editReq(row.key, "minDwell", v)}
                        />
                        <button
                          type="button"
                          onClick={() => removeReq(row.key)}
                          disabled={reqs.length <= 1}
                          aria-label={`Remove requirement ${i + 1}`}
                          className="col-span-2 min-h-11 self-end rounded-md border border-gp-line-strong px-2.5 py-1.5 text-xs text-gp-muted enabled:hover:bg-gp-surface-2 enabled:hover:text-gp-text disabled:opacity-40 sm:col-span-1"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {requirementsError && (
                <p role="alert" className="text-xs text-gp-error">
                  {requirementsError}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  ref={addReqRef}
                  type="button"
                  onClick={addReq}
                  disabled={reqs.length >= MAX_REQUIREMENTS}
                  className="min-h-11 rounded-md border border-gp-line-strong px-3 py-1.5 text-sm text-gp-text enabled:hover:bg-gp-surface-2 disabled:opacity-40"
                >
                  Add requirement
                </button>
                <span className="text-[11px] text-gp-faint">
                  {reqs.length} of {MAX_REQUIREMENTS} requirements
                </span>
              </div>
            </section>

            <section aria-label="Operating points" className="space-y-2">
              <h3 className="text-sm font-semibold text-gp-text">
                Operating points, in planned order
              </h3>
              <p className="text-[11px] leading-snug text-gp-muted">
                Speed and torque you plan to hold, and for how long. The order
                sets the planned hold timeline and the step between points; it
                does not change coverage. A hold is planned time, not measured
                stable operation. Repeating a speed and torque is allowed.
              </p>
              <ol className="space-y-2" aria-label="Operating point list">
                {points.map((row, i) => {
                  const p = `points.${i}`;
                  const prefix = `Point ${i + 1}`;
                  return (
                    <li key={row.key}>
                      <div
                        role="group"
                        aria-label={prefix}
                        className="grid grid-cols-3 gap-2 rounded-lg border border-gp-line bg-gp-bg/40 p-2.5 sm:grid-cols-[minmax(0,1fr)_5.5rem_6rem_5rem] sm:items-start"
                      >
                        <TextInput
                          className="col-span-3 sm:col-span-1"
                          prefix={prefix}
                          label="Label"
                          inputMode="text"
                          dataAttr={{ "data-point-label": row.key }}
                          value={row.label}
                          error={errorFor(`${p}.label`)}
                          onChange={(v) => editPoint(row.key, "label", v)}
                        />
                        <TextInput
                          prefix={prefix}
                          label="Speed (rpm)"
                          inputMode="numeric"
                          value={row.rpm}
                          error={errorFor(`${p}.rpm`)}
                          onChange={(v) => editPoint(row.key, "rpm", v)}
                        />
                        <TextInput
                          prefix={prefix}
                          label="Torque (N·m)"
                          inputMode="decimal"
                          value={row.torque}
                          error={errorFor(`${p}.torque_nm`)}
                          onChange={(v) => editPoint(row.key, "torque", v)}
                        />
                        <TextInput
                          prefix={prefix}
                          label="Hold (min)"
                          inputMode="numeric"
                          value={row.dwell}
                          error={errorFor(`${p}.dwell_min`)}
                          onChange={(v) => editPoint(row.key, "dwell", v)}
                        />
                        <div className="col-span-3 flex flex-wrap gap-2 sm:col-span-4">
                          <button
                            type="button"
                            data-move={`${row.key}-up`}
                            onClick={() => movePoint(row.key, "up")}
                            disabled={i === 0}
                            className="min-h-11 rounded-md border border-gp-line-strong px-2.5 py-1.5 text-xs text-gp-muted enabled:hover:bg-gp-surface-2 enabled:hover:text-gp-text disabled:opacity-40"
                          >
                            <span aria-hidden>↑</span> Move up{" "}
                            <span className="sr-only">point {i + 1}</span>
                          </button>
                          <button
                            type="button"
                            data-move={`${row.key}-down`}
                            onClick={() => movePoint(row.key, "down")}
                            disabled={i === points.length - 1}
                            className="min-h-11 rounded-md border border-gp-line-strong px-2.5 py-1.5 text-xs text-gp-muted enabled:hover:bg-gp-surface-2 enabled:hover:text-gp-text disabled:opacity-40"
                          >
                            <span aria-hidden>↓</span> Move down{" "}
                            <span className="sr-only">point {i + 1}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removePoint(row.key)}
                            disabled={points.length <= 1}
                            aria-label={`Remove point ${i + 1}`}
                            className="min-h-11 rounded-md border border-gp-line-strong px-2.5 py-1.5 text-xs text-gp-muted enabled:hover:bg-gp-surface-2 enabled:hover:text-gp-text disabled:opacity-40"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <p role="status" className="sr-only">
                {moved}
              </p>
              {pointsError && (
                <p role="alert" className="text-xs text-gp-error">
                  {pointsError}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  ref={addPointRef}
                  type="button"
                  onClick={addPoint}
                  disabled={points.length >= MAX_POINTS}
                  className="min-h-11 rounded-md border border-gp-line-strong px-3 py-1.5 text-sm text-gp-text enabled:hover:bg-gp-surface-2 disabled:opacity-40"
                >
                  Add point
                </button>
                <button
                  type="button"
                  onClick={resetSample}
                  className="min-h-11 rounded-md border border-gp-line px-3 py-1.5 text-sm text-gp-muted hover:bg-gp-surface-2 hover:text-gp-text"
                >
                  Reset to sample
                </button>
                <span className="text-[11px] text-gp-faint">
                  {points.length} of {MAX_POINTS} points
                </span>
              </div>
            </section>

            <button
              type="submit"
              disabled={running}
              className="min-h-11 w-full rounded-md bg-gp-red px-3 py-2.5 text-sm font-semibold text-white shadow-lg shadow-gp-red/20 transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-gp-line-strong disabled:text-gp-faint disabled:shadow-none"
            >
              {running ? "Checking…" : "Check plan coverage"}
            </button>
          </form>
        </div>

        <section aria-label="Plan coverage results" className="space-y-3">
          <p role="status" className="sr-only">
            {running
              ? "Checking plan coverage."
              : status === "done" && result
                ? `Plan coverage checked. ${result.summary.covered_by_plan} of ${result.summary.requirements_total} requirements covered by plan, ${result.summary.partly_covered} partly covered, ${result.summary.not_covered} not covered. Planned coverage only; not verified.`
                : ""}
          </p>

          {status === "idle" && !result && (
            <div className="rounded-xl border border-dashed border-gp-line-strong p-6 text-sm text-gp-muted">
              No result yet. Check the plan to see which requirements your
              planned points cover, which they leave uncovered, and what
              evidence would still be needed.
            </div>
          )}

          {status === "error" && error && (
            <div
              role="alert"
              className="rounded-lg border border-gp-error/40 bg-gp-error/10 p-4 text-sm"
            >
              <p className="font-medium text-gp-error">
                {error.kind === "validation"
                  ? "Check the highlighted inputs"
                  : "The check could not run"}
              </p>
              <p className="mt-1 text-gp-muted">{error.message}</p>
              {error.kind !== "validation" && (
                <button
                  type="button"
                  onClick={() => submit()}
                  className="mt-3 min-h-11 rounded border border-gp-line-strong px-3 py-1.5 hover:bg-gp-surface"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {result && (
            <div className={stale ? "opacity-60" : undefined}>
              {stale && (
                <p
                  role="status"
                  data-testid="stale-notice"
                  className="mb-2 rounded border border-gp-warn/40 bg-gp-warn/10 px-3 py-1.5 text-xs text-gp-warn"
                >
                  The plan changed after this result. Check coverage again.
                </p>
              )}
              <Results
                key={result.points.map((p) => p.id).join() + result.explanation}
                result={result}
              />
            </div>
          )}

          <section
            aria-label="How the checks work"
            data-testid="explanations"
            className="rounded-xl border border-gp-line bg-gp-surface p-3"
          >
            <h2 className="text-sm font-semibold tracking-wider text-gp-text uppercase">
              How the checks work
            </h2>
            <p className="text-[11px] text-gp-faint">
              What each result is for, and what it cannot tell you.
            </p>
            <div className="mt-2 space-y-1.5">
              {EXPLANATIONS.map((e) => (
                <details
                  key={e.id}
                  data-explanation={e.id}
                  className="rounded-lg border border-gp-line px-2.5 py-1.5"
                >
                  <summary className="cursor-pointer text-sm font-medium text-gp-text">
                    {e.title}
                  </summary>
                  <p className="mt-1.5 text-xs leading-snug text-gp-muted">
                    <span className="font-semibold text-gp-text">
                      Purpose:{" "}
                    </span>
                    {e.purpose}
                  </p>
                  <p className="mt-1.5 text-xs leading-snug text-gp-muted">
                    <span className="font-semibold text-gp-text">Limits: </span>
                    {e.limits}
                  </p>
                </details>
              ))}
            </div>
          </section>

          <p className="text-[11px] leading-snug text-gp-faint">
            Synthetic exercise on the numbers you enter. It reports planning
            coverage only and is not a test procedure, an acceptance or
            verification result, or a prediction for any real engine. GridProof
            is independent and not affiliated with Cummins Inc., and this is not
            the Seymour site&apos;s software, procedures or data.
          </p>
        </section>
      </div>
    </div>
  );
}
