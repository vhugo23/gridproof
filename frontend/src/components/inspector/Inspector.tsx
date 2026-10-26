"use client";

import { useId, useState, type ReactNode } from "react";
import type { SaveIssue } from "@/lib/useWorkspaceConfig";
import type { SystemConfigV1 } from "@/lib/types";
import { ASSET_LABEL, type AssetId } from "../lab/assets";
import EquipmentIllustration, {
  type IllustrationKind,
} from "./EquipmentIllustration";

type Props = {
  asset: AssetId | null;
  config: SystemConfigV1;
  fieldErrors: Record<string, string>;
  onChange: (update: (current: SystemConfigV1) => SystemConfigV1) => void;
};

function Badge({ editable }: { editable: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase ${
        editable
          ? "bg-gp-red/20 text-gp-red-text ring-1 ring-gp-red/40"
          : "bg-gp-surface-2 text-gp-faint ring-1 ring-gp-line"
      }`}
    >
      {editable ? "Editable" : "Fixed"}
    </span>
  );
}

function FixedRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gp-line py-2.5 text-sm">
      <span className="text-gp-muted">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-gp-text">{value}</span>
        <Badge editable={false} />
      </span>
    </div>
  );
}

function NumberField({
  label,
  unit,
  value,
  error,
  onCommit,
}: {
  label: string;
  unit: string;
  value: number;
  error?: string;
  onCommit: (value: number) => void;
}) {
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? String(value);
  const invalid =
    text !== null && text.trim() !== "" && !Number.isFinite(Number(text));
  return (
    <div className="border-b border-gp-line py-2.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm text-gp-muted">
          {label}
        </label>
        <span className="flex items-center gap-2">
          <input
            id={id}
            inputMode="decimal"
            value={shown}
            aria-invalid={Boolean(error) || invalid}
            aria-describedby={error ? `${id}-err` : undefined}
            onChange={(event) => {
              const raw = event.target.value;
              setText(raw);
              if (raw.trim() !== "" && Number.isFinite(Number(raw))) {
                onCommit(Number(raw));
              }
            }}
            onBlur={() => setText(null)}
            className={`w-20 rounded-md border bg-gp-bg px-2 py-1 text-right font-mono text-sm text-gp-text ${
              error || invalid ? "border-gp-error" : "border-gp-line-strong"
            }`}
          />
          <span className="w-6 text-xs text-gp-faint">{unit}</span>
          <Badge editable />
        </span>
      </div>
      {(error || invalid) && (
        <p
          id={`${id}-err`}
          role="alert"
          className="mt-1.5 text-right text-xs text-gp-error"
        >
          {error ?? "Enter a number."}
        </p>
      )}
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gp-line py-2.5">
      <label htmlFor={id} className="text-sm text-gp-muted">
        {label}
      </label>
      <span className="flex items-center gap-2">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 accent-[var(--gp-red)]"
        />
        <Badge editable />
      </span>
    </div>
  );
}

function Section({
  title,
  subtitle,
  illustration,
  children,
}: {
  title: string;
  subtitle: string;
  illustration?: IllustrationKind;
  children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <h2 className="text-base font-semibold text-gp-text">{title}</h2>
      <p className="mb-2 text-xs text-gp-faint">{subtitle}</p>
      {illustration && <EquipmentIllustration kind={illustration} />}
      {children}
    </section>
  );
}

export default function Inspector({
  asset,
  config,
  fieldErrors,
  onChange,
}: Props) {
  const eq = config.equipment;

  if (!asset) {
    return (
      <div className="rounded-lg border border-dashed border-gp-line-strong p-5 text-sm text-gp-muted">
        <p className="font-medium text-gp-text">Select equipment</p>
        <p className="mt-1">
          Click a unit in the lab, for example <strong>Generator G1</strong>, to
          inspect and edit its configuration.
        </p>
      </div>
    );
  }

  if (asset === "g1" || asset === "g2") {
    const key = asset;
    const g = eq[key];
    const setGen = (patch: Partial<typeof g>) =>
      onChange((c) => ({
        ...c,
        equipment: { ...c.equipment, [key]: { ...c.equipment[key], ...patch } },
      }));
    return (
      <Section
        title={ASSET_LABEL[asset]}
        subtitle="Synthetic generator set for the virtual lab."
        illustration="generator"
      >
        <FixedRow label="Rated output" value={`${g.rated_kw} kW`} />
        <NumberField
          label="Startup delay"
          unit="s"
          value={g.startup_delay_s}
          error={fieldErrors[`equipment.${key}.startup_delay_s`]}
          onCommit={(v) => setGen({ startup_delay_s: v })}
        />
        <ToggleField
          label="Enabled"
          checked={g.enabled}
          onChange={(v) => setGen({ enabled: v })}
        />
        <p className="mt-3 text-xs text-gp-faint">
          Valid range 0–120 s, whole seconds. The server validates every save.
        </p>
      </Section>
    );
  }

  if (asset === "battery") {
    return (
      <Section
        title={ASSET_LABEL.battery}
        subtitle="Synthetic battery energy storage system."
        illustration="battery"
      >
        <FixedRow
          label="Inverter rating"
          value={`${eq.battery.inverter_kw} kW`}
        />
        <FixedRow
          label="Usable energy"
          value={`${eq.battery.usable_kwh} kWh`}
        />
        <FixedRow label="Minimum SoC" value={`${eq.battery.min_soc_pct} %`} />
        <NumberField
          label="Initial SoC"
          unit="%"
          value={eq.battery.initial_soc_pct}
          error={fieldErrors["equipment.battery.initial_soc_pct"]}
          onCommit={(v) =>
            onChange((c) => ({
              ...c,
              equipment: {
                ...c.equipment,
                battery: { ...c.equipment.battery, initial_soc_pct: v },
              },
            }))
          }
        />
      </Section>
    );
  }

  if (asset === "load") {
    return (
      <Section title={ASSET_LABEL.load} subtitle="Synthetic critical load bus.">
        <NumberField
          label="Critical load"
          unit="kW"
          value={eq.load.critical_kw}
          error={fieldErrors["equipment.load.critical_kw"]}
          onCommit={(v) =>
            onChange((c) => ({
              ...c,
              equipment: {
                ...c.equipment,
                load: { ...c.equipment.load, critical_kw: v },
              },
            }))
          }
        />
      </Section>
    );
  }

  if (asset === "utility") {
    return (
      <Section title={ASSET_LABEL.utility} subtitle="Synthetic utility source.">
        <FixedRow
          label="Availability"
          value={eq.utility.available ? "Available" : "Unavailable"}
        />
      </Section>
    );
  }

  return (
    <Section
      title={ASSET_LABEL.switchgear}
      subtitle="Synthetic paralleling and transfer switchgear."
      illustration="switchgear"
    >
      <FixedRow label="Operating mode" value={eq.switchgear.mode} />
    </Section>
  );
}

export function SavePanel({
  versionLabel,
  dirty,
  saving,
  saved,
  issue,
  onSave,
  onReload,
  onRecover,
}: {
  versionLabel: string;
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  issue: SaveIssue | null;
  onSave: () => void;
  onReload: () => void;
  onRecover: () => void;
}) {
  return (
    <div className="mt-5 rounded-lg border border-gp-line bg-gp-surface-2 p-4">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gp-muted">Saved configuration</span>
        <span className="font-mono text-gp-text">{versionLabel}</span>
      </div>
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || saving || issue?.kind === "session"}
        className="mt-3 w-full rounded-md bg-gp-red px-3 py-2 text-sm font-semibold text-white transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-gp-line-strong disabled:text-gp-faint"
      >
        {saving ? "Saving…" : "Save as new version"}
      </button>
      <div className="mt-2 min-h-5 text-xs" role="status" aria-live="polite">
        {saved && !dirty && !issue && (
          <p className="text-gp-ok">Saved and confirmed from the server.</p>
        )}
        {dirty && !issue && !saving && (
          <p className="text-gp-warn">Unsaved changes.</p>
        )}
      </div>
      {issue && (
        <div
          role="alert"
          className="mt-2 rounded-md border border-gp-error/40 bg-gp-error/10 p-3 text-xs text-gp-text"
        >
          <p className="font-medium text-gp-error">
            {issue.kind === "validation"
              ? "The server rejected these values."
              : issue.kind === "conflict"
                ? "Version conflict"
                : issue.kind === "session"
                  ? "Session expired"
                  : issue.kind === "unavailable"
                    ? "API unavailable"
                    : issue.kind === "server"
                      ? "Server error"
                      : "Save failed"}
          </p>
          <p className="mt-1 text-gp-muted">
            {issue.kind === "validation"
              ? "Fix the highlighted fields. Your edits are kept."
              : issue.message}
            {issue.kind === "conflict" &&
              issue.currentVersion !== null &&
              ` Server is at v${issue.currentVersion}.`}
          </p>
          <div className="mt-2 flex gap-2">
            {issue.kind === "conflict" && (
              <button
                type="button"
                onClick={onReload}
                className="rounded border border-gp-line-strong px-2 py-1 hover:bg-gp-surface"
              >
                Discard my edits &amp; reload
              </button>
            )}
            {issue.kind === "session" && (
              <button
                type="button"
                onClick={onRecover}
                className="rounded border border-gp-line-strong px-2 py-1 hover:bg-gp-surface"
              >
                Start new session (keep edits)
              </button>
            )}
            {(issue.kind === "unavailable" || issue.kind === "server") && (
              <button
                type="button"
                onClick={onSave}
                className="rounded border border-gp-line-strong px-2 py-1 hover:bg-gp-surface"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
