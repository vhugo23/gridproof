"use client";

import type { ReactNode } from "react";
import type { SystemConfigV1 } from "@/lib/types";
import { ASSET_IDS, ASSET_LABEL, assetTag, type AssetId } from "./assets";
import { Box, SHADES, iso, leftFaceLine, pts, rightFaceLine } from "./iso";

type Props = {
  config: SystemConfigV1;
  selected: AssetId | null;
  onSelect: (id: AssetId) => void;
};

const FLOOR_W = 12;
const FLOOR_D = 10;

// Footprints in floor tiles: x, y, width, depth, height (px).
const FOOT = {
  utility: { x: 0.8, y: 0.8, w: 1.8, d: 1.6, h: 40 },
  switchgear: { x: 5, y: 0.8, w: 4, d: 1.2, h: 58 },
  g1: { x: 1.2, y: 3.4, w: 3.4, d: 1.8, h: 40 },
  g2: { x: 1.2, y: 6.6, w: 3.4, d: 1.8, h: 40 },
  battery: { x: 6.6, y: 6.2, w: 3.4, d: 2, h: 42 },
  load: { x: 10.2, y: 2.5, w: 1.6, d: 3, h: 50 },
} as const;

// Orthogonal bus routes on the floor, in tile coordinates.
const PATHS: Array<{ from: AssetId; points: Array<[number, number]> }> = [
  {
    from: "utility",
    points: [
      [2.6, 1.4],
      [5, 1.4],
    ],
  },
  {
    from: "g1",
    points: [
      [4.6, 4.3],
      [5.4, 4.3],
      [5.4, 2.0],
    ],
  },
  {
    from: "g2",
    points: [
      [4.6, 7.5],
      [6.0, 7.5],
      [6.0, 2.0],
    ],
  },
  {
    from: "battery",
    points: [
      [7.8, 6.2],
      [7.8, 2.0],
    ],
  },
  {
    from: "load",
    points: [
      [9, 1.4],
      [11.0, 1.4],
      [11.0, 2.5],
    ],
  },
];

function isDisabled(id: AssetId, config: SystemConfigV1): boolean {
  if (id === "g1" || id === "g2") return !config.equipment[id].enabled;
  if (id === "utility") return !config.equipment.utility.available;
  return false;
}

function Line({
  a,
  b,
  stroke,
  width = 1,
  opacity = 1,
}: {
  a: [number, number];
  b: [number, number];
  stroke: string;
  width?: number;
  opacity?: number;
}) {
  return (
    <line
      x1={a[0]}
      y1={a[1]}
      x2={b[0]}
      y2={b[1]}
      stroke={stroke}
      strokeWidth={width}
      strokeOpacity={opacity}
      strokeLinecap="round"
    />
  );
}

function Footprint({ id, selected }: { id: AssetId; selected: boolean }) {
  const f = FOOT[id];
  const pad = 0.25;
  const poly = pts([
    iso(f.x - pad, f.y - pad),
    iso(f.x + f.w + pad, f.y - pad),
    iso(f.x + f.w + pad, f.y + f.d + pad),
    iso(f.x - pad, f.y + f.d + pad),
  ]);
  return (
    <polygon
      points={poly}
      fill={selected ? "var(--gp-red-soft)" : "transparent"}
      stroke={selected ? "var(--gp-red)" : "transparent"}
      strokeWidth="2"
      className="transition-colors group-focus-visible:stroke-gp-red"
    />
  );
}

