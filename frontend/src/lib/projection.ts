// Mercator projection used to place facility markers on the generated map.
// These constants must match the parameters used to generate worldPaths.ts
// (longitude -128..12, top latitude 64, width 1000).

export const MAP_VIEW = {
  width: 1000,
  height: 423,
  scale: 409.25556795058804,
  tx: 914.2857142857143,
  ty: 599.9311471820935,
} as const;

export function project(
  latitude: number,
  longitude: number,
): { x: number; y: number } {
  const lambda = (longitude * Math.PI) / 180;
  const phi = (latitude * Math.PI) / 180;
  return {
    x: MAP_VIEW.tx + MAP_VIEW.scale * lambda,
    y: MAP_VIEW.ty - MAP_VIEW.scale * Math.log(Math.tan(Math.PI / 4 + phi / 2)),
  };
}
