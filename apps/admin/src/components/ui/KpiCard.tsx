import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: string | number;
  sub?: string;
  color?: 'gold' | 'emerald' | 'crimson' | 'azure';
  trend?: number; // % change vs previous period — positive = up, negative = down
  icon?: React.ReactNode;
}

const colorMap = {
  gold:    { accent: 'var(--gold)',    bg: 'var(--gold-bg)',                   text: 'var(--gold)'    },
  emerald: { accent: 'var(--emerald)', bg: 'rgba(0,196,120,.06)',              text: 'var(--emerald)' },
  crimson: { accent: 'var(--crimson)', bg: 'rgba(232,56,56,.06)',              text: 'var(--crimson)' },
  azure:   { accent: 'var(--azure)',   bg: 'rgba(46,143,255,.06)',             text: 'var(--azure)'   },
};

export function KpiCard({ title, value, sub, color = 'gold', trend, icon }: KpiCardProps) {
  const { accent, bg, text } = colorMap[color];

  const TrendIcon =
    trend === undefined || trend === 0 ? Minus : trend > 0 ? TrendingUp : TrendingDown;
  const trendColor =
    trend === undefined || trend === 0
      ? 'var(--t4)'
      : trend > 0
      ? 'var(--emerald)'
      : 'var(--crimson)';

  return (
    <div
      className="rounded-xl border border-[var(--rim1)] overflow-hidden flex flex-col transition-shadow hover:shadow-lg"
      style={{ background: bg, borderTop: `2px solid ${accent}` }}
    >
      <div className="p-5 flex flex-col gap-3 flex-1">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--t3)]">{title}</h3>
          {icon && (
            <span className="opacity-60" style={{ color: accent }}>
              {icon}
            </span>
          )}
        </div>

        <div className="text-3xl font-bold tracking-tight" style={{ color: 'var(--t1)' }}>
          {value}
        </div>

        <div className="flex items-center justify-between mt-auto pt-1">
          {sub && <p className="text-xs text-[var(--t3)]">{sub}</p>}
          {trend !== undefined && (
            <span
              className="flex items-center gap-1 text-xs font-semibold"
              style={{ color: trendColor }}
            >
              <TrendIcon size={12} />
              {Math.abs(trend).toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
