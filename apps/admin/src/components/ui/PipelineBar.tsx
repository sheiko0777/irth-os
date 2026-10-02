import { formatNumber } from '@irth/domain';
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
 * The warning hue is a text colour (dark brown in light mode, for contrast);
 * as a fill it reads as brown, so fills use the brighter `--warning-fill`.
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

const fillOf = (color: string) => (color === 'var(--warning)' ? 'var(--warning-fill)' : color);

export function PipelineBar({ data }: PipelineBarProps) {
  const segments = data
    .filter((d) => d.count > 0)
    .map((d) => {
      const style = statusStyle('order', d.status);
      return { ...d, ...style, fill: fillOf(style.color) };
    })
    .sort((a, b) => (FLOW_RANK[a.status] ?? 99) - (FLOW_RANK[b.status] ?? 99));

  const total = segments.reduce((sum, s) => sum + s.count, 0);

  if (total === 0) {
    return (
      <div className="glass self-start rounded-[var(--card-radius)] px-5 py-4">
        <p className="text-xs text-[var(--t3)]">لا توجد طلبات بعد</p>
      </div>
    );
  }

  // self-start: sized to its content, not stretched to the trend chart's row height.
  return (
    <div className="glass self-start rounded-[var(--card-radius)] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          حالة الطلبات
        </h2>
        <span className="text-xs text-[var(--t2)] tabular-nums" dir="ltr">
          {formatNumber(total)}
        </span>
      </div>

      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--raised)]"
        role="img"
        aria-label={`حالة الطلبات: ${segments.map((s) => `${s.label} ${formatNumber(s.count)}`).join('، ')}`}
      >
        {segments.map((s) => (
          <div
            key={s.status}
            style={{ width: `${(s.count / total) * 100}%`, background: s.fill }}
            // A hairline between segments keeps adjacent hues from bleeding together.
            className="border-e-2 border-[var(--surface)] last:border-e-0"
          />
        ))}
      </div>

      <ul className="divide-y divide-[var(--separator)]">
        {segments.map((s) => (
          <li key={s.status} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: s.fill }}
              aria-hidden="true"
            />
            <span className="text-xs text-[var(--t2)]">{s.label}</span>
            <span className="ms-auto text-xs font-semibold text-[var(--t1)] tabular-nums" dir="ltr">
              {formatNumber(s.count)}
              <span className="ms-1.5 font-normal text-[var(--t2)]">
                {formatNumber(Math.round((s.count / total) * 100))}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
