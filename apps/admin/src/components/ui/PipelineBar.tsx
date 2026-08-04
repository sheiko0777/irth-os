import { statusStyle } from '@/lib/statusMaps';

interface PipelineBarProps {
  /** Raw status counts, exactly as `dashboard.getStats` returns them. */
  data: { status: string; count: number }[];
}

/**
 * The order pipeline as one proportional track. Reads as a whole at a glance,
 * where four separate count cards would not.
 *
 * Segment colours come from `statusStyle` rather than a local map, so a status
 * that changes hue changes here too instead of silently drifting out of sync.
 */
const PIPELINE_ORDER = ['pending', 'confirmed', 'shipped', 'delivered'] as const;

export function PipelineBar({ data }: PipelineBarProps) {
  const counts = new Map(data.map((d) => [d.status, d.count]));
  const segments = PIPELINE_ORDER.map((status) => ({
    status,
    count: counts.get(status) ?? 0,
    ...statusStyle('order', status),
  }));

  const total = segments.reduce((sum, s) => sum + s.count, 0);

  if (total === 0) {
    return (
      <div className="rounded-xl border border-[var(--rim1)] bg-[var(--surface)] px-5 py-4">
        <p className="text-xs text-[var(--t3)]">لا توجد طلبات في المسار بعد</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--rim1)] bg-[var(--surface)] px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--t3)]">
          مسار الطلبات
        </h2>
        <span className="text-xs text-[var(--t2)] tabular-nums" dir="ltr">
          {total.toLocaleString('ar-EG')}
        </span>
      </div>

      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--raised)]"
        role="img"
        aria-label={`مسار الطلبات: ${segments.map((s) => `${s.label} ${s.count}`).join('، ')}`}
      >
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <div
              key={s.status}
              style={{ width: `${(s.count / total) * 100}%`, background: s.color }}
              // A hairline between segments keeps adjacent hues from bleeding together.
              className="border-l border-[var(--surface)] last:border-l-0"
            />
          ))}
      </div>

      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        {segments.map((s) => (
          <li key={s.status} className="flex items-center gap-1.5">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: s.color }}
              aria-hidden="true"
            />
            <span className="text-xs text-[var(--t2)]">{s.label}</span>
            <span className="text-xs font-semibold text-[var(--t1)] tabular-nums" dir="ltr">
              {s.count.toLocaleString('ar-EG')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
