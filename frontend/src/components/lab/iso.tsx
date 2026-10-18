import type { ReactNode } from "react";

// Isometric helpers for the fixed-view lab scene. Grid units are floor tiles;
// z is in screen pixels. x grows toward the lower right, y toward the lower left.

export const TILE = 40; // half tile width in px
const TILE_H = TILE * Math.tan(Math.PI / 6); // 30° isometric
export const ORIGIN = { x: 460, y: 100 };

export function iso(x: number, y: number, z = 0): [number, number] {
  return [ORIGIN.x + (x - y) * TILE, ORIGIN.y + (x + y) * TILE_H - z];
}

export function pts(points: Array<[number, number]>): string {
  return points
    .map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`)
    .join(" ");
}

export type Shade = { top: string; left: string; right: string };

export const SHADES = {
  steel: { top: "#9aa5b6", left: "#65707f", right: "#444c58" },
  dark: { top: "#4d5562", left: "#313740", right: "#22262d" },
  graphite: { top: "#667080", left: "#444b57", right: "#2e333c" },
  red: { top: "#e0423d", left: "#a8272a", right: "#7c1d20" },
  green: { top: "#4fae8b", left: "#2f7b62", right: "#215a47" },
} satisfies Record<string, Shade>;

type BoxProps = {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  z?: number;
  shade: Shade;
  opacity?: number;
  children?: ReactNode;
};

/** An extruded box: top, front-left (y max) and front-right (x max) faces. */
export function Box({
  x,
  y,
  w,
  d,
  h,
  z = 0,
  shade,
  opacity = 1,
  children,
}: BoxProps) {
  const top = pts([
    iso(x, y, z + h),
    iso(x + w, y, z + h),
    iso(x + w, y + d, z + h),
    iso(x, y + d, z + h),
  ]);
  const left = pts([
    iso(x, y + d, z),
    iso(x + w, y + d, z),
    iso(x + w, y + d, z + h),
    iso(x, y + d, z + h),
  ]);
  const right = pts([
    iso(x + w, y, z),
    iso(x + w, y + d, z),
    iso(x + w, y + d, z + h),
    iso(x + w, y, z + h),
  ]);
  return (
    <g opacity={opacity}>
      <polygon
        points={left}
        fill={shade.left}
        stroke="#00000055"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
      <polygon
        points={right}
        fill={shade.right}
        stroke="#00000055"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
      <polygon
        points={top}
        fill={shade.top}
        stroke="#ffffff22"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
      {children}
    </g>
  );
}

/** A line on the left (y max) face of a box, in box-local face coordinates (u along x, v up). */
export function leftFaceLine(
  x: number,
  y: number,
  w: number,
  d: number,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  z = 0,
): [[number, number], [number, number]] {
  return [iso(x + u0 * w, y + d, z + v0), iso(x + u1 * w, y + d, z + v1)];
}

/** A line on the right (x max) face of a box (u along y, v up). */
export function rightFaceLine(
  x: number,
  y: number,
  w: number,
  d: number,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  z = 0,
): [[number, number], [number, number]] {
  return [iso(x + w, y + u0 * d, z + v0), iso(x + w, y + u1 * d, z + v1)];
}
