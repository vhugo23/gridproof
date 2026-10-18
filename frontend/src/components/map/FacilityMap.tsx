"use client";

import { useState } from "react";
import { project, MAP_VIEW } from "@/lib/projection";
import type { Facility } from "@/lib/types";
import { BORDERS_PATH, GRATICULE_PATH, LAND_PATH } from "./worldPaths";

type Props = {
  facilities: Facility[];
  /** Facility id being entered (drives the zoom-in transition). */
  enteringId: string | null;
  onEnter: (facility: Facility) => void;
};

const LABEL_OFFSET: Record<string, { dx: number; anchor: "start" | "end" }> = {
  fridley: { dx: -16, anchor: "end" },
  seymour: { dx: 16, anchor: "start" },
  daventry: { dx: -16, anchor: "end" },
};

export default function FacilityMap({
  facilities,
  enteringId,
  onEnter,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>("fridley");
  const select = (facility: Facility) => {
    setActiveId(facility.id);
    if (facility.is_interactive) onEnter(facility);
  };
  const active = facilities.find((f) => f.id === activeId) ?? null;
  const activePos = active ? project(active.latitude, active.longitude) : null;
  const entering = facilities.find((f) => f.id === enteringId) ?? null;
  const enteringPos = entering
    ? project(entering.latitude, entering.longitude)
    : null;

  // Zoom toward the facility being entered.
  const transform = enteringPos
    ? `translate(${enteringPos.x}px, ${enteringPos.y}px) scale(3.2) translate(${-enteringPos.x}px, ${-enteringPos.y}px)`
    : "none";

  return (
    <div className="relative mx-auto w-full max-w-[1200px]">
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
              <stop offset="0%" stopColor="#1e232b" />
              <stop offset="100%" stopColor="#0c0e11" />
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
              strokeOpacity="0.045"
              strokeWidth="0.6"
            />
            <path d={LAND_PATH} fill="#1d2127" stroke="none" />
            <path
              d={BORDERS_PATH}
              fill="none"
              stroke="#3a414c"
              strokeWidth="0.5"
            />
            <path
              d={LAND_PATH}
              fill="none"
              stroke="#4b5360"
              strokeWidth="0.6"
            />

            {facilities.map((facility) => {
              const { x, y } = project(facility.latitude, facility.longitude);
              const interactive = facility.is_interactive;
              const label = LABEL_OFFSET[facility.id] ?? {
                dx: 16,
                anchor: "start" as const,
              };
              return (
                <g
                  key={facility.id}
                  transform={`translate(${x} ${y})`}
                  onMouseEnter={() => setActiveId(facility.id)}
                  onFocus={() => setActiveId(facility.id)}
                >
                  {interactive && (
                    <circle
                      r="7"
                      fill="var(--gp-red)"
                      className="gp-pulse-ring"
                    />
                  )}
                  <text
                    x={label.dx}
                    y="4"
                    textAnchor={label.anchor}
                    className="select-none fill-gp-text text-[11px] font-medium"
                    style={{ opacity: interactive ? 1 : 0.7 }}
                  >
                    {facility.city},{" "}
                    {facility.country === "US"
                      ? facility.region
                      : facility.country}
                  </text>
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
                        r="6"
                        fill="var(--gp-red)"
                        stroke="#fff"
                        strokeWidth="2"
                      />
                    ) : (
                      <circle
                        r="5"
                        fill="var(--gp-bg)"
                        stroke="var(--gp-steel)"
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

      {active && activePos && !enteringId && (
        <aside className="mt-3 rounded-lg md:absolute md:bottom-[5%] md:left-[52%] md:mt-0 md:max-w-[17rem] border border-gp-line-strong bg-gp-bg/90 p-4 shadow-xl backdrop-blur">
          <p className="text-[11px] font-semibold tracking-widest text-gp-red uppercase">
            {active.is_interactive ? "Interactive lab" : "Informational site"}
          </p>
          <h2 className="mt-1 text-sm font-semibold text-gp-text">
            {active.name}
          </h2>
          <p className="text-xs text-gp-muted">
            {active.city}, {active.region ? `${active.region}, ` : ""}
            {active.country}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-gp-muted">
            {active.description}
          </p>
          {active.is_interactive ? (
            <button
              type="button"
              onClick={() => onEnter(active)}
              className="mt-3 w-full rounded-md bg-gp-red px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Enter Virtual Lab →
            </button>
          ) : (
            <p className="mt-3 text-xs text-gp-faint">
              Lab not modeled in this demo.
            </p>
          )}
          <p className="mt-2 text-[10px] text-gp-faint">
            Approximate city-level marker.
          </p>
        </aside>
      )}
    </div>
  );
}
