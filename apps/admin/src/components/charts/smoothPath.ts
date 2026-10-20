/**
 * A smooth line through the points, monotone in y between neighbours (the
 * Fritsch–Carlson / d3 `curveMonotoneX` cubic). Unlike Catmull-Rom it never
 * overshoots: between two points the curve stays inside their y range, so a
 * run of zero days can not dip below the baseline and a peak is a real value.
 * Points must be sorted by x.
 */
export function smoothPath(points: ReadonlyArray<readonly [number, number]>): string {
  const n = points.length;
  if (n === 0) return '';
  const [first] = points;
  let d = `M ${first[0]},${first[1]}`;
  if (n === 1) return d;

  // Secant slopes, then tangents: zero at a local extremum or a flat run,
  // the harmonic mean otherwise (which keeps the cubic monotone).
  const secant: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1][0] - points[i][0];
    secant.push(dx === 0 ? 0 : (points[i + 1][1] - points[i][1]) / dx);
  }
  const tangent = points.map((_, i) => {
    if (i === 0) return secant[0];
    if (i === n - 1) return secant[n - 2];
    const a = secant[i - 1];
    const b = secant[i];
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  });

  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = (x1 - x0) / 3;
    d += ` C ${x0 + h},${y0 + h * tangent[i]} ${x1 - h},${y1 - h * tangent[i + 1]} ${x1},${y1}`;
  }
  return d;
}
