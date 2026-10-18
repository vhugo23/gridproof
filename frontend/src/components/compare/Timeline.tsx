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
  start_generator: "Start G1",
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

const W = 760;
const LEFT = 120;
const RIGHT = 20;
const ROW_H = 96;
const TOP = 28;

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
  const height = TOP + rows.length * ROW_H + 24;
  const ticks = Array.from(
    { length: Math.floor(end / step) + 1 },
    (_, i) => i * step,
  );

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
            y1={TOP - 6}
            y2={height - 22}
            stroke="#ffffff"
            strokeOpacity="0.07"
          />
          <text
            x={x(t)}
            y={height - 8}
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
        y1={TOP - 12}
        y2={height - 22}
        stroke="var(--gp-warn)"
        strokeDasharray="5 4"
        strokeWidth="1.5"
      />
      <text
        x={x(thresholdMs) + 5}
        y={TOP - 14}
        className="fill-gp-warn font-mono text-[10px]"
      >
        {fmtSeconds(thresholdMs)} limit
      </text>

      {rows.map((row, i) => {
        const y = TOP + i * ROW_H + 40;
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
        const byTime = new Map<number, string[]>();
        for (const e of row.evidence.events) {
          if (e.type === "horizon_reached") continue;
          byTime.set(e.at_ms, [...(byTime.get(e.at_ms) ?? []), SHORT[e.type]]);
        }
        return (
          <g key={row.key} data-timeline-row={row.key}>
            <text
              x="8"
              y={y + 4}
              className="fill-gp-text text-[12px] font-semibold"
            >
              {row.label}
            </text>
            <text
              x="8"
              y={y + 18}
              className="fill-gp-faint font-mono text-[10px]"
            >
              G1 {row.evidence.inputs.g1_startup_delay_s} s start
            </text>
            <line
              x1={x(0)}
              x2={x(end)}
              y1={y}
              y2={y}
              stroke="#ffffff"
              strokeOpacity="0.12"
            />
            {start && readyEvent && (
              <rect
                x={x(start.at_ms)}
                y={y - 5}
                width={Math.max(2, x(readyEvent.at_ms) - x(start.at_ms))}
                height="10"
                rx="3"
                fill={ok ? "var(--gp-ok)" : "var(--gp-error)"}
                opacity="0.75"
              />
            )}
            {[...byTime.entries()].map(([at, labels]) => (
              <g key={at}>
                <circle
                  cx={x(at)}
                  cy={y}
                  r="5"
                  fill="var(--gp-bg)"
                  stroke="var(--gp-text)"
                  strokeWidth="1.5"
                />
                {labels.map((label, k) => (
                  <text
                    key={label}
                    x={Math.min(x(at) + 2, W - 60)}
                    y={y - 14 - k * 12}
                    textAnchor={at === 0 ? "start" : "middle"}
                    className="fill-gp-muted text-[10px]"
                  >
                    {label}
                  </text>
                ))}
                <text
                  x={x(at)}
                  y={y + 22}
                  textAnchor={at === 0 ? "start" : "middle"}
                  className="fill-gp-faint font-mono text-[9px]"
                >
                  {fmtSeconds(at)}
                </text>
              </g>
            ))}
            {row.cursorMs !== null && (
              <g data-cursor={row.key}>
                <line
                  x1={x(Math.min(row.cursorMs, end))}
                  x2={x(Math.min(row.cursorMs, end))}
                  y1={y - 30}
                  y2={y + 30}
                  stroke="var(--gp-red)"
                  strokeWidth="2"
                />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
