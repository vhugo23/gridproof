import { useId } from "react";
import type { CapacityPackage, CapacityRequirement } from "@/lib/types";

type Unit = CapacityRequirement["unit"];
export type CapacityScale = Record<Unit, number>;

const REQUIREMENT_LABEL: Record<CapacityRequirement["requirement_id"], string> =
  {
    KW_CAPACITY: "Real power (kW)",
    KVA_CAPACITY: "Apparent power (kVA)",
  };

// Display formatting only: every value comes from the backend response.
export const fixed = (n: number) => n.toFixed(2);
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;

export function Verdict({ status }: { status: "pass" | "fail" }) {
  const pass = status === "pass";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-bold tracking-wider ${
        pass
          ? "bg-gp-ok/15 text-gp-ok ring-1 ring-gp-ok/40"
          : "bg-gp-error/15 text-gp-error ring-1 ring-gp-error/40"
      }`}
    >
      <span aria-hidden>{pass ? "✓" : "✕"}</span>
      {pass ? "PASS" : "FAIL"}
    </span>
  );
}

// Counts aggregate the backend's separate per-requirement verdicts; no verdict
// is recomputed from numbers here.
function countPassing(
  packages: CapacityPackage[],
  id?: CapacityRequirement["requirement_id"],
): number {
  return packages.filter((p) =>
    id
      ? p.requirements.some(
          (r) => r.requirement_id === id && r.status === "pass",
        )
      : p.requirements.length === 2 &&
        p.requirements.every((r) => r.status === "pass"),
  ).length;
}

export function ScreeningSummary({
  packages,
}: {
  packages: CapacityPackage[];
}) {
  const total = packages.length;
  return (
    <div
      data-testid="screening-summary"
      className="mt-3 rounded-xl border border-gp-line bg-gp-surface p-3"
    >
      <h2 className="text-sm font-semibold tracking-wider text-gp-text uppercase">
        Screening summary
      </h2>
      <p className="mt-1 text-sm text-gp-text">
        <span className="font-mono text-base font-semibold">
          {countPassing(packages)} of {total}
        </span>{" "}
        synthetic packages satisfy both the kW and the kVA requirement.
      </p>
      <p className="mt-0.5 text-xs text-gp-muted">
        kW requirement: {countPassing(packages, "KW_CAPACITY")} of {total} pass
        · kVA requirement: {countPassing(packages, "KVA_CAPACITY")} of {total}{" "}
        pass
      </p>
    </div>
  );
}

/** Largest required or rated value per unit, so all cards share one scale. */
export function scaleFor(packages: CapacityPackage[]): CapacityScale {
  const scale: CapacityScale = { kW: 0, kVA: 0 };
  for (const p of packages)
    for (const r of p.requirements)
      scale[r.unit] = Math.max(scale[r.unit], r.required, r.capacity);
  return scale;
}

export function ScaleLegend({ scale }: { scale: CapacityScale }) {
  return (
    <p className="mt-3 text-[11px] leading-snug text-gp-muted">
      Bars show each package&apos;s rated capacity; the white marker is the
      requirement. All kW bars share one scale (0 to {fixed(scale.kW)} kW) and
      all kVA bars another (0 to {fixed(scale.kVA)} kVA). PASS or FAIL and the
      bar colour come from the server.
    </p>
  );
}

const pctOf = (value: number, max: number) =>
  max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;

// Geometry only: fill length is the rated capacity, the marker is the
// requirement. The exact values are printed beneath it as text.
function CapacityBar({ r, max }: { r: CapacityRequirement; max: number }) {
  const pass = r.status === "pass";
  return (
    <div aria-hidden className="relative mt-2 h-4">
      <div className="absolute inset-x-0 top-1 h-2 rounded-full bg-gp-line" />
      <div
        data-bar="rated"
        className={`absolute top-1 h-2 rounded-full ${pass ? "bg-gp-ok" : "bg-gp-error"}`}
        style={{ width: `${pctOf(r.capacity, max)}%` }}
      />
      <div
        data-bar="required"
        className="absolute top-0 h-4 w-0.5 -translate-x-1/2 bg-gp-text"
        style={{ left: `${pctOf(r.required, max)}%` }}
      />
    </div>
  );
}

function RequirementRow({ r, max }: { r: CapacityRequirement; max: number }) {
  return (
    <div
      data-requirement={r.requirement_id}
      data-status={r.status}
      className="border-t border-gp-line py-2.5 first:border-t-0"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-gp-text">
          {REQUIREMENT_LABEL[r.requirement_id]}
        </h4>
        <Verdict status={r.status} />
      </div>
      <CapacityBar r={r} max={max} />
      <dl className="mt-1.5 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-gp-faint">Required</dt>
          <dd className="font-mono text-gp-text">
            {fixed(r.required)} {r.unit}
          </dd>
        </div>
        <div>
          <dt className="text-gp-faint">Package rating</dt>
          <dd className="font-mono text-gp-text">
            {r.capacity} {r.unit}
          </dd>
        </div>
        <div>
          <dt className="text-gp-faint">Margin</dt>
          <dd className="font-mono text-gp-text">
            {signed(r.margin)} {r.unit}
            <span className="block text-[11px] text-gp-muted">
              {signed(r.margin_pct_of_required)}% of required
            </span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function PackageCard({
  pkg,
  scale,
  inspected,
  onInspect,
}: {
  pkg: CapacityPackage;
  scale: CapacityScale;
  inspected: boolean;
  onInspect: () => void;
}) {
  const titleId = useId();
  return (
    <article
      aria-labelledby={titleId}
      data-inspected={inspected}
      className={`rounded-lg border bg-gp-surface p-3 ${
        inspected ? "border-gp-red ring-1 ring-gp-red/60" : "border-gp-line"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 id={titleId} className="text-sm font-semibold text-gp-text">
            {pkg.label}
          </h3>
          <p className="text-[11px] text-gp-faint">
            Rated at {pkg.rated_power_factor} pf · synthetic
          </p>
        </div>
        <button
          type="button"
          aria-pressed={inspected}
          aria-label={`Inspect ${pkg.label}`}
          onClick={onInspect}
          className={`rounded border px-2.5 py-1 text-xs ${
            inspected
              ? "border-gp-red bg-gp-red/15 text-gp-text"
              : "border-gp-line-strong text-gp-muted hover:bg-gp-surface-2 hover:text-gp-text"
          }`}
        >
          Inspect
        </button>
      </div>
      <div className="mt-1.5">
        {pkg.requirements.map((r) => (
          <RequirementRow key={r.requirement_id} r={r} max={scale[r.unit]} />
        ))}
      </div>
      <details className="border-t border-gp-line pt-2">
        <summary className="cursor-pointer text-xs text-gp-muted hover:text-gp-text">
          Server explanations
        </summary>
        <ul className="mt-2 space-y-1.5 text-xs leading-snug text-gp-muted">
          {pkg.requirements.map((r) => (
            <li key={r.requirement_id}>
              <span className="font-medium text-gp-text">
                {REQUIREMENT_LABEL[r.requirement_id]}:
              </span>{" "}
              {r.explanation}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

export function FocusPanel({ pkg }: { pkg: CapacityPackage }) {
  return (
    <section
      aria-label={`Details for ${pkg.label}`}
      data-testid="package-focus"
      className="mt-3 rounded-xl border border-gp-red/50 bg-gp-surface p-3"
    >
      <h2 className="text-sm font-semibold tracking-wider text-gp-text uppercase">
        {pkg.label}
      </h2>
      <p className="text-xs text-gp-muted">
        Rated {pkg.rated_kw} kW · {pkg.rated_kva} kVA at{" "}
        {pkg.rated_power_factor} pf · synthetic
      </p>
      <ul className="mt-2 space-y-2">
        {pkg.requirements.map((r) => (
          <li key={r.requirement_id} className="flex items-start gap-2 text-xs">
            <Verdict status={r.status} />
            <span className="text-gp-muted">
              <span className="font-medium text-gp-text">
                {REQUIREMENT_LABEL[r.requirement_id]}:
              </span>{" "}
              {r.explanation}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// x-ranges of each package within the lineup illustration's 780-unit viewBox.
const LINEUP_SPAN: Record<string, [number, number]> = {
  "synthetic-a": [125, 250],
  "synthetic-b": [238, 365],
  "synthetic-c": [352, 495],
  "synthetic-d": [490, 655],
};

export function LineupHighlight({ packageId }: { packageId: string }) {
  const span = LINEUP_SPAN[packageId];
  if (!span) return null;
  return (
    <div
      aria-hidden
      data-testid="lineup-highlight"
      className="pointer-events-none absolute top-[10%] bottom-[8%] rounded-lg border-2 border-dashed border-gp-red bg-gp-red/10"
      style={{
        left: `${(span[0] / 780) * 100}%`,
        width: `${((span[1] - span[0]) / 780) * 100}%`,
      }}
    />
  );
}
