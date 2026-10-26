"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import type { CapacityCheckEvidence, CapacityCheckRequest } from "@/lib/types";
import { useCapacityCheck } from "@/lib/useCapacityCheck";
import Field from "../workbench/Field";
import {
  FocusPanel,
  LineupHighlight,
  PackageCard,
  ScaleLegend,
  ScreeningSummary,
  fixed,
  scaleFor,
} from "./PackageViews";

type Fields = { kw: string; pf: string; margin: string };
type FieldKey = "real_power_kw" | "power_factor" | "capacity_margin_pct";

const FIELD_OF: Record<FieldKey, keyof Fields> = {
  real_power_kw: "kw",
  power_factor: "pf",
  capacity_margin_pct: "margin",
};

function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export default function Workbench({ onBack }: { onBack: () => void }) {
  const [fields, setFields] = useState<Fields>({
    kw: "400",
    pf: "0.8",
    margin: "0",
  });
  // The inputs of the latest attempt (used for server field errors).
  const [ranWith, setRanWith] = useState<Fields | null>(null);
  // The inputs that produced the result on screen. A failed re-run must not
  // replace them, or older evidence would look current.
  const [shown, setShown] = useState<{
    result: CapacityCheckEvidence;
    fields: Fields;
  } | null>(null);
  const [localErrors, setLocalErrors] = useState<
    Partial<Record<FieldKey, string>>
  >({});
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const { status, result, error, run } = useCapacityCheck();
  const inspected = result?.packages.find((p) => p.id === inspectedId) ?? null;

  // A new result always comes from the latest attempt, so pair them as it arrives.
  if (result && ranWith && shown?.result !== result)
    setShown({ result, fields: ranWith });

  const stale =
    result !== null &&
    shown !== null &&
    shown.result === result &&
    (shown.fields.kw !== fields.kw ||
      shown.fields.pf !== fields.pf ||
      shown.fields.margin !== fields.margin);

  const set = (key: keyof Fields) => (value: string) =>
    setFields((current) => ({ ...current, [key]: value }));

  const errorFor = (key: FieldKey): string | undefined => {
    if (localErrors[key]) return localErrors[key];
    const text = FIELD_OF[key];
    // A server error applies only while the field still holds what was submitted.
    return ranWith && ranWith[text] === fields[text]
      ? error?.fieldErrors[key]
      : undefined;
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const kw = parseNumber(fields.kw);
    const pf = parseNumber(fields.pf);
    const marginBlank = fields.margin.trim() === "";
    const margin = marginBlank ? 0 : parseNumber(fields.margin);
    const errors: Partial<Record<FieldKey, string>> = {};
    if (kw === null) errors.real_power_kw = "Enter a number.";
    if (pf === null) errors.power_factor = "Enter a number.";
    if (margin === null) errors.capacity_margin_pct = "Enter a number.";
    setLocalErrors(errors);
    if (kw === null || pf === null || margin === null) return;
    const request: CapacityCheckRequest = {
      real_power_kw: kw,
      power_factor: pf,
      ...(marginBlank ? {} : { capacity_margin_pct: margin }),
    };
    setRanWith(fields);
    void run(request);
  };

  const running = status === "running";
  const scale = scaleFor(result?.packages ?? []);

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
            Daventry Generator Configuration Workbench
          </h1>
          <p className="text-xs text-gp-faint">
            Synthetic exercise · independent of the plant and of Cummins Inc.
          </p>
        </div>
        <span className="rounded border border-gp-red/50 bg-gp-red/10 px-2 py-1 text-[11px] font-semibold tracking-widest text-gp-red-text uppercase">
          Synthetic
        </span>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-xl border border-gp-line bg-gp-surface">
            <Image
              src="/illustrations/daventry-package-lineup.svg"
              alt="Illustration of four synthetic enclosed generator sets, packages A to D, in increasing size. Invented for GridProof; not Cummins products."
              width={780}
              height={262}
              unoptimized
              className="h-auto w-full"
            />
            {inspected && <LineupHighlight packageId={inspected.id} />}
          </div>

          <form
            onSubmit={submit}
            noValidate
            aria-label="Customer requirements"
            className="space-y-4 rounded-xl border border-gp-line bg-gp-surface p-4"
          >
            <div>
              <h2 className="text-sm font-semibold tracking-wider text-gp-text uppercase">
                Customer requirements
              </h2>
              <p className="mt-1 text-xs text-gp-muted">
                Enter a steady load. The server validates every value and
                calculates the check; nothing is saved.
              </p>
            </div>
            <Field
              label="Real power demand"
              unit="kW"
              hint="Whole number, 1 to 2000."
              value={fields.kw}
              error={errorFor("real_power_kw")}
              onChange={set("kw")}
            />
            <Field
              label="Power factor"
              unit="pf"
              hint="0.50 to 1.00, at most 2 decimals (lagging)."
              value={fields.pf}
              error={errorFor("power_factor")}
              onChange={set("pf")}
            />
            <Field
              label="Capacity margin (optional)"
              unit="%"
              hint="Whole number, 0 to 50. Blank means 0."
              value={fields.margin}
              error={errorFor("capacity_margin_pct")}
              onChange={set("margin")}
            />
            <button
              type="submit"
              disabled={running}
              className="w-full rounded-md bg-gp-red px-3 py-2.5 text-sm font-semibold text-white shadow-lg shadow-gp-red/20 transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-gp-line-strong disabled:text-gp-faint disabled:shadow-none"
            >
              {running ? "Checking…" : "Run capacity check"}
            </button>
          </form>
        </div>

        <section aria-label="Capacity check results" className="space-y-3">
          <p role="status" className="sr-only">
            {running
              ? "Running the capacity check."
              : status === "done" && result
                ? `Capacity check complete for ${result.inputs.real_power_kw} kW at ${result.inputs.power_factor} power factor. Results for four synthetic packages are shown.`
                : ""}
          </p>
          {status === "idle" && !result && (
            <div className="rounded-xl border border-dashed border-gp-line-strong p-6 text-sm text-gp-muted">
              No result yet. Enter your requirement and run the capacity check
              to compare the four synthetic packages. Each package gets a
              separate PASS or FAIL for real power (kW) and for apparent power
              (kVA).
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
                  : "The capacity check could not run"}
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
                  The inputs changed after this result. Run the check again.
                </p>
              )}
              <div
                data-testid="demand-summary"
                className="rounded-xl border border-gp-line bg-gp-surface p-3"
              >
                <h2 className="text-sm font-semibold tracking-wider text-gp-text uppercase">
                  Calculated demand
                </h2>
                <p className="text-[11px] text-gp-faint">
                  {result.inputs.real_power_kw} kW at{" "}
                  {result.inputs.power_factor} pf,{" "}
                  {result.inputs.capacity_margin_pct}% margin
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-gp-faint">Real power</dt>
                    <dd className="font-mono text-gp-text">
                      {fixed(result.demand.real_power_kw)} kW
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gp-faint">Apparent power</dt>
                    <dd className="font-mono text-gp-text">
                      {fixed(result.demand.apparent_power_kva)} kVA
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gp-faint">Required kW</dt>
                    <dd className="font-mono text-gp-text">
                      {fixed(result.demand.required_kw)} kW
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gp-faint">Required kVA</dt>
                    <dd className="font-mono text-gp-text">
                      {fixed(result.demand.required_kva)} kVA
                    </dd>
                  </div>
                </dl>
              </div>

              <ScreeningSummary packages={result.packages} />
              {inspected && <FocusPanel pkg={inspected} />}
              <ScaleLegend scale={scale} />
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {result.packages.map((pkg) => (
                  <PackageCard
                    key={pkg.id}
                    pkg={pkg}
                    scale={scale}
                    inspected={pkg.id === inspected?.id}
                    onInspect={() =>
                      setInspectedId((cur) => (cur === pkg.id ? null : pkg.id))
                    }
                  />
                ))}
              </div>

              <details className="mt-3 rounded-xl border border-gp-line bg-gp-surface p-3">
                <summary className="cursor-pointer text-sm font-medium text-gp-text">
                  Assumptions and what this does not check
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
            Synthetic screening exercise. Not a product recommendation, plant
            operation, complete sizing or compliance check, or measured
            performance. GridProof is independent and not affiliated with
            Cummins Inc.
          </p>
        </section>
      </div>
    </div>
  );
}
