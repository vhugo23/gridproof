"use client";

import Image from "next/image";
import { useId, useRef, useState, type FormEvent } from "react";
import type { DutyCycleEvidence, DutyCycleRequest } from "@/lib/types";
import { useDutyCycle } from "@/lib/useDutyCycle";
import Field from "../workbench/Field";

type Row = { key: number; name: string; kw: string; min: string };
type RowField = "name" | "kw" | "min";
type Errors = Record<string, string>;

// Invented for illustration. These are not haul-truck or equipment data.
const SAMPLE_ROWS: Array<Omit<Row, "key">> = [
  { name: "Loading", kw: "120", min: "3" },
  { name: "Hauling", kw: "300", min: "12" },
  { name: "Dumping", kw: "90", min: "2" },
  { name: "Returning", kw: "60", min: "8" },
];
const SAMPLE_CYCLES = "18";
// Only used to disable the Add button; the server enforces the real limit.
const MAX_SEGMENTS = 12;

const API_FIELD: Record<RowField, string> = {
  name: "name",
  kw: "power_kw",
  min: "duration_min",
};

function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

// Display formatting only: every value comes from the backend response.
const fixed = (n: number) => n.toFixed(2);

// A golden-angle hue gives up to 12 distinguishable colours; names carry the identity.
const colorOf = (index: number) => `hsl(${(index * 137.5) % 360} 55% 58%)`;

