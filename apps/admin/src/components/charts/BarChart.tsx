interface BarChartProps {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  formatValue?: (v: number) => string;
}

export function BarChart({ data, height = 180, color = 'var(--gold)', formatValue }: BarChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-[var(--t3)] text-sm" style={{ height }}>
        لا توجد بيانات
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.value), 1);
  const barWidth = 100 / data.length;
  const padPct = barWidth * 0.15;

  return (
    <div style={{ height }} className="w-full" aria-label="bar chart">
      <svg
        viewBox={`0 0 100 100`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: height - 24 }}
        role="img"
      >
        {data.map((d, i) => {
          const barH = (d.value / max) * 92;
          const x = i * barWidth + padPct;
          const w = barWidth - padPct * 2;
          return (
            <rect
              key={i}
              x={x}
              y={100 - barH}
              width={w}
              height={barH}
              fill={color}
              rx="1"
              opacity="0.85"
            />
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-[var(--t3)] mt-1 overflow-hidden">
        {data.map((d, i) => (
          <span key={i} className="truncate text-center" style={{ width: `${barWidth}%` }}>
            {d.label}
          </span>
        ))}
      </div>
      {formatValue && (
        <div className="sr-only">
          {data.map((d) => `${d.label}: ${formatValue(d.value)}`).join(', ')}
        </div>
      )}
    </div>
  );
}
