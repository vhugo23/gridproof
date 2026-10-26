import type { MobilePowerCategory, MobilePowerEvidence } from "@/lib/types";

// Display formatting only: every value comes from the backend response.
export const fixed = (n: number) => n.toFixed(2);

export const CATEGORY_GLYPH: Record<MobilePowerCategory, string> = {
  does_not_meet_modeled: "✕",
  meets_modeled_only: "◐",
  meets_modeled_and_all_simultaneous: "●",
};

export const CATEGORY_TONE: Record<MobilePowerCategory, string> = {
  does_not_meet_modeled: "bg-gp-error/15 text-gp-error ring-1 ring-gp-error/40",
  meets_modeled_only: "bg-gp-warn/15 text-gp-warn ring-1 ring-gp-warn/40",
  meets_modeled_and_all_simultaneous:
    "bg-gp-ok/15 text-gp-ok ring-1 ring-gp-ok/40",
};

// Layout only: where a value sits on the drawn scale. Verdicts and every number
// shown come from the server; nothing here decides whether a package meets a
// requirement.
const position = (value: number, max: number) =>
  `${Math.min(100, Math.max(0, (value / max) * 100))}%`;

// Labels near the right edge are anchored by their right side so the label box
// itself stays on the drawing (a shifted inner element would still widen the page).
function place(value: number, max: number) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  if (pct > 72)
    return {
      style: { right: `${100 - pct}%` },
      align: "text-right",
      side: "r",
    };
  if (pct < 28)
    return { style: { left: `${pct}%` }, align: "text-left", side: "l" };
  return {
    style: { left: `${pct}%` },
    align: "-translate-x-1/2 text-center",
    side: "c",
  };
}

/**
 * One kW scale: solid fill to the required capacity, a hatched band to the
 * all-simultaneous requirement, a tick for each synthetic package rating. The
 * drawing is decorative (aria-hidden); the caption and the package cards carry
 * the same information as text.
 */
export default function CapacityLadder({
  result,
}: {
  result: MobilePowerEvidence;
}) {
  const { required_kw: required, all_simultaneous_required_kw: bound } =
    result.totals;
  const topRating = Math.max(...result.packages.map((p) => p.rated_kw));
  // Headroom on the right so the largest marker and its label stay on the drawing.
  const max = Math.max(topRating, bound) * 1.08;

  return (
    <figure
      data-testid="capacity-ladder"
      className="rounded-xl border border-gp-line bg-gp-surface p-3"
    >
      <h2 className="text-sm font-semibold tracking-wider text-gp-text uppercase">
        Capacity ladder
      </h2>
      <p className="text-[11px] text-gp-faint">
        Requirements and package ratings on one kW scale. Orientation only; the
        server compares the exact values.
      </p>

      <div aria-hidden className="mt-3">
        <div className="relative h-12">
          {[
            {
              key: "required",
              value: required,
              label: "Required",
              tone: "text-gp-text",
              pos: "top-0",
            },
            {
              key: "bound",
              value: bound,
              label: "All simultaneous",
              tone: "text-gp-muted",
              pos: "bottom-0",
            },
          ].map(({ key, value, label, tone, pos }) => {
            const spot = place(value, max);
            return (
              <div
                key={key}
                className={`absolute ${pos} text-[11px] leading-tight whitespace-nowrap ${tone} ${spot.align}`}
                style={spot.style}
              >
                {label}
                <br />
                <span className="font-mono">{fixed(value)} kW</span>
              </div>
            );
          })}
        </div>

        <div className="relative h-5 rounded-full bg-gp-line">
          <div
            data-marker="required-fill"
            className="absolute inset-y-0 left-0 rounded-l-full bg-gp-steel"
            style={{ width: position(required, max) }}
          />
          <div
            data-marker="simultaneity-band"
            className="absolute inset-y-0"
            style={{
              left: position(required, max),
              width: `${Math.max(0, ((bound - required) / max) * 100)}%`,
              backgroundImage:
                "repeating-linear-gradient(135deg, var(--gp-steel) 0 2px, transparent 2px 6px)",
            }}
          />
          {result.packages.map((p) => (
            <div
              key={p.id}
              data-tick={p.id}
              className="absolute -top-1 -bottom-1 w-0.5 bg-gp-text"
              style={{ left: position(p.rated_kw, max) }}
            />
          ))}
        </div>

        <div className="relative mt-1 h-24">
          {result.packages.map((p, i) => (
            <div
              key={`${p.id}-leader`}
              className="absolute top-0 w-px bg-gp-line-strong"
              style={{
                left: position(p.rated_kw, max),
                height: `${i * 22 + 14}px`,
              }}
            />
          ))}
          {result.packages.map((p, i) => {
            const rightSide = (p.rated_kw / max) * 100 > 60;
            return (
              <div
                key={p.id}
                className={`absolute text-[11px] leading-tight whitespace-nowrap text-gp-text ${
                  rightSide
                    ? "border-r pr-1 text-right"
                    : "border-l pl-1 text-left"
                } border-gp-line-strong`}
                style={{
                  ...(rightSide
                    ? { right: `${100 - (p.rated_kw / max) * 100}%` }
                    : { left: position(p.rated_kw, max) }),
                  top: `${i * 22}px`,
                }}
              >
                <span className="font-semibold">
                  {CATEGORY_GLYPH[p.category]}{" "}
                  {p.label.replace(/^Synthetic Mobile Package /, "")}
                </span>{" "}
                <span className="font-mono text-gp-muted">
                  {fixed(p.rated_kw)} kW
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <ul
        className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gp-muted"
        aria-label="Ladder key"
      >
        <li>
          <span
            aria-hidden
            className="mr-1 inline-block h-2 w-4 rounded-sm bg-gp-steel align-middle"
          />
          Up to the required capacity (modeled demand plus margin)
        </li>
        <li>
          <span
            aria-hidden
            className="mr-1 inline-block h-2 w-4 rounded-sm align-middle"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, var(--gp-steel) 0 2px, transparent 2px 6px)",
            }}
          />
          Extra needed if every load ran at once
        </li>
        <li>
          ● meets both · ◐ meets modeled demand only · ✕ does not meet modeled
          demand
        </li>
      </ul>

      <figcaption className="mt-2 text-[11px] leading-snug text-gp-faint">
        Scale in kW: required capacity {fixed(required)} kW, all-simultaneous
        requirement {fixed(bound)} kW; package ratings{" "}
        {result.packages.map((p) => fixed(p.rated_kw)).join(", ")} kW. Ticks are
        listed by rating, not ranked.
      </figcaption>
    </figure>
  );
}
