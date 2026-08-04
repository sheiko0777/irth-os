import { statusStyle } from '@/lib/statusMaps';

interface PipelineBarProps {
  /** Raw status counts, exactly as `dashboard.getStats` returns them. */
  data: { status: string; count: number }[];
}

/**
 * Every order state as one proportional track — flow states first, terminal
 * states after, nothing dropped.
 *
 * The first version mapped only pending/confirmed/shipped/delivered, so
 * cancelled, failed and returned orders vanished from both the bar and the
 * total; an org whose orders were all cancelled read as having no orders at
 * all. Adversarial review caught it. Hiding the unhappy states is exactly the
 * kind of lie a status widget must not tell, so the fix is to render them,
 * not to relabel the widget.
 *
 * Segment colours come from `statusStyle` rather than a local map, so a status
 * that changes hue changes here too instead of silently drifting out of sync.
 */
const FLOW_RANK: Record<string, number> = {
  pending: 0,
  confirmed: 1,
  shipped: 2,
  delivered: 3,
  payment_failed: 4,
  returned: 5,
  cancelled: 6,
};

export function PipelineBar({ data }: PipelineBarProps) {
  const segments = data
    .filter((d) => d.count > 0)
    .map((d) => ({ ...d, ...statusStyle('order', d.status) }))
    .sort((a, b) => (FLOW_RANK[a.status] ?? 99) - (FLOW_RANK[b.status] ?? 99));

  const total = segments.reduce((sum, s) => sum + s.count, 0);

  if (total === 0) {
    return (
      <div className="rounded-xl border border-[var(--rim1)] bg-[var(--surface)] px-5 py-4">
        <p className="text-xs text-[var(--t3)]">لا توجد طلبات بعد</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--rim1)] bg-[var(--surface)] px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--t3)]">
          حالة الطلبات
        </h2>
        <span className="text-xs text-[var(--t2)] tabular-nums" dir="ltr">
          {total.toLocaleString('ar-EG')}
        </span>
      </div>

      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--raised)]"
        role="img"
        aria-label={`حالة الطلبات: ${segments.map((s) => `${s.label} ${s.count}`).join('، ')}`}
      >
        {segments.map((s) => (
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