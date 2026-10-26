import type { EnginePlanEvidence, EnginePlanStatus } from "@/lib/types";

// Layout only: every coordinate comes from numbers the server returned. The chart
// calculates nothing about coverage, and it draws no curve, limit or envelope.

const W = 640;
const H = 380;
const M = { left: 58, right: 16, top: 14, bottom: 44 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

export const STATUS_GLYPH: Record<EnginePlanStatus, string> = {
  covered_by_plan: "●",
  partly_covered: "◐",
  not_covered: "○",
};

export const STATUS_TONE: Record<EnginePlanStatus, string> = {
  covered_by_plan: "bg-gp-steel/15 text-gp-text ring-1 ring-gp-steel/60",
  partly_covered: "bg-gp-warn/10 text-gp-text ring-1 ring-gp-warn/60",
  not_covered: "bg-transparent text-gp-muted ring-1 ring-gp-line-strong",
};

// Outline style carries the status as well as the label, so colour is never alone.
const DASH: Record<EnginePlanStatus, string | undefined> = {
  covered_by_plan: undefined,
  partly_covered: "7 4",
  not_covered: "2 4",
};
const STROKE: Record<EnginePlanStatus, string> = {
  covered_by_plan: "var(--gp-steel)",
  partly_covered: "var(--gp-warn)",
  not_covered: "var(--gp-muted)",
};

function niceStep(max: number): number {
  const raw = max / 5;
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * power >= raw) return m * power;
  return 10 * power;
}

function axis(max: number) {
  const step = niceStep(Math.max(max, 1) * 1.05);
  const ticks: number[] = [];
  for (let v = 0; v <= max * 1.05 + step; v += step) {
    ticks.push(v);
    if (v >= max * 1.05) break;
  }
  return { top: ticks[ticks.length - 1], ticks };
}

const format = (n: number) => n.toLocaleString("en-US");

export default function PlaneChart({
  result,
  selectedPointId,
}: {
  result: EnginePlanEvidence;
  selectedPointId: string | null;
}) {
  const { requirements, points } = result;
  const reqInputs = result.inputs.requirements;
  const x = axis(
    Math.max(
      ...points.map((p) => p.rpm),
      ...reqInputs.map((r) => r.rpm_max),
      1,
    ),
  );
  const y = axis(
    Math.max(
      ...points.map((p) => p.torque_nm),
      ...reqInputs.map((r) => r.torque_max_nm),
      1,
    ),
  );
  const px = (rpm: number) => M.left + (rpm / x.top) * PLOT_W;
  const py = (torque: number) => M.top + PLOT_H - (torque / y.top) * PLOT_H;

  const label = `Speed-torque planning diagram with ${requirements.length} requirement regions and ${points.length} planned points numbered in order. The tables below give the same information. It is not an engine map.`;

  return (
    <figure data-testid="plane-chart" className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        className="h-auto w-full rounded-lg border border-gp-line bg-gp-bg"
      >
        <title>{label}</title>
        {x.ticks.map((t) => (
          <g key={`x${t}`}>
            <line
              x1={px(t)}
              x2={px(t)}
              y1={M.top}
              y2={M.top + PLOT_H}
              stroke="#8f99a8"
              strokeOpacity="0.15"
            />
            <text
              x={px(t)}
              y={H - 26}
              textAnchor="middle"
              className="fill-gp-muted text-[11px]"
            >
              {format(t)}
            </text>
          </g>
        ))}
        {y.ticks.map((t) => (
          <g key={`y${t}`}>
            <line
              y1={py(t)}
              y2={py(t)}
              x1={M.left}
              x2={M.left + PLOT_W}
              stroke="#8f99a8"
              strokeOpacity="0.15"
            />
            <text
              x={M.left - 6}
              y={py(t) + 4}
              textAnchor="end"
              className="fill-gp-muted text-[11px]"
            >
              {format(t)}
            </text>
          </g>
        ))}
        <line
          x1={M.left}
          x2={M.left + PLOT_W}
          y1={M.top + PLOT_H}
          y2={M.top + PLOT_H}
          stroke="#9aa1ac"
        />
        <line
          x1={M.left}
          x2={M.left}
          y1={M.top}
          y2={M.top + PLOT_H}
          stroke="#9aa1ac"
        />
        <text
          x={M.left + PLOT_W / 2}
          y={H - 6}
          textAnchor="middle"
          className="fill-gp-muted text-[11px]"
        >
          Speed (rpm)
        </text>
        <text
          transform={`rotate(-90 14 ${M.top + PLOT_H / 2})`}
          x={14}
          y={M.top + PLOT_H / 2}
          textAnchor="middle"
          className="fill-gp-muted text-[11px]"
        >
          Torque (N·m)
        </text>

        {requirements.map((r, i) => {
          const q = reqInputs[i];
          const left = px(q.rpm_min);
          const right = px(q.rpm_max);
          const top = py(q.torque_max_nm);
          const bottom = py(q.torque_min_nm);
          return (
            <g key={r.id} data-region={r.id} data-status={r.status}>
              <rect
                x={left}
                y={top}
                width={Math.max(right - left, 1.5)}
                height={Math.max(bottom - top, 1.5)}
                fill={STROKE[r.status]}
                fillOpacity="0.08"
                stroke={STROKE[r.status]}
                strokeWidth="1.8"
                strokeDasharray={DASH[r.status]}
              />
              <text
                x={left + 4}
                y={top + 12}
                className="fill-gp-text text-[11px] font-semibold"
                stroke="#0b0c0e"
                strokeWidth="3"
                paintOrder="stroke"
              >
                {`R${i + 1}`}
              </text>
            </g>
          );
        })}

        <polyline
          points={points
            .map((p) => `${px(p.rpm)},${py(p.torque_nm)}`)
            .join(" ")}
          fill="none"
          stroke="#e8eaed"
          strokeOpacity="0.6"
          strokeWidth="1.2"
          strokeDasharray="3 3"
        />
        {points.map((p, i) => {
          const selected = selectedPointId === p.id;
          const dim = selectedPointId !== null && !selected;
          return (
            <g
              key={p.id}
              data-point={p.id}
              opacity={dim ? 0.35 : 1}
              transform={`translate(${px(p.rpm)} ${py(p.torque_nm)})`}
            >
              {selected && (
                <circle
                  r="14"
                  fill="none"
                  stroke="var(--gp-red)"
                  strokeWidth="2"
                />
              )}
              <circle r="9" fill="#e8eaed" stroke="#0b0c0e" strokeWidth="1.5" />
              <text
                y="4"
                textAnchor="middle"
                className="fill-gp-bg text-[11px] font-bold"
              >
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1.5 text-[11px] leading-snug text-gp-faint">
        Planned points (numbered in your order) on a speed-torque grid, with
        your requirement regions. Outline: solid = covered by plan, dashed =
        partly covered, dotted = not covered. This is not an engine map: it
        draws no performance curve, limit or operating envelope.
      </figcaption>
    </figure>
  );
}
