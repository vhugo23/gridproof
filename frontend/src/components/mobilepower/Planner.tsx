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
import type {
  MobilePowerComparison,
  MobilePowerEvidence,
  MobilePowerPackage,
  MobilePowerRequest,
} from "@/lib/types";
import { useMobilePower } from "@/lib/useMobilePower";
import Field from "../workbench/Field";
import CapacityLadder, {
  CATEGORY_GLYPH,
  CATEGORY_TONE,
  fixed,
} from "./CapacityLadder";
import { EXPLANATIONS } from "./explanations";

type Row = { key: number; name: string; qty: string; kw: string; sim: string };
type RowField = "name" | "qty" | "kw" | "sim";
type Errors = Record<string, string>;
type Focus = { kind: "name"; key: number } | { kind: "add" } | null;

// Invented for illustration. These are not equipment data.
const SAMPLE_ROWS: Array<Omit<Row, "key">> = [
  { name: "LED floodlights", qty: "8", kw: "0.40", sim: "1.00" },
  { name: "Cabin HVAC", qty: "2", kw: "7.50", sim: "0.80" },
  { name: "Welding machines", qty: "3", kw: "12.00", sim: "0.50" },
  { name: "Air compressor", qty: "1", kw: "22.00", sim: "0.75" },
  { name: "Water pumps", qty: "2", kw: "5.50", sim: "0.50" },
];
const SAMPLE_MARGIN = "25";
// Only used to disable the Add button; the server enforces the real limit.
const MAX_LOADS = 12;

const API_FIELD: Record<RowField, string> = {
  name: "name",
  qty: "quantity",
  kw: "rated_kw",
  sim: "simultaneity_factor",
};

function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

