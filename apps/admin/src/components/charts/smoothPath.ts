/**
 * A smooth line through the points (Catmull-Rom as cubic Béziers). The curve
 * passes through every point, so a peak on the chart is a real value — the
 * tension is kept low enough that it never overshoots far between two points.
 */
export function smoothPath(points: ReadonlyArray<readonly [number, number]>, tension = 0.18): string {
  if (points.length === 0) return '';
  const [first] = points;
  let d = `M ${first[0]},${first[1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * tension;
    const c1y = p1[1] + (p2[1] - p0[1]) * tension;
    const c2x = p2[0] - (p3[0] - p1[0]) * tension;
    const c2y = p2[1] - (p3[1] - p1[1]) * tension;
    d += ` C ${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}
