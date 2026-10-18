import { describe, expect, it } from "vitest";
import { project } from "./projection";

// Expected values were produced independently with d3-geo's geoMercator using the
// same scale/translate that generated worldPaths.ts.
describe("project", () => {
  it.each([
    ["Fridley", 45.08417, -93.25667, 248.1666, 238.3732],
    ["Seymour", 38.95722, -85.89444, 300.754, 297.3564],
    ["Daventry", 52.25778, -1.16278, 905.9801, 160.5991],
  ])("places %s", (_name, lat, lon, x, y) => {
    const p = project(lat, lon);
    expect(p.x).toBeCloseTo(x, 3);
    expect(p.y).toBeCloseTo(y, 3);
  });

  it("keeps all three markers inside the map viewBox", () => {
    for (const [lat, lon] of [
      [45.08417, -93.25667],
      [38.95722, -85.89444],
      [52.25778, -1.16278],
    ]) {
      const { x, y } = project(lat, lon);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1000);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(423);
    }
  });
});
