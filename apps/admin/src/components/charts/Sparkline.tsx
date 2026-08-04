interface SparklineProps {
  /** One value per point. Fewer than two points renders nothing — a line needs a span. */
  data: number[];
  /** Unique per instance: SVG gradient ids are document-global and silently collide. */
  id: string;
  /** Stroke and fill hue. Near-black at low opacity on the gold hero card, gold elsewhere. */
  color?: string;
  height?: number;
  /** Faint dotted rule at the series mean, so a flat line still reads as flat. */
  baseline?: boolean;
}

export function Sparkline({
  data,
  id,
  color = 'var(--gold)',
  height = 28,
  baseline = true,
}: SparklineProps) {
  if (data.length < 2) return <div style={{ height }} aria-hidden="true" />;

  const max = Math.max(...data);
  const min = Math.min(...data);
  // A flat series would divide by zero; give it a span so it renders mid-height.
  const span = max - min || 1;
  const stepX = 100 / (data.length - 1);

  // 4% headroom top and bottom keeps the 1.5px stroke from clipping at the edges.
  const toY = (v: number) => 96 - ((v - min) / span) * 92;
  const points = data.map((v, i) => `${i * stepX},${toY(v)}`);
  const line = `M ${points.join(' L ')}`;
  const area = `${line} L 100,100 L 0,100 Z`;

  const meanY = toY(data.reduce((a, b) => a + b, 0) / data.length);

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="w-full block"
      style={{ height }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      {baseline && (
        <line
          x1="0"
          y1={meanY}
          x2="100"
          y2={meanY}
          stroke={color}
          strokeWidth="1"
          strokeOpacity="0.25"
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
      )}

      <path d={area} fill={`url(#spark-${id})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
