import type { EvidenceEventType, StartupCheckEvidence } from "@/lib/types";

export type TimelineRow = {
  key: string;
  label: string;
  evidence: StartupCheckEvidence;
  /** Time of the frame currently shown in the scene, if this row is being played. */
  cursorMs: number | null;
};

const SHORT: Record<EvidenceEventType, string> = {
  utility_outage: "Outage",
  start_generator: "G1 start",
  battery_depleted: "Battery empty",
  g1_ready: "G1 ready",
  g1_transfer_complete: "Transfer",
  horizon_reached: "Horizon",
};

export function fmtSeconds(ms: number): string {
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(3)} s`;
}

function tickStep(end: number): number {
  if (end <= 30_000) return 5_000;
  if (end <= 150_000) return 20_000;
  return 60_000;
}

// Drawn in a compact coordinate space so text stays legible when the pane is narrow.
const W = 360;
const LEFT = 64;
const RIGHT = 12;
const ROW_H = 112;
const TOP = 40;

export default function Timeline({
  rows,
  thresholdMs,
}: {
  rows: TimelineRow[];
  thresholdMs: number;
}) {
  const times = rows.flatMap((r) =>
    r.evidence.events
      .filter((e) => e.type !== "horizon_reached")
      .map((e) => e.at_ms),
  );
  const rawEnd = Math.max(thresholdMs * 1.3, ...times.map((t) => t * 1.1));
  const step = tickStep(rawEnd);
  const end = Math.ceil(rawEnd / step) * step;
  const x = (ms: number) => LEFT + (ms / end) * (W - LEFT - RIGHT);
  const height = TOP + rows.length * ROW_H + 18;
  const ticks = Array.from(
    { length: Math.floor(end / step) + 1 },
    (_, i) => i * step,
  );
  const limitLabelW = 66;

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label="Event timeline for the baseline and modified results"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={x(t)}
            x2={x(t)}
            y1={TOP - 4}
            y2={height - 18}
            stroke="#ffffff"
            strokeOpacity="0.07"
          />
          <text
            x={x(t)}
            y={height - 5}
            textAnchor="middle"
            className="fill-gp-faint font-mono text-[10px]"
          >
            {t / 1000}s
          </text>
        </g>
      ))}

      <line
        x1={x(thresholdMs)}
        x2={x(thresholdMs)}
        y1={TOP - 4}
        y2={height - 18}
        stroke="var(--gp-warn)"
        strokeDasharray="6 4"
        strokeWidth="2.5"
      />
      <rect
        x={x(thresholdMs) - limitLabelW / 2}
        y={4}
        width={limitLabelW}
        height="22"
        rx="5"
        fill="#2b2310"
        stroke="var(--gp-warn)"
        strokeWidth="1.2"
      />
      <text
        x={x(thresholdMs)}
        y={19}
        textAnchor="middle"
        className="fill-gp-warn font-mono text-[12px] font-bold"
      >
        {fmtSeconds(thresholdMs)} limit
      </text>

      {rows.map((row, i) => {
        const y = TOP + i * ROW_H + 58;
        const ready = row.evidence.requirements.find(
          (r) => r.requirement_id === "G1_READY_WITHIN_10S",
        );
        const ok = ready?.status === "pass";
        const start = row.evidence.events.find(
          (e) => e.type === "start_generator",
        );
        const readyEvent = row.evidence.events.find(
          (e) => e.type === "g1_ready",
        );
        // One label per timestamp, so events sharing an instant never crowd.
        const groups: Array<{ at: number; labels: string[] }> = [];
        for (const e of row.evidence.events) {
          if (e.type === "horizon_reached") continue;
          const last = groups[groups.length - 1];
          if (last && last.at === e.at_ms) last.labels.push(SHORT[e.type]);
          else groups.push({ at: e.at_ms, labels: [SHORT[e.type]] });
        }
        return (
          <g key={row.key} data-timeline-row={row.key}>
            <text
              x="4"
              y={y - 2}
              className="fill-gp-text text-[11.5px] font-bold"
            >
              {row.label}
            </text>
            <text
              x="4"
              y={y + 13}
              className="fill-gp-muted font-mono text-[10px]"
            >
              G1 {row.evidence.inputs.g1_startup_delay_s} s
            </text>
            <line
              x1={x(0)}
              x2={x(end)}
              y1={y}
              y2={y}
              stroke="#ffffff"
              strokeOpacity="0.14"
            />
            {start && readyEvent && (
              <rect
                x={x(start.at_ms)}
                y={y - 6}
                width={Math.max(2, x(readyEvent.at_ms) - x(start.at_ms))}
                height="12"
                rx="4"
                fill={ok ? "var(--gp-ok)" : "var(--gp-error)"}
                opacity="0.8"
              />
            )}
            {groups.map((group, k) => {
              const lift = 20 + (k % 2) * 17;
              const anchor =
                group.at === 0
                  ? "start"
                  : x(group.at) > W - 64
                    ? "end"
                    : "middle";
              return (
                <g key={group.at}>
                  <line
                    x1={x(group.at)}
                    x2={x(group.at)}
                    y1={y - 5}
                    y2={y - lift + 3}
                    stroke="var(--gp-line-strong)"
                  />
                  <circle
                    cx={x(group.at)}
                    cy={y}
                    r="5.5"
                    fill="var(--gp-bg)"
                    stroke="var(--gp-text)"
                    strokeWidth="1.8"
                  />
                  <text
                    x={x(group.at)}
                    y={y - lift}
                    textAnchor={anchor}
                    className="fill-gp-text text-[11px]"
                  >
                    {group.labels.join(" · ")}
                  </text>
                  <text
                    x={x(group.at)}
                    y={y + 22}
                    textAnchor={anchor}
                    className="fill-gp-muted font-mono text-[10px]"
                  >
                    {fmtSeconds(group.at)}
                  </text>
                </g>
              );
            })}
            {row.cursorMs !== null && (
              <g data-cursor={row.key}>
                <line
                  x1={x(Math.min(row.cursorMs, end))}
                  x2={x(Math.min(row.cursorMs, end))}
                  y1={y - 38}
                  y2={y + 30}
                  stroke="var(--gp-red)"
                  strokeWidth="2.5"
                />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