const signed = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}`;

// A golden-angle hue gives up to 12 distinguishable colours; names carry the identity.
const colorOf = (index: number) => `hsl(${(index * 137.5) % 360} 55% 58%)`;

function RowInput({
  label,
  prefix,
  value,
  error,
  className,
  inputMode,
  dataName,
  onChange,
}: {
  label: string;
  prefix: string;
  value: string;
  error?: string;
  className?: string;
  inputMode?: "decimal" | "text" | "numeric";
  dataName?: number;
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
        data-load-name={dataName}
        inputMode={inputMode}
        autoComplete="off"
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-0.5 min-h-11 w-full rounded-md border bg-gp-bg px-2 py-1.5 text-sm text-gp-text ${
          inputMode === "decimal" || inputMode === "numeric"
            ? "text-right font-mono"
            : ""
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

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-gp-faint">{label}</dt>
      <dd className="font-mono text-gp-text">{value}</dd>
      {hint && <dd className="text-[10px] text-gp-faint">{hint}</dd>}
    </div>
  );
}

function Contribution({ result }: { result: MobilePowerEvidence }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dominant = new Set(result.dominant_load_ids);
  const selected = result.loads.find((l) => l.id === selectedId) ?? null;
  const index = (id: string) => result.loads.findIndex((l) => l.id === id);

  return (
    <div
      data-testid="contribution"
      className="rounded-xl border border-gp-line bg-gp-surface p-3"
    >
      <h2 className="text-sm font-semibold tracking-wider text-gp-text uppercase">
        Contribution by load
      </h2>
      <p className="text-[11px] text-gp-faint">
        Each segment is one load&apos;s share of modeled demand, in the order
        you entered the loads. It is not a ranking of packages. Choose a load
        for details.
      </p>
      <div
        aria-hidden
        data-testid="share-bar"
        className="mt-2 flex h-5 overflow-hidden rounded-full bg-gp-line"
      >
        {result.loads.map((l, i) => (
          <div
            key={l.id}
            data-slice={l.id}
            className="h-full flex-none transition-opacity motion-reduce:transition-none"
            style={{
              width: `${l.share_of_demand_pct}%`,
              background: colorOf(i),
              opacity: selectedId && selectedId !== l.id ? 0.3 : 1,
            }}
          />
        ))}
      </div>
      <ul aria-label="Demand by load" className="mt-2 space-y-1.5">
        {result.loads.map((l, i) => {
          const active = selectedId === l.id;
          return (
            <li key={l.id}>
              <button
                type="button"
                aria-pressed={active}
                data-load={l.id}
                onClick={() => setSelectedId(active ? null : l.id)}
                className={`block min-h-11 w-full rounded-lg border px-2.5 py-2 text-left text-sm ${
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
                  <span className="font-medium text-gp-text">{l.name}</span>
                  {dominant.has(l.id) && (
                    <span className="rounded bg-gp-red/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-gp-red-text uppercase ring-1 ring-gp-red/40">
                      Largest demand
                    </span>
                  )}
                  <span className="ml-auto font-mono text-xs text-gp-text">
                    {fixed(l.demand_kw)} kW · {fixed(l.share_of_demand_pct)}%
                  </span>
                </span>
                <span
                  aria-hidden
                  className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-gp-line"
                >
                  <span
                    data-share={l.id}
                    className="block h-full rounded-full"
                    style={{
                      width: `${l.share_of_demand_pct}%`,
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
          data-testid="load-focus"
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
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            <Tile label="Quantity" value={String(selected.quantity)} />
            <Tile
              label="Rated power"
              value={`${fixed(selected.rated_kw)} kW`}
            />
            <Tile
              label="Simultaneity factor"
              value={fixed(selected.simultaneity_factor)}
            />
            <Tile
              label="Connected load"
              value={`${fixed(selected.connected_kw)} kW`}
            />
            <Tile
              label="Modeled demand"
              value={`${fixed(selected.demand_kw)} kW`}
            />
            <Tile
              label="Share of modeled demand"
              value={`${fixed(selected.share_of_demand_pct)}%`}
            />
          </dl>
          {dominant.has(selected.id) && (
            <p className="mt-2 text-xs text-gp-muted">
              This load has the most modeled demand on the list.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function ComparisonLine({
  title,
  comparison,
}: {
  title: string;
  comparison: MobilePowerComparison;
}) {
  const meets = comparison.status === "meets";
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
      <span className="text-gp-faint">{title}</span>
      <span className="font-mono text-gp-text">
        {fixed(comparison.required)} kW {comparison.comparator}{" "}
        {fixed(comparison.capacity)} kW
      </span>
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase ${
          meets
            ? "bg-gp-ok/15 text-gp-ok ring-1 ring-gp-ok/40"
            : "bg-gp-error/15 text-gp-error ring-1 ring-gp-error/40"
        }`}
      >
        <span aria-hidden>{meets ? "✓" : "✕"}</span>{" "}
        {meets ? "Meets" : "Does not meet"}
      </span>
      <span className="font-mono text-gp-muted">
        headroom {signed(comparison.headroom_kw)} kW ·{" "}
        {fixed(comparison.utilization_pct)}% utilization
      </span>
    </div>
  );
}

// A requirement the server judged as not met can still display equal to the rating
// once rounded to 2 decimals. This only reads the server's own verdict and rounded
// values to explain that; it decides nothing.
const looksEqualButFails = (c: MobilePowerComparison) =>
  c.status === "does_not_meet" && c.required === c.capacity;

function PackageCard({ pkg }: { pkg: MobilePowerPackage }) {
  const roundedTie =
    looksEqualButFails(pkg.modeled_demand) ||
    looksEqualButFails(pkg.all_simultaneous);
  return (
    <li
      data-package={pkg.id}
      className="rounded-lg border border-gp-line bg-gp-bg/40 p-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-sm font-medium text-gp-text">{pkg.label}</h3>
        <span className="font-mono text-xs text-gp-muted">
          {fixed(pkg.rated_kw)} kW
        </span>
        <span
          data-category={pkg.category}
          className={`ml-auto rounded px-2 py-0.5 text-[11px] font-semibold ${CATEGORY_TONE[pkg.category]}`}
        >
          <span aria-hidden>{CATEGORY_GLYPH[pkg.category]}</span>{" "}
          {pkg.category_label}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        <ComparisonLine
          title="Modeled demand"
          comparison={pkg.modeled_demand}
        />
        <ComparisonLine
          title="All loads at once"
          comparison={pkg.all_simultaneous}
        />
      </div>
      {roundedTie && (
        <p
          data-testid={`rounded-tie-${pkg.id}`}
          className="mt-2 rounded border border-gp-warn/40 bg-gp-warn/10 px-2 py-1 text-[11px] leading-snug text-gp-muted"
        >
          <span className="font-semibold text-gp-warn">
            Equal when rounded, not equal exactly.
          </span>{" "}
          Values are shown to 2 decimals, but the server compares the exact
          values, and here the requirement is slightly above the rating, so it
          is not met. {pkg.explanation}
        </p>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-gp-muted">
          Why this category
        </summary>
        <p className="mt-1 text-xs leading-snug text-gp-muted">
          {pkg.explanation}
        </p>
      </details>
    </li>
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

export default function Planner({ onBack }: { onBack: () => void }) {
  const nextKey = useRef(SAMPLE_ROWS.length);
  const [rows, setRows] = useState<Row[]>(() =>
    SAMPLE_ROWS.map((row, key) => ({ key, ...row })),
  );
  const [margin, setMargin] = useState(SAMPLE_MARGIN);
  const [ranWith, setRanWith] = useState<{
    rows: Row[];
    margin: string;
  } | null>(null);
  const [localErrors, setLocalErrors] = useState<Errors>({});
  const [focus, setFocus] = useState<Focus>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const { status, result, resultSnapshot, error, run } = useMobilePower();

  // Move keyboard focus after a row is added or removed so it is never lost.
  useEffect(() => {
    if (!focus) return;
    if (focus.kind === "add") addRef.current?.focus();
    else
      document
        .querySelector<HTMLInputElement>(`[data-load-name="${focus.key}"]`)
        ?.focus();
    setFocus(null);
  }, [focus, rows]);

  const stale =
    result !== null &&
    resultSnapshot !== undefined &&
    (resultSnapshot.margin !== margin ||
      resultSnapshot.rows.length !== rows.length ||
      resultSnapshot.rows.some(
        (r, i) =>
          r.key !== rows[i].key ||
          r.name !== rows[i].name ||
          r.qty !== rows[i].qty ||
          r.kw !== rows[i].kw ||
          r.sim !== rows[i].sim,
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
    clearLocal(`loads.${index}.${API_FIELD[field]}`);
    setRows((current) =>
      current.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
  };

  const addRow = () => {
    if (rows.length >= MAX_LOADS) return;
    const key = nextKey.current++;
    setRows((current) => [
      ...current,
      { key, name: "", qty: "1", kw: "", sim: "1.00" },
    ]);
    setLocalErrors({});
    setFocus({ kind: "name", key });
  };

  const removeRow = (key: number) => {
    if (rows.length <= 1) return;
    const index = rows.findIndex((r) => r.key === key);
    const neighbour = rows[index + 1] ?? rows[index - 1];
    setRows((current) => current.filter((r) => r.key !== key));
    setLocalErrors({});
    setFocus(
      neighbour ? { kind: "name", key: neighbour.key } : { kind: "add" },
    );
  };

  const resetSample = () => {
    nextKey.current = SAMPLE_ROWS.length;
    setRows(SAMPLE_ROWS.map((row, key) => ({ key, ...row })));
    setMargin(SAMPLE_MARGIN);
    setLocalErrors({});
  };

  // A server error applies only while what it refers to still holds what was submitted.
  const serverError = (path: string): string | undefined => {
    const message = error?.fieldErrors[path];
    if (!message || !ranWith) return undefined;
    if (path === "capacity_margin_pct")
      return ranWith.margin === margin ? message : undefined;
    if (path === "loads") {
      const same =
        ranWith.rows.length === rows.length &&
        ranWith.rows.every(
          (r, i) =>
            r.key === rows[i].key &&
            r.qty === rows[i].qty &&
            r.kw === rows[i].kw,
        );
      return same ? message : undefined;
    }
    const match = /^loads\.(\d+)\.(\w+)$/.exec(path);
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
    const loads: MobilePowerRequest["loads"] = [];
    rows.forEach((row, i) => {
      const quantity = parseNumber(row.qty);
      const ratedKw = parseNumber(row.kw);
      const factor = parseNumber(row.sim);
      if (quantity === null) errors[`loads.${i}.quantity`] = "Enter a number.";
      if (ratedKw === null) errors[`loads.${i}.rated_kw`] = "Enter a number.";
      if (factor === null)
        errors[`loads.${i}.simultaneity_factor`] = "Enter a number.";
      if (quantity !== null && ratedKw !== null && factor !== null)
        loads.push({
          name: row.name,
          quantity,
          rated_kw: ratedKw,
          simultaneity_factor: factor,
        });
    });
    const marginPct = parseNumber(margin);
    if (marginPct === null) errors.capacity_margin_pct = "Enter a number.";
    setLocalErrors(errors);
    if (Object.keys(errors).length > 0 || marginPct === null) return;
    const snapshot = { rows: rows.map((r) => ({ ...r })), margin };
    setRanWith(snapshot);
    void run({ loads, capacity_margin_pct: marginPct }, snapshot);
  };

  const running = status === "running";
  const listError = errorFor("loads");

  const meetsModeled = result
    ? result.packages.filter((p) => p.modeled_demand.status === "meets").length
    : 0;

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
            Mobile-Site Power Planner
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
              src="/illustrations/on-highway-trucks.svg"
              alt="Illustration of a long-haul tractor with a sleeper cab pulling a box trailer."
              width={360}
              height={225}
              unoptimized
              className="mx-auto h-auto max-h-48 w-auto"
            />
          </div>

          <Callout testId="scope-note" tone="warn" title="What this screens">
            Steady-state real power (kW) only. It does not validate kVA, power
            factor, voltage, motor starting, step loading, derating, protection,
            fuel, emissions or full equipment suitability. It models a temporary
            site&apos;s electrical demand, not the truck or trailer.
          </Callout>

          <form
            onSubmit={submit}
            noValidate
            aria-label="Site loads"
            className="space-y-4 rounded-xl border border-gp-line bg-gp-surface p-4"
          >
            <div>
              <h2 className="text-sm font-semibold tracking-wider text-gp-text uppercase">
                Site loads
              </h2>
              <p className="mt-1 text-xs text-gp-muted">
                List the electrical loads of a temporary site: a name, how many,
                the rated kW of each and the share you assume runs at the same
                time. The server validates every value and does the calculation;
                nothing is saved.
              </p>
              <p
                data-testid="sample-note"
                className="mt-1 text-[11px] text-gp-warn"
              >
                The starting values are invented for illustration. They are not
                equipment data. Replace them with your own.
              </p>
              <p
                data-testid="simultaneity-note"
                className="mt-1 text-[11px] leading-snug text-gp-muted"
              >
                A simultaneity factor (0.01 to 1.00) is your planning assumption
                of how much of that load group runs together at the same time.
                It is not a measured peak concurrency or a physical operating
                schedule, and the planner cannot check it.
              </p>
            </div>

            <ul className="space-y-2" aria-label="Loads">
              {rows.map((row, i) => (
                <li key={row.key}>
                  <div
                    role="group"
                    aria-label={`Load ${i + 1}`}
                    className="grid grid-cols-3 gap-2 rounded-lg border border-gp-line bg-gp-bg/40 p-2.5 sm:grid-cols-[minmax(0,1fr)_4.5rem_5.5rem_5.5rem_auto] sm:items-start"
                  >
                    <RowInput
                      className="col-span-3 sm:col-span-1"
                      prefix={`Load ${i + 1}`}
                      label="Name"
                      inputMode="text"
                      dataName={row.key}
                      value={row.name}
                      error={errorFor(`loads.${i}.name`)}
                      onChange={(v) => editRow(row.key, "name", v)}
                    />
                    <RowInput
                      prefix={`Load ${i + 1}`}
                      label="Quantity"
                      inputMode="numeric"
                      value={row.qty}
                      error={errorFor(`loads.${i}.quantity`)}
                      onChange={(v) => editRow(row.key, "qty", v)}
                    />
                    <RowInput
                      prefix={`Load ${i + 1}`}
                      label="Rated (kW)"
                      inputMode="decimal"
                      value={row.kw}
                      error={errorFor(`loads.${i}.rated_kw`)}
                      onChange={(v) => editRow(row.key, "kw", v)}
                    />
                    <RowInput
                      prefix={`Load ${i + 1}`}
                      label="Simultaneity"
                      inputMode="decimal"
                      value={row.sim}
                      error={errorFor(`loads.${i}.simultaneity_factor`)}
                      onChange={(v) => editRow(row.key, "sim", v)}
                    />
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      disabled={rows.length <= 1}
                      aria-label={`Remove load ${i + 1}`}
                      className="col-span-3 min-h-11 rounded-md border border-gp-line-strong px-2.5 py-1.5 text-xs text-gp-muted enabled:hover:bg-gp-surface-2 enabled:hover:text-gp-text disabled:opacity-40 sm:col-span-1 sm:mt-[18px]"
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
                ref={addRef}
                type="button"
                onClick={addRow}
                disabled={rows.length >= MAX_LOADS}
                className="min-h-11 rounded-md border border-gp-line-strong px-3 py-1.5 text-sm text-gp-text enabled:hover:bg-gp-surface-2 disabled:opacity-40"
              >
                Add load
              </button>
              <button
                type="button"
                onClick={resetSample}
                className="min-h-11 rounded-md border border-gp-line px-3 py-1.5 text-sm text-gp-muted hover:bg-gp-surface-2 hover:text-gp-text"
              >
                Reset to sample
              </button>
              <span className="self-center text-[11px] text-gp-faint">
                {rows.length} of {MAX_LOADS} loads
              </span>
            </div>

            <Field
              label="Capacity margin"
              unit="%"
              hint="Whole number, 0 to 50. Added on top of the demand. Total connected load must stay within 2,000 kW."
              value={margin}
              error={errorFor("capacity_margin_pct")}
              onChange={(v) => {
                clearLocal("capacity_margin_pct");
                setMargin(v);
              }}
            />

            <button
              type="submit"
              disabled={running}
              className="min-h-11 w-full rounded-md bg-gp-red px-3 py-2.5 text-sm font-semibold text-white shadow-lg shadow-gp-red/20 transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-gp-line-strong disabled:text-gp-faint disabled:shadow-none"
            >
              {running ? "Calculating…" : "Calculate site demand"}
            </button>
          </form>
        </div>

        <section aria-label="Site demand results" className="space-y-3">
          <p role="status" className="sr-only">
            {running
              ? "Calculating site demand."
              : status === "done" && result
                ? `Site demand calculated. Required capacity ${fixed(result.totals.required_kw)} kilowatts; all-simultaneous requirement ${fixed(result.totals.all_simultaneous_required_kw)} kilowatts. ${meetsModeled} of ${result.packages.length} synthetic packages meet modeled demand.`
                : ""}
          </p>

          {status === "idle" && !result && (
            <div className="rounded-xl border border-dashed border-gp-line-strong p-6 text-sm text-gp-muted">
              No result yet. Check the loads and calculate to see connected
              load, simultaneous demand, required capacity, each load&apos;s
              contribution and how four synthetic packages compare.
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
                  : "The calculation could not run"}
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
                  The inputs changed after this result. Calculate again.
                </p>
              )}
              <div
                data-testid="site-summary"
                className="rounded-xl border border-gp-line bg-gp-surface p-3"
              >
                <h2 className="text-sm font-semibold tracking-wider text-gp-text uppercase">
                  Site demand
                </h2>
                <p
                  data-testid="results-basis"
                  className="text-[11px] text-gp-faint"
                >
                  Calculated from the illustrative loads and the planning
                  assumptions you entered, for steady-state kW only. These are
                  not measurements of any site or equipment.
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-3">
                  <Tile
                    label="Connected load"
                    value={`${fixed(result.totals.connected_kw)} kW`}
                  />
                  <Tile
                    label="Simultaneous (modeled) demand"
                    value={`${fixed(result.totals.demand_kw)} kW`}
                    hint="from your simultaneity assumptions; not a measured or guaranteed peak"
                  />
                  <Tile
                    label="Overall simultaneity"
                    value={`${fixed(result.totals.overall_simultaneity_pct)}%`}
                    hint="demand ÷ connected load"
                  />
                  <Tile
                    label={`Required with ${result.inputs.capacity_margin_pct}% margin`}
                    value={`${fixed(result.totals.required_kw)} kW`}
                  />
                  <Tile
                    label="All-simultaneous requirement"
                    value={`${fixed(result.totals.all_simultaneous_required_kw)} kW`}
                    hint="every load at once, with margin"
                  />
                </dl>
                <p
                  data-testid="dominance"
                  className="mt-3 text-sm leading-snug text-gp-muted"
                >
                  {result.explanation}
                </p>
              </div>

              <div className="mt-3">
                <Contribution
                  key={result.loads.map((l) => l.id).join()}
                  result={result}
                />
              </div>

              <div className="mt-3">
                <CapacityLadder result={result} />
              </div>

              <div
                data-testid="packages"
                className="mt-3 rounded-xl border border-gp-line bg-gp-surface p-3"
              >
                <h2 className="text-sm font-semibold tracking-wider text-gp-text uppercase">
                  Synthetic packages
                </h2>
                <p className="text-[11px] text-gp-faint">
                  Listed by rating, not ranked. A category states how a package
                  compares with your numbers; nothing is recommended.
                </p>
                <ul aria-label="Synthetic packages" className="mt-2 space-y-2">
                  {result.packages.map((p) => (
                    <PackageCard key={p.id} pkg={p} />
                  ))}
                </ul>
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

          <section
            aria-label="How the calculations work"
            data-testid="explanations"
            className="rounded-xl border border-gp-line bg-gp-surface p-3"
          >
            <h2 className="text-sm font-semibold tracking-wider text-gp-text uppercase">
              How the calculations work
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
            Synthetic exercise on the numbers you enter. It screens steady-state
            kW only and is not a sizing, compliance or product-selection tool, a
            recommendation or a prediction for real equipment. The packages are
            invented and are not Cummins products. GridProof is independent and
            not affiliated with Cummins Inc.
          </p>
        </section>
      </div>
    </div>
  );
}
