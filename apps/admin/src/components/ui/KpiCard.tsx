import Link from 'next/link';
import { ArrowUpLeft, TrendingDown, TrendingUp } from 'lucide-react';
import { Sparkline } from '@/components/charts/Sparkline';
import { cn } from '@/lib/utils';

type Tone = 'emerald' | 'crimson' | 'amber';

interface KpiCardProps {
  title: string;
  value: React.ReactNode;
  sub?: string;
  /** Percent change vs the prior period. `null` means there was no basis to compare against. */
  trend?: number | null;
  /** Overrides the sign-derived tone — on a returns rate, a rise is bad news. */
  trendTone?: Tone;
  /** Points backing the sparkline. Omit and the card renders without one. */
  series?: number[];
  /** Renders the drill-in affordance. Without it the card is a dead end. */
  href?: string;
  icon?: React.ReactNode;
  /**
   * `hero` is the single navy card per screen — the figure the screen exists
   * to show. Never mark two heroes on one screen.
   */
  variant?: 'default' | 'hero';
  /** Must be unique per card: it namespaces the sparkline's SVG gradient id. */
  id: string;
}

const toneStyles: Record<Tone, { fg: string; bg: string }> = {
  emerald: { fg: 'var(--success)', bg: 'var(--success-bg)' },
  crimson: { fg: 'var(--critical)', bg: 'var(--critical-bg)' },
  amber: { fg: 'var(--warning)', bg: 'var(--warning-bg)' },
};

export function KpiCard({
  title,
  value,
  sub,
  trend,
  trendTone,
  series,
  href,
  icon,
  variant = 'default',
  id,
}: KpiCardProps) {
  const hero = variant === 'hero';

  const tone: Tone = trendTone ?? (trend != null && trend < 0 ? 'crimson' : 'emerald');
  const chip = toneStyles[tone];
  const TrendIcon = trend != null && trend < 0 ? TrendingDown : TrendingUp;

  const body = (
    <>
      <div className="flex items-center gap-3">
        {icon && (
          <span
            className={cn(
              'grid size-10 shrink-0 place-items-center rounded-xl [&_svg]:size-[18px]',
              hero ? 'bg-white/15 text-[var(--hero-fg)]' : 'bg-[var(--accent-soft)] text-[var(--accent)]',
            )}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <h3
          className={cn(
            'text-sm font-medium',
            hero ? 'text-[var(--hero-muted)]' : 'text-[var(--text-secondary)]',
          )}
        >
          {title}
        </h3>
        {href && (
          <span
            className={cn(
              'ms-auto grid size-8 shrink-0 place-items-center rounded-full transition-colors',
              hero
                ? 'bg-white/15 text-[var(--hero-fg)]'
                : 'bg-[var(--raised)] text-[var(--text-secondary)] group-hover:bg-[var(--accent)] group-hover:text-[var(--accent-fg)]',
            )}
            aria-hidden="true"
          >
            <ArrowUpLeft size={15} />
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <span
          className={cn(
            'text-[2rem] font-semibold leading-none tracking-tight tabular-nums',
            hero ? 'text-[var(--hero-fg)]' : 'text-[var(--text-primary)]',
          )}
          dir="ltr"
        >
          {value}
        </span>

        {trend != null && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
            style={hero ? { color: 'var(--hero-fg)', background: 'rgb(255 255 255 / 0.16)' } : { color: chip.fg, background: chip.bg }}
            dir="ltr"
          >
            <TrendIcon size={11} aria-hidden="true" />
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>

      {sub && (
        <p className={cn('mt-auto text-xs', hero ? 'text-[var(--hero-muted)]' : 'text-[var(--text-secondary)]')}>
          {sub}
        </p>
      )}

      {series && series.length > 1 && (
        <div className="-mx-5 -mb-5 mt-1">
          <Sparkline id={id} data={series} color={hero ? 'rgb(255 255 255 / 0.55)' : 'var(--accent)'} />
        </div>
      )}
    </>
  );

  // Hover changes colour and shadow only — a transform would nudge
  // neighbouring cards and make dense rows twitch.
  const shell = cn(
    'group flex min-h-[9.5rem] flex-col gap-4 overflow-hidden rounded-[var(--card-radius)] p-5 transition-shadow',
    hero ? 'surface-hero' : 'glass',
  );

  if (!href) return <div className={shell}>{body}</div>;

  return (
    <Link
      href={href}
      className={cn(
        shell,
        'hover:shadow-[var(--float-shadow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]',
      )}
    >
      {body}
    </Link>
  );
}