function RowInput({
  label,
  prefix,
  value,
  error,
  className,
  inputMode,
  onChange,
}: {
  label: string;
  prefix: string;
  value: string;
  error?: string;
  className?: string;
  inputMode?: "decimal" | "text";
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
        inputMode={inputMode}
        autoComplete="off"
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-0.5 w-full rounded-md border bg-gp-bg px-2 py-1.5 text-sm text-gp-text ${
          inputMode === "decimal" ? "text-right font-mono" : ""
        } ${error ? "border-gp-error" : "border-gp-line-strong"}`}
      />
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

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-gp-faint">{label}</dt>
      <dd className="font-mono text-gp-text">{value}</dd>
    </div>
  );
}

function Breakdown({ result }: { result: DutyCycleEvidence }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dominant = new Set(result.dominant_segment_ids);
  const selected = result.segments.find((s) => s.id === selectedId) ?? null;
  const index = (id: string) => result.segments.findIndex((s) => s.id === id);

  return (
    <div className="rounded-xl border border-gp-line bg-gp-surface p-3">
      <h2 className="text-sm font-semibold tracking-wider text-gp-text uppercase">
        Energy by segment
      </h2>
      <p className="text-[11px] text-gp-faint">
        Share of the energy used in one cycle. Choose a segment for details.
      </p>
      <div
        aria-hidden
        data-testid="share-bar"
        className="mt-2 flex h-5 overflow-hidden rounded-full bg-gp-line"
      >
        {result.segments.map((s, i) => (
          <div
            key={s.id}
            data-slice={s.id}
            className="h-full flex-none transition-opacity"
            style={{
              width: `${s.share_of_cycle_energy_pct}%`,
              background: colorOf(i),
              opacity: selectedId && selectedId !== s.id ? 0.3 : 1,
            }}
          />
        ))}
      </div>
      <ul aria-label="Energy by segment" className="mt-2 space-y-1.5">
        {result.segments.map((s, i) => {
          const active = selectedId === s.id;
          return (
            <li key={s.id}>
              <button
                type="button"
                aria-pressed={active}
                data-segment={s.id}
                onClick={() => setSelectedId(active ? null : s.id)}
                className={`block w-full rounded-lg border px-2.5 py-2 text-left text-sm ${
                  active
                    ? "border-gp-red bg-gp-red/10"
                    : "border-gp-line hover:bg-gp-surface-2"
                }`}
              >
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: colorOf(i) }}
                  />
                  <span className="font-medium text-gp-text">{s.name}</span>
                  {dominant.has(s.id) && (
                    <span className="rounded bg-gp-red/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-gp-red-text uppercase ring-1 ring-gp-red/40">
                      Most energy
                    </span>
                  )}
                  <span className="ml-auto font-mono text-xs text-gp-text">
                    {fixed(s.energy_kwh)} kWh ·{" "}
                    {fixed(s.share_of_cycle_energy_pct)}%
                  </span>
                </span>
                <span
                  aria-hidden
                  className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-gp-line"
                >
                  <span
                    data-share={s.id}
                    className="block h-full rounded-full"
                    style={{
                      width: `${s.share_of_cycle_energy_pct}%`,
                      background: colorOf(i),
                    }}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-gp-muted">
        Shares are rounded to 2 decimals, so they can add up to slightly more or
        less than 100%.
      </p>

      {selected && (
        <section
          aria-label={`Details for ${selected.name}`}
          data-testid="segment-focus"
          className="mt-3 rounded-lg border border-gp-red/50 bg-gp-bg/40 p-3"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gp-text">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: colorOf(index(selected.id)) }}
            />
            {selected.name}
          </h3>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Tile label="Power" value={`${fixed(selected.power_kw)} kW`} />
            <Tile
              label="Duration"
              value={`${fixed(selected.duration_min)} min`}
            />
            <Tile
              label="Energy per cycle"
              value={`${fixed(selected.energy_kwh)} kWh`}
            />
            <Tile
              label="Share of cycle energy"
              value={`${fixed(selected.share_of_cycle_energy_pct)}%`}
            />
          </dl>
          {dominant.has(selected.id) && (
            <p className="mt-2 text-xs text-gp-muted">
              This segment has the most energy in the cycle.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

export default function DutyCycleWorkbench({ onBack }: { onBack: () => void }) {
  const nextKey = useRef(SAMPLE_ROWS.length);
  const [rows, setRows] = useState<Row[]>(() =>
    SAMPLE_ROWS.map((row, key) => ({ key, ...row })),
  );
  const [cycles, setCycles] = useState(SAMPLE_CYCLES);
  const [ranWith, setRanWith] = useState<{
    rows: Row[];
    cycles: string;
  } | null>(null);
  const [localErrors, setLocalErrors] = useState<Errors>({});
  const { status, result, resultSnapshot, error, run } = useDutyCycle();

  const stale =
    result !== null &&
    resultSnapshot !== undefined &&
    (resultSnapshot.cycles !== cycles ||
      resultSnapshot.rows.length !== rows.length ||
      resultSnapshot.rows.some(
        (r, i) =>
          r.key !== rows[i].key ||
          r.name !== rows[i].name ||
          r.kw !== rows[i].kw ||
          r.min !== rows[i].min,
      ));

  const clearLocal = (path: string) =>
    setLocalErrors((current) => {
      if (!(path in current)) return current;
      const { [path]: _removed, ...rest } = current;
      void _removed;
      return rest;
    });

  const editRow = (key: number, field: RowField, value: string) => {
    const index = rows.findIndex((r) => r.key === key);
    clearLocal(`segments.${index}.${API_FIELD[field]}`);
    setRows((current) =>
      current.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
  };

  const addRow = () => {
    if (rows.length >= MAX_SEGMENTS) return;
    setRows((current) => [
      ...current,
      { key: nextKey.current++, name: "", kw: "", min: "" },
    ]);
    setLocalErrors({});
  };

  const removeRow = (key: number) => {
    if (rows.length <= 1) return;
    setRows((current) => current.filter((r) => r.key !== key));
    setLocalErrors({});
  };

  const resetSample = () => {
    nextKey.current = SAMPLE_ROWS.length;
    setRows(SAMPLE_ROWS.map((row, key) => ({ key, ...row })));
    setCycles(SAMPLE_CYCLES);
    setLocalErrors({});
  };

  // A server error applies only while what it refers to still holds what was submitted.
  const serverError = (path: string): string | undefined => {
    const message = error?.fieldErrors[path];
    if (!message || !ranWith) return undefined;
    if (path === "segments")
      return ranWith.rows.length === rows.length ? message : undefined;
    if (path === "cycles_per_shift") {
      const same =
        ranWith.cycles === cycles &&
        ranWith.rows.length === rows.length &&
        ranWith.rows.every(
          (r, i) => r.key === rows[i].key && r.min === rows[i].min,
        );
      return same ? message : undefined;
    }
    const match = /^segments\.(\d+)\.(\w+)$/.exec(path);
    if (!match) return undefined;
    const index = Number(match[1]);
    const field = (Object.keys(API_FIELD) as RowField[]).find(
      (f) => API_FIELD[f] === match[2],
    );
    const then = ranWith.rows[index];
    const now = rows[index];
    if (!field || !then || !now) return undefined;
    return then.key === now.key && then[field] === now[field]
      ? message
      : undefined;
  };

  const errorFor = (path: string) => localErrors[path] ?? serverError(path);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const errors: Errors = {};
    const segments: DutyCycleRequest["segments"] = [];
    rows.forEach((row, i) => {
      const power = parseNumber(row.kw);
      const duration = parseNumber(row.min);
      if (power === null) errors[`segments.${i}.power_kw`] = "Enter a number.";
      if (duration === null)
        errors[`segments.${i}.duration_min`] = "Enter a number.";
      if (power !== null && duration !== null)
        segments.push({
          name: row.name,
          power_kw: power,
          duration_min: duration,
        });
    });
    const cycleCount = parseNumber(cycles);
    if (cycleCount === null) errors.cycles_per_shift = "Enter a number.";
    setLocalErrors(errors);
    if (Object.keys(errors).length > 0 || cycleCount === null) return;
    const snapshot = { rows: rows.map((r) => ({ ...r })), cycles };
    setRanWith(snapshot);
    void run({ segments, cycles_per_shift: cycleCount }, snapshot);
  };

  const running = status === "running";
  const listError = errorFor("segments");

  return (
    <div className="gp-lab-in mx-auto max-w-[1280px]">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-gp-line-strong px-3 py-1.5 text-sm text-gp-muted hover:bg-gp-surface hover:text-gp-text"
        >
          ← Map
        </button>
        <div className="mr-auto">
          <h1 className="text-lg leading-tight font-semibold text-gp-text">
            Mining Duty-Cycle Energy Analyzer
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
              src="/illustrations/mining-vehicles.svg"
              alt="Illustration of a large mining haul truck with a loaded ribbed dump body and oversized tires."
              width={360}
              height={225}
              unoptimized
              className="mx-auto h-auto max-h-48 w-auto"
            />
          </div>

          <form
            onSubmit={submit}
            noValidate
            aria-label="Duty cycle"
            className="space-y-4 rounded-xl border border-gp-line bg-gp-surface p-4"
          >
            <div>
              <h2 className="text-sm font-semibold tracking-wider text-gp-text uppercase">
                Duty cycle
              </h2>
              <p className="mt-1 text-xs text-gp-muted">
                Describe one cycle as segments of constant power and duration,
                then say how many identical cycles make a shift. The server
                validates every value and calculates the energy; nothing is
                saved.
              </p>
              <p
                data-testid="sample-note"
                className="mt-1 text-[11px] text-gp-warn"
              >
                The starting values are invented for illustration. They are not
                haul-truck or equipment data. Replace them with your own.
              </p>
            </div>

            <ul className="space-y-2" aria-label="Segments">
              {rows.map((row, i) => (
                <li key={row.key}>
                  <div
                    role="group"
                    aria-label={`Segment ${i + 1}`}
                    className="grid grid-cols-2 gap-2 rounded-lg border border-gp-line bg-gp-bg/40 p-2.5 sm:grid-cols-[minmax(0,1fr)_6rem_6rem_auto] sm:items-start"
                  >
                    <RowInput
                      className="col-span-2 sm:col-span-1"
                      prefix={`Segment ${i + 1}`}
                      label="Name"
                      inputMode="text"
                      value={row.name}
                      error={errorFor(`segments.${i}.name`)}
                      onChange={(v) => editRow(row.key, "name", v)}
                    />
                    <RowInput
                      prefix={`Segment ${i + 1}`}
                      label="Power (kW)"
                      inputMode="decimal"
                      value={row.kw}
                      error={errorFor(`segments.${i}.power_kw`)}
                      onChange={(v) => editRow(row.key, "kw", v)}
                    />
                    <RowInput
                      prefix={`Segment ${i + 1}`}
                      label="Duration (min)"
                      inputMode="decimal"
                      value={row.min}
                      error={errorFor(`segments.${i}.duration_min`)}
                      onChange={(v) => editRow(row.key, "min", v)}
                    />
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      disabled={rows.length <= 1}
                      aria-label={`Remove segment ${i + 1}`}
                      className="col-span-2 rounded-md border border-gp-line-strong px-2.5 py-1.5 text-xs text-gp-muted enabled:hover:bg-gp-surface-2 enabled:hover:text-gp-text disabled:opacity-40 sm:col-span-1 sm:mt-[18px]"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {listError && (
              <p role="alert" className="text-xs text-gp-error">
                {listError}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addRow}
                disabled={rows.length >= MAX_SEGMENTS}
                className="rounded-md border border-gp-line-strong px-3 py-1.5 text-sm text-gp-text enabled:hover:bg-gp-surface-2 disabled:opacity-40"
              >
                Add segment
              </button>
              <button
                type="button"
                onClick={resetSample}
                className="rounded-md border border-gp-line px-3 py-1.5 text-sm text-gp-muted hover:bg-gp-surface-2 hover:text-gp-text"
              >
                Reset to sample
              </button>
              <span className="self-center text-[11px] text-gp-faint">
                {rows.length} of {MAX_SEGMENTS} segments
              </span>
            </div>

            <Field
              label="Cycles per shift"
              unit="cycles"
              hint="Whole number, 1 to 500. Cycle time × cycles must fit in 1,440 minutes."
              value={cycles}
              error={errorFor("cycles_per_shift")}
              onChange={(v) => {
                clearLocal("cycles_per_shift");
                setCycles(v);
              }}
            />

            <button
              type="submit"
              disabled={running}
              className="w-full rounded-md bg-gp-red px-3 py-2.5 text-sm font-semibold text-white shadow-lg shadow-gp-red/20 transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-gp-line-strong disabled:text-gp-faint disabled:shadow-none"
            >
              {running ? "Analyzing…" : "Analyze duty cycle"}
            </button>
          </form>
        </div>

        <section aria-label="Duty cycle results" className="space-y-3">
          <p role="status" className="sr-only">
            {running
              ? "Analyzing the duty cycle."
              : status === "done" && result
                ? `Duty cycle analysis complete. ${fixed(result.cycle.energy_kwh)} kWh per cycle and ${fixed(result.shift.energy_kwh)} kWh per shift across ${result.segments.length} segments.`
                : ""}
          </p>

          {status === "idle" && !result && (
            <div className="rounded-xl border border-dashed border-gp-line-strong p-6 text-sm text-gp-muted">
              No result yet. Check the segments and run the analysis to see the
              energy per segment, per cycle and per shift, and which segment
              uses the most energy.
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
                  : "The analysis could not run"}
              </p>
              <p className="mt-1 text-gp-muted">{error.message}</p>
              {error.kind !== "validation" && (
                <button
                  type="button"
                  onClick={() => submit()}
                  className="mt-3 rounded border border-gp-line-strong px-3 py-1.5 hover:bg-gp-surface"
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
                  className="mb-2 rounded border border-gp-warn/40 bg-gp-warn/10 px-3 py-1.5 text-xs text-gp-warn"
                >
                  The inputs changed after this result. Run the analysis again.
                </p>
              )}
              <div
                data-testid="cycle-summary"
                className="rounded-xl border border-gp-line bg-gp-surface p-3"
              >
                <h2 className="text-sm font-semibold tracking-wider text-gp-text uppercase">
                  Energy and power
                </h2>
                <p
                  data-testid="results-basis"
                  className="text-[11px] text-gp-faint"
                >
                  Calculated from the illustrative power profile you entered.
                  These are not measurements of any haul truck or machine.
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-3">
                  <Tile
                    label="Cycle energy"
                    value={`${fixed(result.cycle.energy_kwh)} kWh`}
                  />
                  <Tile
                    label="Cycle duration"
                    value={`${fixed(result.cycle.duration_min)} min`}
                  />
                  <Tile
                    label={`Shift energy (${result.shift.cycles} cycles)`}
                    value={`${fixed(result.shift.energy_kwh)} kWh`}
                  />
                  <Tile
                    label="Shift duration"
                    value={`${fixed(result.shift.duration_min)} min`}
                  />
                  <Tile
                    label="Average power"
                    value={`${fixed(result.cycle.average_power_kw)} kW`}
                  />
                  <Tile
                    label="Peak power"
                    value={`${fixed(result.cycle.peak_power_kw)} kW`}
                  />
                </dl>
              </div>

              <div
                data-testid="dominance"
                className="mt-3 rounded-xl border border-gp-line bg-gp-surface p-3"
              >
                <h2 className="text-sm font-semibold tracking-wider text-gp-text uppercase">
                  What uses the most energy
                </h2>
                <p className="mt-1 text-sm leading-snug text-gp-muted">
                  {result.explanation}
                </p>
              </div>

              <div className="mt-3">
                <Breakdown
                  key={result.segments.map((s) => s.id).join()}
                  result={result}
                />
              </div>

              <details className="mt-3 rounded-xl border border-gp-line bg-gp-surface p-3">
                <summary className="cursor-pointer text-sm font-medium text-gp-text">
                  Assumptions and what this does not model
                </summary>
                <ul className="mt-2 space-y-1.5 text-xs text-gp-muted">
                  {result.assumptions.map((a) => (
                    <li key={a.id}>
                      <span className="font-mono text-gp-faint">{a.id}</span>{" "}
                      {a.text}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}

          <p className="text-[11px] leading-snug text-gp-faint">
            Synthetic exercise on the numbers you enter. It does not model fuel
            use, vehicle range, propulsion or validated haul-truck performance,
            and it is not a recommendation or a prediction for real equipment.
            GridProof is independent and not affiliated with Cummins Inc.
          </p>
        </section>
      </div>
    </div>
  );
}
