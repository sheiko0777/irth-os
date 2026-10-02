import { formatNumber } from "@irth/domain";
import { smoothPath } from "./smoothPath";

interface AreaChartProps {
  /** Oldest first. One point per period; fewer than two renders the empty line. */
  data: { label: string; value: number }[];
  /** Unique per instance: SVG gradient ids are document-global. */
  id: string;
  /** Accessible summary of what the line shows, read instead of the drawing. */
  title: string;
  formatValue?: (v: number) => string;
  height?: number;
}

const W = 600;
const PAD_TOP = 16;
const PAD_BOTTOM = 8;

/**
 * A single-series trend: smooth line, soft accent fill, three quiet grid
 * lines, and the latest point marked. Server-rendered SVG — no chart library,
 * no client JavaScript. Each point carries a native tooltip and the numbers
 * are repeated in a visually hidden list for screen readers.
 */
export function AreaChart({
  data,
  id,
  title,
  formatValue = formatNumber,
  height = 200,
}: AreaChartProps) {
  if (data.length < 2) {
    return (
      <div
        className="grid place-items-center text-sm text-[var(--text-secondary)]"
        style={{ height }}
      >
        لا توجد بيانات كافية للرسم
      </div>
    );
  }

  // The y domain starts at 0: a count below the baseline is never real.
  const values = data.map((d) => Math.max(0, d.value));
  const max = Math.max(...values, 1);
  const H = height;
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const stepX = W / (data.length - 1);
  const pts = values.map(
    (v, i) => [i * stepX, PAD_TOP + plotH - (v / max) * plotH] as const,
  );
  const line = smoothPath(pts);
  const area = `${line} L ${W},${H} L 0,${H} Z`;
  const last = pts[pts.length - 1];

  return (
    <figure className="w-full">
      <div className="relative" style={{ height }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block w-full overflow-visible"
          style={{ height }}
          role="img"
          aria-label={title}
        >
          <defs>
            <linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.26" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1="0"
              x2={W}
              y1={PAD_TOP + plotH * f}
              y2={PAD_TOP + plotH * f}
              stroke="var(--separator)"
              strokeDasharray="3 5"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={area} fill={`url(#area-${id})`} />
          <path
            d={line}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {pts.map(([x, y], i) => (
            // Wide invisible hit areas carry the tooltip; a 2px dot is no target.
            <rect
              key={i}
              x={x - stepX / 2}
              y={0}
              width={stepX}
              height={H}
              fill="transparent"
            >
              <title>{`${data[i].label}: ${formatValue(data[i].value)}`}</title>
            </rect>
          ))}
        </svg>
        {/* The latest point, drawn in HTML so it stays round under the stretched viewBox. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)] bg-[var(--accent)] shadow-[0_0_0_4px_var(--accent-soft)]"
          style={{ left: `${(last[0] / W) * 100}%`, top: last[1] }}
        />
      </div>
      <figcaption
        className="mt-2 flex justify-between gap-1 text-[11px] text-[var(--text-secondary)]"
        dir="ltr"
      >
        {data.map((d, i) => (
          <span
            key={i}
            className="flex-1 truncate text-center first:text-start last:text-end"
          >
            {d.label}
          </span>
        ))}
      </figcaption>
      <ul className="sr-only">
        {data.map((d, i) => (
          <li key={i}>{`${d.label}: ${formatValue(d.value)}`}</li>
        ))}
      </ul>
    </figure>
  );
}
