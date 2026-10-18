"use client";

import type {
  ComparisonError,
  ComparisonResult,
  ComparisonStatus,
} from "@/lib/useStartupComparison";
import type { EvidenceRequirement, StartupCheckEvidence } from "@/lib/types";
import Timeline, { fmtSeconds } from "./Timeline";

export type Side = "baseline" | "modified";

type Playback = {
  side: Side;
  onSide: (side: Side) => void;
  index: number | null;
  playing: boolean;
  onIndex: (index: number | null) => void;
  onPlay: () => void;
  onPause: () => void;
};

type Props = {
  status: ComparisonStatus;
  result: ComparisonResult | null;
  error: ComparisonError | null;
  /** Latest saved version number, to flag results that are out of date. */
  latestVersion: number | null;
  /** Whether the lab scene is on screen to show playback frames. */
  sceneAvailable: boolean;
  /** Why the live test cannot run right now, or null if it can. */
  blockedReason: string | null;
  onRun: () => void;
  onShowRecorded: () => void;
  onClear: () => void;
  playback: Playback;
};

function Badge({
  status,
  large = false,
}: {
  status: "pass" | "fail";
  large?: boolean;
}) {
  return (
    <span
      className={`rounded font-bold tracking-wider ${
        large ? "px-3 py-1 text-xl" : "px-2 py-0.5 text-[11px]"
      } ${
        status === "pass"
          ? "bg-gp-ok/15 text-gp-ok ring-1 ring-gp-ok/40"
          : "bg-gp-error/15 text-gp-error ring-1 ring-gp-error/40"
      }`}
    >
      {status === "pass" ? "PASS" : "FAIL"}
    </span>
  );
}

function requirementView(r: EvidenceRequirement): {
  title: string;
  detail: string;
} {
  if (r.type === "asset_ready_within") {
    return {
      title: `G1 ready within ${fmtSeconds(r.threshold)}`,
      detail:
        r.observed === null
          ? `G1 never became ready · limit ${fmtSeconds(r.threshold)}`
          : `Ready ${fmtSeconds(r.observed)} after the outage · limit ${fmtSeconds(r.threshold)}`,
    };
  }
  return {
    title: "Critical load continuity",
    detail: `Unserved energy ${r.observed ?? "—"} kWh · limit ${r.threshold} kWh`,
  };
}

function ResultCard({
  label,
  evidence,
  active,
  onPlay,
}: {
  label: string;
  evidence: StartupCheckEvidence;
  active: boolean;
  onPlay: () => void;
}) {
  const m = evidence.metrics;
  const readiness = evidence.requirements.find(
    (r) => r.type === "asset_ready_within",
  );
  const accent =
    readiness?.status === "pass"
      ? "border-t-gp-ok"
      : readiness?.status === "fail"
        ? "border-t-gp-error"
        : "border-t-gp-line";
  return (
    <article
      aria-label={label}
      className={`flex min-w-0 flex-col rounded-xl border border-t-4 bg-gp-surface-2 p-3 ${accent} ${
        active ? "border-x-gp-red/60 border-b-gp-red/60" : "border-gp-line"
      }`}
    >
      <header>
        <h3 className="text-[13px] font-semibold text-gp-text">{label}</h3>
        <span className="font-mono text-[11px] text-gp-muted">
          G1 startup {evidence.inputs.g1_startup_delay_s} s
        </span>
      </header>

      <ul className="mt-2 space-y-2">
        {evidence.requirements.map((r) => {
          const view = requirementView(r);
          const primary = r.type === "asset_ready_within";
          return (
            <li
              key={r.requirement_id}
              data-requirement={r.requirement_id}
              data-status={r.status}
              className="rounded-lg border border-gp-line bg-gp-bg/60 p-2.5"
            >
              <p className="text-xs text-gp-text">{view.title}</p>
              <div className={primary ? "my-1.5" : "my-1"}>
                <Badge status={r.status} large={primary} />
              </div>
              <p className="text-[11px] leading-snug text-gp-muted">
                {view.detail}
              </p>
            </li>
          );
        })}
      </ul>

      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 text-[11px]">
        <dt className="text-gp-muted">G1 ready time</dt>
        <dd className="text-right font-mono text-gp-text">
          {m.g1_ready_ms === null ? "never" : fmtSeconds(m.g1_ready_ms)}
        </dd>
        <dt className="text-gp-muted">Battery bridge</dt>
        <dd className="text-right font-mono text-gp-text">
          {m.battery_bridge_energy_kwh} kWh
        </dd>
        <dt className="text-gp-muted">Unserved</dt>
        <dd className="text-right font-mono text-gp-text">
          {m.unserved_energy_kwh} kWh
        </dd>
        <dt className="text-gp-muted">SoC at end</dt>
        <dd className="text-right font-mono text-gp-text">
          {m.battery_soc_end_pct} %
        </dd>
      </dl>

      <button
        type="button"
        onClick={onPlay}
        className="mt-3 w-full rounded-md border border-gp-line-strong px-2 py-1.5 text-xs text-gp-text transition hover:bg-gp-surface"
      >
        ▶ Play {label.split(" ")[0].toLowerCase()} in the lab
      </button>
    </article>
  );
}

