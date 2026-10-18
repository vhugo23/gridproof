"use client";

import { project, MAP_VIEW } from "@/lib/projection";
import type { Facility } from "@/lib/types";
import { BORDERS_PATH, GRATICULE_PATH, LAND_PATH } from "./worldPaths";

type Props = {
  facilities: Facility[];
  /** Facility whose details are shown in the card next to the map. */
  activeId: string | null;
  onActive: (id: string) => void;
  /** Facility id being entered (drives the zoom-in transition). */
  enteringId: string | null;
  onEnter: (facility: Facility) => void;
};

const LABEL_OFFSET: Record<string, { dx: number; anchor: "start" | "end" }> = {
  fridley: { dx: -18, anchor: "end" },
  seymour: { dx: 16, anchor: "start" },
  daventry: { dx: -16, anchor: "end" },
};

function placeLabel(facility: Facility): string {
  return `${facility.city}, ${
    facility.country === "US" ? facility.region : facility.country
  }`;
}

export default function FacilityMap({
  facilities,
  activeId,
  onActive,
  enteringId,
  onEnter,
}: Props) {
  const select = (facility: Facility) => {
    onActive(facility.id);
    if (facility.is_interactive) onEnter(facility);
  };
  const entering = facilities.find((f) => f.id === enteringId) ?? null;
  const enteringPos = entering
    ? project(entering.latitude, entering.longitude)
    : null;

  // Zoom toward the facility being entered.
  const transform = enteringPos
    ? `translate(${enteringPos.x}px, ${enteringPos.y}px) scale(3.2) translate(${-enteringPos.x}px, ${-enteringPos.y}px)`
    : "none";

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-gp-line bg-gp-surface"
      style={{ aspectRatio: `${MAP_VIEW.width} / ${MAP_VIEW.height}` }}
    >
      <svg
        viewBox={`0 0 ${MAP_VIEW.width} ${MAP_VIEW.height}`}
        className="absolute inset-0 h-full w-full"
        role="group"
        aria-label="Map of GridProof facilities"
      >
        <defs>
          <radialGradient id="map-glow" cx="30%" cy="45%" r="70%">
            <stop offset="0%" stopColor="#222831" />
            <stop offset="100%" stopColor="#0b0d10" />
          </radialGradient>
        </defs>
        <rect
          width={MAP_VIEW.width}
          height={MAP_VIEW.height}
          fill="url(#map-glow)"
        />
        <g
          className="gp-view"
          style={{
            transform,
            transformOrigin: "0 0",
            transformBox: "view-box",
            opacity: enteringId ? 0.85 : 1,
          }}
        >
          <path
            d={GRATICULE_PATH}
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.05"
            strokeWidth="0.6"
          />
          <path d={LAND_PATH} fill="#252b34" stroke="none" />
          <path
            d={BORDERS_PATH}
            fill="none"
            stroke="#566070"
            strokeOpacity="0.8"
            strokeWidth="0.6"
          />
          <path
            d={LAND_PATH}
            fill="none"
            stroke="#8794a8"
            strokeOpacity="0.85"
            strokeWidth="0.9"
          />

          {facilities.map((facility) => {
            const { x, y } = project(facility.latitude, facility.longitude);
            const interactive = facility.is_interactive;
            const active = facility.id === activeId;
            const label = LABEL_OFFSET[facility.id] ?? {
              dx: 16,
              anchor: "start" as const,
            };
            return (
              <g
                key={facility.id}
                transform={`translate(${x} ${y})`}
                onMouseEnter={() => onActive(facility.id)}
                onFocus={() => onActive(facility.id)}
              >
                {interactive && (
                  <circle
                    r="8"
                    fill="var(--gp-red)"
                    className="gp-pulse-ring"
                  />
                )}
                {interactive && active && (
                  <circle
                    r="15"
                    fill="none"
                    stroke="var(--gp-red)"
                    strokeWidth="1.5"
                    strokeOpacity="0.7"
                  />
                )}
                <g
                  className="select-none"
                  style={{ opacity: active || interactive ? 1 : 0.85 }}
                >
                  <text
                    x={label.dx}
                    y={interactive ? 0 : 1}
                    textAnchor={label.anchor}
                    className="fill-gp-text text-[13px] font-semibold"
                    stroke="#0b0d10"
                    strokeWidth="3.5"
                    paintOrder="stroke"
                  >
                    {placeLabel(facility)}
                  </text>
                  <text
                    x={label.dx}
                    y={13}
                    textAnchor={label.anchor}
                    className={`text-[9.5px] font-medium tracking-[0.14em] uppercase ${
                      interactive ? "fill-gp-red" : "fill-gp-steel"
                    }`}
                    stroke="#0b0d10"
                    strokeWidth="3"
                    paintOrder="stroke"
                  >
                    {interactive ? "Interactive lab" : "Informational"}
                  </text>
                </g>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`${facility.city} — ${
                    interactive
                      ? "interactive virtual lab"
                      : "informational site"
                  }`}
                  className="cursor-pointer outline-none [&:focus-visible>circle:first-child]:stroke-gp-red"
                  onClick={() => select(facility)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      select(facility);
                    }
                  }}
                >
                  <circle
                    r="14"
                    fill="transparent"
                    stroke="transparent"
                    strokeWidth="2"
                  />
                  {interactive ? (
                    <circle
                      r={active ? 7.5 : 6.5}
                      fill="var(--gp-red)"
                      stroke="#fff"
                      strokeWidth="2.2"
                    />
                  ) : (
                    <circle
                      r="5"
                      fill="var(--gp-bg)"
                      stroke={active ? "#fff" : "var(--gp-steel)"}
                      strokeWidth="2"
                    />
                  )}
                </g>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
