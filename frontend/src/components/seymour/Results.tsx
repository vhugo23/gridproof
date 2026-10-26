"use client";

import { useState, type ReactNode } from "react";
import type {
  EnginePlanEvidence,
  EnginePlanPoint,
  EnginePlanPointCheck,
  EnginePlanRangeCheck,
  EnginePlanRequirement,
} from "@/lib/types";
import PlaneChart, { STATUS_GLYPH, STATUS_TONE } from "./PlaneChart";

export const fixed = (n: number) => n.toFixed(2);
const sign = (n: number) => (n < 0 ? "−" : n > 0 ? "+" : "");
const signed = (n: number) => `${sign(n)}${fixed(Math.abs(n))}`;
const signedWhole = (n: number) => `${sign(n)}${Math.abs(n)}`;

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

function Panel({
  testId,
  title,
  note,
  children,
}: {
  testId: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-xl border border-gp-line bg-gp-surface p-3"
    >
      <h2 className="text-sm font-semibold tracking-wider text-gp-text uppercase">
        {title}
      </h2>
      {note && <p className="text-[11px] text-gp-faint">{note}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function StatusChip({ requirement }: { requirement: EnginePlanRequirement }) {
  return (
    <span
      data-status={requirement.status}
      className={`rounded px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[requirement.status]}`}
    >
      <span aria-hidden>{STATUS_GLYPH[requirement.status]}</span>{" "}
      {requirement.status_label}
    </span>
  );
}

function rangeText(check: EnginePlanRangeCheck, unit: string): string {
  if (check.met) return `${fixed(check.value)} ${unit}: inside`;
  return check.outside_by < 0
    ? `${fixed(check.value)} ${unit}: ${fixed(-check.outside_by)} ${unit} below the minimum`
    : `${fixed(check.value)} ${unit}: ${fixed(check.outside_by)} ${unit} above the maximum`;
}

function CheckGrid({
  requirement,
  names,
}: {
  requirement: EnginePlanRequirement;
  names: Map<string, string>;
}) {
  const hasPower = requirement.point_checks.some((c) => c.power !== null);
  const cell = (ok: boolean, text: string) => (
    <td
      className={`px-2 py-1 align-top ${ok ? "" : "text-gp-text"}`}
      data-inside={ok}
    >
      {text}
    </td>
  );
  return (
    <div
      role="region"
      tabIndex={0}
      aria-label={`Bound checks for ${requirement.label}`}
      className="mt-2 overflow-x-auto rounded border border-gp-line"
    >
      <table className="w-full min-w-[34rem] text-left text-[11px] text-gp-muted">
        <caption className="sr-only">
          For each planned point, whether it is inside each bound of{" "}
          {requirement.label}
        </caption>
        <thead>
          <tr className="border-b border-gp-line text-gp-faint">
            <th scope="col" className="px-2 py-1 font-medium">
              Point
            </th>
            <th scope="col" className="px-2 py-1 font-medium">
              Speed
            </th>
            <th scope="col" className="px-2 py-1 font-medium">
              Torque
            </th>
            {hasPower && (
              <th scope="col" className="px-2 py-1 font-medium">
                Theoretical power
              </th>
            )}
            <th scope="col" className="px-2 py-1 font-medium">
              Matches
            </th>
          </tr>
        </thead>
        <tbody>
          {requirement.point_checks.map((c: EnginePlanPointCheck) => (
            <tr
              key={c.point_id}
              data-check={c.point_id}
              className="border-b border-gp-line last:border-0"
            >
              <th scope="row" className="px-2 py-1 font-medium text-gp-text">
                {names.get(c.point_id)}
              </th>
              {cell(c.rpm.met, rangeText(c.rpm, "rpm"))}
              {cell(c.torque.met, rangeText(c.torque, "N·m"))}
              {hasPower &&
                (c.power ? (
                  cell(
                    c.power.met,
                    c.power.met
                      ? `${fixed(c.power.value)} kW: at or above ${fixed(c.power.minimum)} kW`
                      : c.power.equal_when_rounded
                        ? `${fixed(c.power.value)} kW: displays equal to ${fixed(c.power.minimum)} kW but is slightly below it`
                        : `${fixed(c.power.value)} kW: ${fixed(-c.power.outside_by)} kW below the minimum`,
                  )
                ) : (
                  <td className="px-2 py-1 text-gp-faint">not required</td>
                ))}
              <td className="px-2 py-1 font-medium text-gp-text">
                {c.matches ? "Yes" : "No"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RequirementCard({
  requirement,
  index,
  names,
}: {
  requirement: EnginePlanRequirement;
  index: number;
  names: Map<string, string>;
}) {
  const equalWhenRounded = requirement.point_checks.some(
    (c) => c.power?.equal_when_rounded,
  );
  const matched = requirement.matched_point_ids
    .map((id) => names.get(id))
    .join(", ");
  return (
    <li
      data-requirement={requirement.id}
      className="rounded-lg border border-gp-line bg-gp-bg/40 p-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-sm font-medium text-gp-text">
          <span className="font-mono text-gp-faint">R{index + 1}</span>{" "}
          {requirement.label}
        </h3>
        <span className="ml-auto">
          <StatusChip requirement={requirement} />
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
        <Tile
          label="Planned entries matching"
          value={`${requirement.matched_entries} of ${requirement.min_points} needed`}
        />
        <Tile
          label="Distinct conditions among them"
          value={String(requirement.matched_distinct_conditions)}
        />
        <Tile
          label="Planned hold in matches"
          value={`${requirement.matched_hold_min} of ${requirement.min_dwell_min} min needed`}
        />
      </dl>
      {matched && (
        <p className="mt-1.5 text-xs text-gp-muted">
          <span className="text-gp-faint">Matching entries: </span>
          {matched}
        </p>
      )}
      {equalWhenRounded && (
        <p
          data-testid={`rounded-tie-${requirement.id}`}
          className="mt-2 rounded border border-gp-warn/40 bg-gp-warn/10 px-2 py-1 text-[11px] leading-snug text-gp-muted"
        >
          <span className="font-semibold text-gp-warn">
            Equal when rounded, not equal exactly.
          </span>{" "}
          Values are shown to 2 decimals, but the server compares the exact
          values, and here the theoretical power is slightly below the minimum,
          so that point does not match.
        </p>
      )}
      <p className="mt-2 text-xs leading-snug text-gp-muted">
        {requirement.explanation}
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-gp-muted">
          Bound checks for each point
        </summary>
        <CheckGrid requirement={requirement} names={names} />
      </details>
    </li>
  );
}

function CoverageMatrix({ result }: { result: EnginePlanEvidence }) {
  return (
    <div
      role="region"
      tabIndex={0}
      aria-label="Traceability matrix"
      className="overflow-x-auto rounded border border-gp-line"
    >
      <table className="w-full text-center text-xs text-gp-muted">
        <caption className="sr-only">
          Which planned points match which requirements. Planning coverage only.
        </caption>
        <thead>
          <tr className="border-b border-gp-line text-gp-faint">
            <th scope="col" className="px-2 py-1 text-left font-medium">
              Point
            </th>
            {result.requirements.map((r, i) => (
              <th
                key={r.id}
                scope="col"
                title={r.label}
                className="px-2 py-1 font-mono font-medium"
              >
                R{i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.points.map((p, pi) => (
            <tr key={p.id} className="border-b border-gp-line last:border-0">
              <th
                scope="row"
                className="px-2 py-1 text-left font-medium text-gp-text"
              >
                <span className="font-mono text-gp-faint">{pi + 1}</span>{" "}
                {p.label}
              </th>
              {result.requirements.map((r) => {
                const hit = r.matched_point_ids.includes(p.id);
                return (
                  <td
                    key={r.id}
                    data-cell={`${p.id}:${r.id}`}
                    className="px-2 py-1"
                  >
                    <span aria-hidden>{hit ? "●" : "·"}</span>
                    <span className="sr-only">
                      {hit ? "matches" : "does not match"} {r.label}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({
  result,
  selectedPointId,
  onSelect,
}: {
  result: EnginePlanEvidence;
  selectedPointId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const total = result.summary.planned_hold_min;
  const names = new Map(result.points.map((p) => [p.id, p.label]));
  const reqNo = new Map(result.requirements.map((r, i) => [r.id, `R${i + 1}`]));
  return (
    <>
      <div
        aria-hidden
        data-testid="hold-timeline"
        className="flex h-6 overflow-hidden rounded bg-gp-line"
      >
        {result.points.map((p, i) => (
          <div
            key={p.id}
            data-segment={p.id}
            style={{ width: `${(p.dwell_min / total) * 100}%` }}
            className={`flex items-center justify-center border-r border-gp-bg text-[10px] font-bold text-gp-bg ${
              i % 2 ? "bg-gp-steel" : "bg-gp-muted"
            }`}
          >
            {i + 1}
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-gp-faint">
        Segments are proportional to each planned hold, in your order. Planned
        hold time only, not total elapsed test time.
      </p>
      <ol aria-label="Ordered operating points" className="mt-2 space-y-1.5">
        {result.points.map((p: EnginePlanPoint, i) => {
          const active = selectedPointId === p.id;
          return (
            <li key={p.id} data-point-row={p.id}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(active ? null : p.id)}
                className={`block min-h-11 w-full rounded-lg border px-2.5 py-2 text-left text-xs ${
                  active
                    ? "border-gp-red bg-gp-red/10"
                    : "border-gp-line hover:bg-gp-surface-2"
                }`}
              >
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-mono text-gp-faint">{i + 1}</span>
                  <span className="text-sm font-medium text-gp-text">
                    {p.label}
                  </span>
                  <span className="ml-auto font-mono text-gp-text">
                    {p.rpm} rpm · {fixed(p.torque_nm)} N·m · {fixed(p.power_kw)}{" "}
                    kW
                  </span>
                </span>
                <span className="mt-0.5 block text-gp-muted">
                  Planned hold {p.dwell_min} min (minute {p.hold_start_min} to{" "}
                  {p.hold_end_min} of planned hold time)
                  {p.step_from_previous
                    ? `; step from previous: ${signedWhole(p.step_from_previous.delta_rpm)} rpm, ${signed(p.step_from_previous.delta_torque_nm)} N·m`
                    : "; first point"}
                </span>
                <span className="mt-0.5 block text-gp-muted">
                  {p.covers.length > 0
                    ? `Matches ${p.covers.map((id) => reqNo.get(id)).join(", ")}`
                    : "Matches no requirement"}
                  {p.same_conditions_as.length > 0 &&
                    `; same speed and torque as ${p.same_conditions_as.map((id) => names.get(id)).join(", ")} (counted as a separate entry)`}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}

const SCOPE_TITLE = {
  plan: "For the whole plan",
  point: "For each operating point",
  requirement: "For each requirement",
} as const;

function Checklist({ result }: { result: EnginePlanEvidence }) {
  return (
    <div>
      {(["plan", "point", "requirement"] as const).map((scope) => {
        const items = result.evidence_checklist.filter(
          (i) => i.scope === scope,
        );
        if (items.length === 0) return null;
        return (
          <div
            key={scope}
            role="group"
            aria-label={SCOPE_TITLE[scope]}
            className="mt-2"
          >
            <h3 className="text-xs font-semibold text-gp-text">
              {SCOPE_TITLE[scope]}
            </h3>
            <ul className="mt-1 space-y-1">
              {items.map((item) => (
                <li
                  key={item.id}
                  data-evidence={item.id}
                  className="flex gap-2 text-xs leading-snug text-gp-muted"
                >
                  <span aria-hidden className="text-gp-faint">
                    ☐
                  </span>
                  <span>
                    <span className="mr-1.5 rounded bg-gp-line px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-gp-muted uppercase">
                      Not started
                    </span>
                    {item.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export default function Results({ result }: { result: EnginePlanEvidence }) {
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const names = new Map(result.points.map((p) => [p.id, p.label]));
  const s = result.summary;

  return (
    <div className="space-y-3">
      <div
        data-testid="verification-banner"
        className="rounded-lg border border-gp-warn/50 bg-gp-warn/10 px-3 py-2 text-xs leading-snug text-gp-muted"
      >
        <p className="font-semibold text-gp-text">
          Planned coverage only · Verification: not verified
        </p>
        <p className="mt-0.5">{result.verification.statement}</p>
      </div>

      <Panel
        testId="plan-summary"
        title="Plan coverage"
        note="Calculated from the objective, requirements and operating points you entered. Planning coverage, not acceptance."
      >
        <p className="text-xs font-medium text-gp-text">
          Objective:{" "}
          <span className="font-normal">{result.inputs.objective}</span>
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-3">
          <Tile
            label="Covered by plan"
            value={`${s.covered_by_plan} of ${s.requirements_total}`}
          />
          <Tile
            label="Partly covered"
            value={`${s.partly_covered} of ${s.requirements_total}`}
          />
          <Tile
            label="Not covered"
            value={`${s.not_covered} of ${s.requirements_total}`}
          />
          <Tile
            label="Planned entries"
            value={String(s.points_total)}
            hint={`${s.distinct_conditions} distinct speed/torque condition${s.distinct_conditions === 1 ? "" : "s"}`}
          />
          <Tile
            label="Planned hold time"
            value={`${s.planned_hold_min} min`}
            hint="scheduled holds only; not total elapsed test time"
          />
          <Tile
            label="Theoretical power range"
            value={`${fixed(s.min_power_kw)} to ${fixed(s.max_power_kw)} kW`}
            hint="from your speed and torque; not measured"
          />
        </dl>
        {s.unmatched_point_ids.length > 0 && (
          <p data-testid="unmatched" className="mt-2 text-xs text-gp-muted">
            Planned entries that match no requirement:{" "}
            {s.unmatched_point_ids.map((id) => names.get(id)).join(", ")}.
          </p>
        )}
        {s.repeated_conditions.length > 0 && (
          <p data-testid="repeated-note" className="mt-2 text-xs text-gp-muted">
            Repeated speed and torque:{" "}
            {s.repeated_conditions
              .map(
                (g) =>
                  `${g.point_ids.map((id) => names.get(id)).join(", ")} (${g.rpm} rpm, ${fixed(g.torque_nm)} N·m)`,
              )
              .join("; ")}
            . Each counts as a separate planned entry but does not add
            distinct-condition coverage.
          </p>
        )}
        <p
          data-testid="plan-explanation"
          className="mt-3 text-sm leading-snug text-gp-muted"
        >
          {result.explanation}
        </p>
      </Panel>

      <Panel testId="diagram" title="Speed-torque planning diagram">
        <PlaneChart result={result} selectedPointId={selectedPointId} />
      </Panel>

      <Panel
        testId="requirements"
        title="Requirement coverage"
        note="Each requirement is judged on the planned entries only. Choose Bound checks to see which bound each point misses."
      >
        <ul aria-label="Requirements" className="space-y-2">
          {result.requirements.map((r, i) => (
            <RequirementCard
              key={r.id}
              requirement={r}
              index={i}
              names={names}
            />
          ))}
        </ul>
      </Panel>

      <Panel
        testId="matrix"
        title="Traceability matrix"
        note="● means the planned point matches the requirement."
      >
        <CoverageMatrix result={result} />
      </Panel>

      <Panel
        testId="timeline"
        title="Ordered plan and planned hold time"
        note="Choose a point to highlight it on the diagram."
      >
        <Timeline
          result={result}
          selectedPointId={selectedPointId}
          onSelect={setSelectedPointId}
        />
      </Panel>

      <Panel
        testId="evidence"
        title="Evidence still required"
        note="None of this has been collected, checked or tracked by GridProof."
      >
        <Checklist result={result} />
      </Panel>

      <details className="rounded-xl border border-gp-line bg-gp-surface p-3">
        <summary className="cursor-pointer text-sm font-medium text-gp-text">
          Assumptions and what this does not model
        </summary>
        <ul className="mt-2 space-y-1.5 text-xs text-gp-muted">
          {result.assumptions.map((a) => (
            <li key={a.id}>
              <span className="font-mono text-gp-faint">{a.id}</span> {a.text}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