export default function ComparePanel({
  status,
  result,
  error,
  latestVersion,
  sceneAvailable,
  blockedReason,
  onRun,
  onShowRecorded,
  onClear,
  playback,
}: Props) {
  const running = status === "running";
  const rows = result
    ? result.sameVersion
      ? [{ key: "baseline" as const, evidence: result.baseline }]
      : [
          { key: "baseline" as const, evidence: result.baseline },
          { key: "modified" as const, evidence: result.modified },
        ]
    : [];
  const labelFor = (side: Side, evidence: StartupCheckEvidence) =>
    result?.sameVersion
      ? `Baseline · v${evidence.source.version_number} (current)`
      : side === "baseline"
        ? `Baseline · v${evidence.source.version_number}`
        : `Modified · v${evidence.source.version_number}`;

  const played = result ? result[playback.side] : null;
  const frame =
    played && playback.index !== null ? played.frames[playback.index] : null;
  const frameEvent =
    frame && played ? played.events.find((e) => e.id === frame.event_id) : null;
  const stale =
    result?.mode === "live" &&
    latestVersion !== null &&
    result.modified.source.version_number !== latestVersion;
  const threshold =
    result?.baseline.requirements.find((r) => r.type === "asset_ready_within")
      ?.threshold ?? 10_000;

  return (
    <section aria-labelledby="compare-title" className="space-y-3">
      <div>
        <h2 id="compare-title" className="text-base font-semibold text-gp-text">
          Utility-outage startup test
        </h2>
        <p className="mt-0.5 text-xs leading-snug text-gp-muted">
          The utility is lost and only G1 is commanded to start. Does G1 become
          ready within 10 s, and does the critical load stay served? Simulated
          from your saved versions.
        </p>
      </div>

      {status === "idle" && !result && (
        <p className="rounded-lg border border-dashed border-gp-line-strong p-3 text-xs text-gp-muted">
          No results yet. Use <strong>Run Utility-Outage Test</strong> above, or{" "}
          <strong>Show recorded demo</strong> for a labeled pre-generated
          example.
        </p>
      )}

      {status === "error" && error && (
        <div
          role="alert"
          data-error-kind={error.kind}
          className="rounded-lg border border-gp-error/40 bg-gp-error/10 p-3 text-sm"
        >
          <p className="font-medium text-gp-error">
            The live test could not run
          </p>
          <p className="mt-1 text-xs text-gp-muted">{error.message}</p>
          <div className="mt-2 flex gap-2 text-xs">
            <button
              type="button"
              onClick={onRun}
              disabled={blockedReason !== null}
              className="rounded border border-gp-line-strong px-2 py-1 hover:bg-gp-surface disabled:opacity-50"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={onShowRecorded}
              className="rounded border border-gp-line-strong px-2 py-1 hover:bg-gp-surface"
            >
              Show recorded demo instead
            </button>
          </div>
        </div>
      )}

      {running && (
        <p role="status" className="text-sm text-gp-muted">
          Running the test on your saved versions…
        </p>
      )}

      {result && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {result.mode === "live" ? (
              <span
                data-mode="live"
                className="rounded bg-gp-ok/15 px-2 py-1 text-[10px] font-bold tracking-wider text-gp-ok ring-1 ring-gp-ok/40"
              >
                LIVE · SIMULATED FROM YOUR SAVED VERSIONS
              </span>
            ) : (
              <span
                data-mode="recorded"
                className="rounded bg-gp-warn/15 px-2 py-1 text-[10px] font-bold tracking-wider text-gp-warn ring-1 ring-gp-warn/40"
              >
                RECORDED DEMO · NOT A LIVE RUN
              </span>
            )}
            <button
              type="button"
              onClick={onClear}
              className="ml-auto text-[11px] text-gp-muted underline hover:text-gp-text"
            >
              Clear results
            </button>
          </div>
          <p className="text-[11px] text-gp-faint">
            {result.mode === "recorded"
              ? "Pre-generated by the verified simulator for a 5 s versus a 15 s G1 startup. Your configuration was not used."
              : "Synthetic, simplified model. Not Cummins equipment data."}
          </p>

          {stale && (
            <p role="status" className="text-xs text-gp-warn">
              These results are for v{result.modified.source.version_number};
              the latest saved version is v{latestVersion}. Run the test again.
            </p>
          )}
          {result.sameVersion && (
            <p
              data-note="same-version"
              className="rounded-lg border border-gp-line-strong bg-gp-bg/60 p-2.5 text-xs text-gp-muted"
            >
              Only version 1 exists, so the baseline and your current
              configuration are the same saved version. There is nothing to
              compare yet: change the G1 startup delay, save a new version, and
              run the test again.
            </p>
          )}

          <div
            className={`grid gap-3 ${result.sameVersion ? "" : "grid-cols-2"}`}
          >
            {rows.map((row) => (
              <ResultCard
                key={row.key}
                label={labelFor(row.key, row.evidence)}
                evidence={row.evidence}
                active={playback.index !== null && playback.side === row.key}
                onPlay={() => {
                  playback.onSide(row.key);
                  playback.onPlay();
                }}
              />
            ))}
          </div>

          <div className="rounded-xl border border-gp-line bg-gp-bg/40 p-3">
            <h3 className="mb-1 text-[13px] font-semibold text-gp-text">
              Event timeline
            </h3>
            <Timeline
              thresholdMs={threshold}
              rows={rows.map((row) => ({
                key: row.key,
                label: labelFor(row.key, row.evidence).split(" · ")[0],
                evidence: row.evidence,
                cursorMs:
                  playback.index !== null && playback.side === row.key && frame
                    ? frame.at_ms
                    : null,
              }))}
            />
          </div>

          {sceneAvailable && (
            <div className="rounded-xl border border-gp-line bg-gp-bg/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="mr-auto text-[13px] font-semibold text-gp-text">
                  Playback in the lab
                </h3>
                {!result.sameVersion && (
                  <div
                    role="group"
                    aria-label="Result to play"
                    className="flex gap-1"
                  >
                    {(["baseline", "modified"] as const).map((side) => (
                      <button
                        key={side}
                        type="button"
                        aria-pressed={playback.side === side}
                        onClick={() => playback.onSide(side)}
                        className={`rounded px-2 py-1 text-xs ${
                          playback.side === side
                            ? "bg-gp-red text-white"
                            : "border border-gp-line-strong text-gp-muted"
                        }`}
                      >
                        {side === "baseline" ? "Baseline" : "Modified"}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={
                    playback.playing ? playback.onPause : playback.onPlay
                  }
                  className="rounded border border-gp-line-strong px-2.5 py-1 text-xs text-gp-text hover:bg-gp-surface"
                >
                  {playback.playing ? "❚❚ Pause" : "▶ Play"}
                </button>
                <button
                  type="button"
                  onClick={() => playback.onIndex(null)}
                  disabled={playback.index === null}
                  className="rounded border border-gp-line-strong px-2.5 py-1 text-xs text-gp-muted hover:bg-gp-surface disabled:opacity-40"
                >
                  Show configured view
                </button>
              </div>
              {played && (
                <>
                  <input
                    type="range"
                    aria-label="Evidence frame"
                    min={0}
                    max={played.frames.length - 1}
                    step={1}
                    value={playback.index ?? 0}
                    onFocus={() => {
                      if (playback.index === null) playback.onIndex(0);
                    }}
                    onPointerDown={() => {
                      if (playback.index === null) playback.onIndex(0);
                    }}
                    onChange={(event) =>
                      playback.onIndex(Number(event.target.value))
                    }
                    className="mt-2 w-full accent-[var(--gp-red)]"
                  />
                  <p
                    className="mt-1 text-[11px] text-gp-muted"
                    data-testid="frame-caption"
                  >
                    {frame && frameEvent
                      ? `Frame ${(playback.index ?? 0) + 1} of ${played.frames.length} · ${fmtSeconds(frame.at_ms)} · ${frameEvent.description}`
                      : "Drag the slider or press Play to step through the simulator's evidence frames. The lab shows each frame."}
                  </p>
                </>
              )}
            </div>
          )}

          <details className="rounded-xl border border-gp-line bg-gp-bg/40 p-3">
            <summary className="cursor-pointer text-[13px] font-semibold text-gp-text">
              Event log
            </summary>
            <div className="mt-2 space-y-3">
              {rows.map((row) => (
                <table key={row.key} className="w-full text-left text-[11px]">
                  <caption className="mb-1 text-left font-medium text-gp-muted">
                    {labelFor(row.key, row.evidence)} events
                  </caption>
                  <tbody>
                    {row.evidence.events.map((e) => (
                      <tr key={e.id} className="border-t border-gp-line">
                        <td className="py-1 pr-3 font-mono whitespace-nowrap text-gp-text">
                          {fmtSeconds(e.at_ms)}
                        </td>
                        <td className="py-1 text-gp-muted">{e.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
          </details>

          <details className="rounded-xl border border-gp-line bg-gp-bg/40 p-3">
            <summary className="cursor-pointer text-[13px] font-semibold text-gp-text">
              Simulation assumptions ({result.baseline.assumptions.length})
            </summary>
            <p className="mt-2 text-[11px] text-gp-faint">
              Model {result.baseline.model_version} · horizon{" "}
              {fmtSeconds(result.baseline.scenario.horizon_ms)} · listed exactly
              as returned by the simulator.
            </p>
            <ol className="mt-2 space-y-1.5 text-[11px] text-gp-muted">
              {result.baseline.assumptions.map((a) => (
                <li key={a.id} className="flex gap-2">
                  <span className="font-mono text-gp-faint">{a.id}</span>
                  <span>{a.text}</span>
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </section>
  );
}