function Hotspot({
  id,
  config,
  selected,
  onSelect,
  children,
}: {
  id: AssetId;
  config: SystemConfigV1;
  selected: boolean;
  onSelect: (id: AssetId) => void;
  children: ReactNode;
}) {
  const disabled = isDisabled(id, config);
  const [, value] = assetTag(id, config);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${ASSET_LABEL[id]}: ${value}`}
      aria-pressed={selected}
      data-asset={id}
      className="group cursor-pointer outline-none"
      onClick={() => onSelect(id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(id);
        }
      }}
    >
      <Footprint id={id} selected={selected} />
      <g
        opacity={disabled ? 0.45 : 1}
        className="transition [filter:brightness(1)] group-hover:[filter:brightness(1.18)] group-focus-visible:[filter:brightness(1.18)]"
      >
        {children}
      </g>
    </g>
  );
}

function Tag({
  id,
  config,
  selected,
}: {
  id: AssetId;
  config: SystemConfigV1;
  selected: boolean;
}) {
  const f = FOOT[id];
  const disabled = isDisabled(id, config);
  const [title, value] = assetTag(id, config);
  const [tx, ty] = iso(f.x + f.w / 2, f.y + f.d / 2, f.h + 26);
  const width = 150;
  return (
    <g pointerEvents="none">
      <line
        x1={tx}
        y1={ty + 16}
        x2={tx}
        y2={ty + 26}
        stroke={selected ? "var(--gp-red)" : "var(--gp-line-strong)"}
        strokeWidth="1"
      />
      <g transform={`translate(${tx - width / 2} ${ty - 16})`}>
        <rect
          width={width}
          height="32"
          rx="5"
          fill="#0b0c0ee6"
          stroke={selected ? "var(--gp-red)" : "var(--gp-line-strong)"}
          strokeWidth={selected ? 1.5 : 1}
        />
        <text
          x="9"
          y="13"
          className="fill-gp-muted font-mono text-[9px] tracking-widest"
        >
          {title}
        </text>
        <text
          x="9"
          y="25"
          className={`font-mono text-[10.5px] ${disabled ? "fill-gp-warn" : "fill-gp-text"}`}
        >
          {value}
        </text>
      </g>
    </g>
  );
}

function Generator({ id }: { id: "g1" | "g2" }) {
  const f = FOOT[id];
  const { x, y, d } = f;
  return (
    <g>
      {/* skid */}
      <Box x={x} y={y} w={f.w} d={d} h={6} shade={SHADES.dark} />
      {/* engine + alternator enclosure */}
      <Box
        x={x + 0.1}
        y={y + 0.1}
        w={2.3}
        d={d - 0.2}
        h={30}
        z={6}
        shade={SHADES.steel}
      >
        {/* cummins-inspired red band on the front-left face */}
        <polygon
          points={pts([
            iso(x + 0.1, y + d - 0.1, 21),
            iso(x + 2.4, y + d - 0.1, 21),
            iso(x + 2.4, y + d - 0.1, 27),
            iso(x + 0.1, y + d - 0.1, 27),
          ])}
          fill="var(--gp-red)"
        />
        {[0.2, 0.4, 0.6, 0.8].map((u) => {
          const [a, b] = leftFaceLine(
            x + 0.1,
            y + 0.1,
            2.3,
            d - 0.2,
            u,
            0.05,
            u,
            0.3,
            6 + 2,
          );
          return (
            <Line
              key={u}
              a={a}
              b={b}
              stroke="#2c313a"
              width={1}
              opacity={0.7}
            />
          );
        })}
      </Box>
      {/* radiator */}
      <Box
        x={x + 2.4}
        y={y + 0.05}
        w={1.0}
        d={d - 0.1}
        h={34}
        z={6}
        shade={SHADES.graphite}
      >
        {[0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((v) => {
          const [a, b] = leftFaceLine(
            x + 2.4,
            y + 0.05,
            1.0,
            d - 0.1,
            0.1,
            v * 0.75 + 0.02,
            0.9,
            v * 0.75 + 0.02,
            6 + 10,
          );
          return <Line key={v} a={a} b={b} stroke="#1b1e23" width={1.2} />;
        })}
      </Box>
      {/* exhaust stack */}
      <Box
        x={x + 0.45}
        y={y + 0.35}
        w={0.28}
        d={0.28}
        h={22}
        z={36}
        shade={SHADES.dark}
      />
      {/* control panel */}
      <Box
        x={x + 1.5}
        y={y + 0.1}
        w={0.5}
        d={0.35}
        h={10}
        z={36}
        shade={SHADES.dark}
      />
    </g>
  );
}

function Utility() {
  const f = FOOT.utility;
  return (
    <g>
      <Box x={f.x} y={f.y} w={f.w} d={f.d} h={f.h} shade={SHADES.steel}>
        {[0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((u) => {
          const [a, b] = rightFaceLine(f.x, f.y, f.w, f.d, u, 0.1, u, 0.9, 0);
          return (
            <Line
              key={u}
              a={a}
              b={b}
              stroke="#2c313a"
              width={1.2}
              opacity={0.8}
            />
          );
        })}
      </Box>
      {[0.3, 0.8, 1.3].map((dx) => (
        <Box
          key={dx}
          x={f.x + dx}
          y={f.y + 0.4}
          w={0.22}
          d={0.22}
          h={16}
          z={f.h}
          shade={SHADES.dark}
        />
      ))}
    </g>
  );
}

function Switchgear() {
  const f = FOOT.switchgear;
  return (
    <g>
      <Box x={f.x} y={f.y} w={f.w} d={f.d} h={f.h} shade={SHADES.graphite}>
        {[0.25, 0.5, 0.75].map((u) => {
          const [a, b] = leftFaceLine(f.x, f.y, f.w, f.d, u, 0.04, u, 0.96);
          return <Line key={u} a={a} b={b} stroke="#1b1e23" width={1.4} />;
        })}
        <polygon
          points={pts([
            iso(f.x, f.y + f.d, 46),
            iso(f.x + f.w, f.y + f.d, 46),
            iso(f.x + f.w, f.y + f.d, 51),
            iso(f.x, f.y + f.d, 51),
          ])}
          fill="var(--gp-red)"
        />
        {[0.125, 0.375, 0.625, 0.875].map((u) => {
          const [cx, cy] = iso(f.x + u * f.w, f.y + f.d, 30);
          return (
            <circle
              key={u}
              cx={cx}
              cy={cy}
              r="2.4"
              fill="#3ec28f"
              opacity="0.85"
            />
          );
        })}
      </Box>
    </g>
  );
}

function Battery() {
  const f = FOOT.battery;
  return (
    <g>
      <Box x={f.x} y={f.y} w={f.w} d={f.d} h={f.h} shade={SHADES.dark}>
        {[0.34, 0.67].map((u) => {
          const [a, b] = leftFaceLine(f.x, f.y, f.w, f.d, u, 0.04, u, 0.96);
          return <Line key={u} a={a} b={b} stroke="#14161a" width={1.4} />;
        })}
        {[0.2, 0.4, 0.6, 0.8].map((v) => {
          const [a, b] = rightFaceLine(f.x, f.y, f.w, f.d, 0.15, v, 0.85, v);
          return <Line key={v} a={a} b={b} stroke="#14161a" width={1.2} />;
        })}
        <polygon
          points={pts([
            iso(f.x + 0.1 * f.w, f.y + f.d, 6),
            iso(f.x + 0.9 * f.w, f.y + f.d, 6),
            iso(f.x + 0.9 * f.w, f.y + f.d, 9),
            iso(f.x + 0.1 * f.w, f.y + f.d, 9),
          ])}
          fill="#3ec28f"
          opacity="0.8"
        />
      </Box>
    </g>
  );
}

function Load() {
  const f = FOOT.load;
  return (
    <g>
      <Box x={f.x} y={f.y} w={f.w} d={f.d} h={f.h} shade={SHADES.dark}>
        {Array.from({ length: 9 }, (_, i) => 0.08 + i * 0.1).map((v) => {
          const [a, b] = rightFaceLine(f.x, f.y, f.w, f.d, 0.06, v, 0.94, v);
          return <Line key={v} a={a} b={b} stroke="#14161a" width={1.4} />;
        })}
        {[0.12, 0.32, 0.52, 0.72].map((u) => {
          const [cx, cy] = iso(f.x + f.w, f.y + u * f.d, 40);
          return (
            <circle
              key={u}
              cx={cx}
              cy={cy}
              r="1.8"
              fill="#3ec28f"
              opacity="0.8"
            />
          );
        })}
      </Box>
    </g>
  );
}

export default function LabScene({ config, selected, onSelect }: Props) {
  const floor = pts([
    iso(0, 0),
    iso(FLOOR_W, 0),
    iso(FLOOR_W, FLOOR_D),
    iso(0, FLOOR_D),
  ]);
  const slabLeft = pts([
    iso(0, FLOOR_D),
    iso(FLOOR_W, FLOOR_D),
    iso(FLOOR_W, FLOOR_D, -14),
    iso(0, FLOOR_D, -14),
  ]);
  const slabRight = pts([
    iso(FLOOR_W, 0),
    iso(FLOOR_W, FLOOR_D),
    iso(FLOOR_W, FLOOR_D, -14),
    iso(FLOOR_W, 0, -14),
  ]);
  const wallBack = pts([
    iso(0, 0),
    iso(FLOOR_W, 0),
    iso(FLOOR_W, 0, 84),
    iso(0, 0, 84),
  ]);
  const wallSide = pts([
    iso(0, 0),
    iso(0, FLOOR_D),
    iso(0, FLOOR_D, 84),
    iso(0, 0, 84),
  ]);

  const common = { config, onSelect };
  const sel = (id: AssetId) => selected === id;

  return (
    <svg
      viewBox="0 0 1000 650"
      className="h-auto w-full"
      role="group"
      aria-label="Fridley Virtual Power Integration Lab, synthetic isometric view"
    >
      <defs>
        <linearGradient id="lab-floor" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#262a31" />
          <stop offset="100%" stopColor="#181b20" />
        </linearGradient>
        <linearGradient id="lab-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1d22" />
          <stop offset="100%" stopColor="#101215" />
        </linearGradient>
      </defs>

      {/* room shell */}
      <polygon points={wallSide} fill="url(#lab-wall)" stroke="#2a2e35" />
      <polygon points={wallBack} fill="url(#lab-wall)" stroke="#2a2e35" />
      <Line
        a={iso(0, 0, 84)}
        b={iso(FLOOR_W, 0, 84)}
        stroke="var(--gp-red)"
        width={2}
        opacity={0.7}
      />
      <Line
        a={iso(0, 0, 84)}
        b={iso(0, FLOOR_D, 84)}
        stroke="var(--gp-red)"
        width={2}
        opacity={0.35}
      />
      <text
        transform={`matrix(1 -${Math.tan(Math.PI / 6).toFixed(4)} 0 1 ${iso(0, 8.6, 62).join(" ")})`}
        className="fill-gp-steel font-mono text-[11px] tracking-[0.2em]"
        opacity="0.8"
      >
        FRIDLEY VIRTUAL POWER INTEGRATION LAB
      </text>
      <text
        transform={`matrix(1 -${Math.tan(Math.PI / 6).toFixed(4)} 0 1 ${iso(0, 8.6, 47).join(" ")})`}
        className="fill-gp-faint font-mono text-[9px] tracking-[0.25em]"
      >
        SYNTHETIC · GRIDPROOF
      </text>
      <polygon points={slabLeft} fill="#0e1013" />
      <polygon points={slabRight} fill="#0a0b0d" />
      <polygon points={floor} fill="url(#lab-floor)" stroke="#2f343c" />
      {Array.from({ length: FLOOR_W - 1 }, (_, i) => i + 1).map((i) => (
        <Line
          key={`gx${i}`}
          a={iso(i, 0)}
          b={iso(i, FLOOR_D)}
          stroke="#ffffff"
          width={0.6}
          opacity={0.05}
        />
      ))}
      {Array.from({ length: FLOOR_D - 1 }, (_, i) => i + 1).map((i) => (
        <Line
          key={`gy${i}`}
          a={iso(0, i)}
          b={iso(FLOOR_W, i)}
          stroke="#ffffff"
          width={0.6}
          opacity={0.05}
        />
      ))}

      {/* electrical connections (configured topology, not live flow) */}
      {PATHS.map(({ from, points }) => {
        const dim = isDisabled(from, config);
        const d = points
          .map(([x, y], i) => `${i ? "L" : "M"}${iso(x, y, 1).join(" ")}`)
          .join(" ");
        return (
          <g key={from} opacity={dim ? 0.3 : 1} data-path={from}>
            <path
              d={d}
              fill="none"
              stroke="#0b0c0e"
              strokeWidth="7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={d}
              fill="none"
              stroke="#b98a4e"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={d}
              fill="none"
              stroke="#e7c58f"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.6"
            />
          </g>
        );
      })}

      {/* equipment, painted back to front */}
      <Hotspot id="utility" selected={sel("utility")} {...common}>
        <Utility />
      </Hotspot>
      <Hotspot id="g1" selected={sel("g1")} {...common}>
        <Generator id="g1" />
      </Hotspot>
      <Hotspot id="switchgear" selected={sel("switchgear")} {...common}>
        <Switchgear />
      </Hotspot>
      <Hotspot id="g2" selected={sel("g2")} {...common}>
        <Generator id="g2" />
      </Hotspot>
      <Hotspot id="battery" selected={sel("battery")} {...common}>
        <Battery />
      </Hotspot>
      <Hotspot id="load" selected={sel("load")} {...common}>
        <Load />
      </Hotspot>

      {ASSET_IDS.map((id) => (
        <Tag key={id} id={id} config={config} selected={sel(id)} />
      ))}

      <text
        x="500"
        y="640"
        textAnchor="middle"
        className="fill-gp-faint font-mono text-[10px] tracking-widest"
      >
        SYNTHETIC CUMMINS-INSPIRED REPRESENTATION · CONFIGURED TOPOLOGY, NOT
        LIVE POWER FLOW
      </text>
    </svg>
  );
}
