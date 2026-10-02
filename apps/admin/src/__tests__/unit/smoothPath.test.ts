import { describe, expect, it } from "vitest";
import { smoothPath } from "@/components/charts/smoothPath";

/** Every y in the path (control points included) — a cubic stays in their hull. */
function ys(d: string): number[] {
  return [...d.matchAll(/[\d.-]+,([\d.-]+)/g)].map((m) => Number(m[1]));
}

describe("smoothPath", () => {
  it("never overshoots the data range (no dip below a zero baseline)", () => {
    // SVG y grows downward: 180 is the zero baseline, 20 the peak.
    const pts = [0, 0, 7, 0, 0, 3, 0].map(
      (v, i) => [i * 100, 180 - v * 20] as const,
    );
    const all = ys(smoothPath(pts));
    expect(Math.max(...all)).toBeLessThanOrEqual(180);
    expect(Math.min(...all)).toBeGreaterThanOrEqual(180 - 7 * 20);
  });

  it("passes through every point", () => {
    const pts = [[0, 5], [10, 1], [20, 9]] as const;
    const d = smoothPath(pts);
    for (const [x, y] of pts) expect(d).toContain(`${x},${y}`);
  });
});
