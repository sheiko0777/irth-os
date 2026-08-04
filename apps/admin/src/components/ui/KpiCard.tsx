import Link from 'next/link';
import { ArrowUpLeft, TrendingDown, TrendingUp } from 'lucide-react';
import { Sparkline } from '@/components/charts/Sparkline';

type Tone = 'emerald' | 'crimson' | 'amber';

interface KpiCardProps {
  title: string;
  value: string | number;
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
   * `hero` is the single gold-filled card per screen. Gold fills exactly two things
   * in this console — this card and the active nav bar — so never mark two heroes.
   */
  variant?: 'default' | 'hero';
  /** Must be unique per card: it namespaces the sparkline's SVG gradient id. */
  id: string;
}

const toneStyles: Record<Tone, { fg: string; bg: string }> = {
  emerald: { fg: 'var(--emerald)', bg: 'rgba(0,196,120,.15)' },
  crimson: { fg: 'var(--crimson)', bg: 'rgba(232,56,56,.15)' },
  amber: { fg: 'var(--amber)', bg: 'rgba(245,165,0,.15)' },
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
      <div className="flex items-start justify-between gap-2">
        <h3
          className="text-[10px] font-semibold uppercase tracking-[0.05em]"
          style={{ color: hero ? 'rgba(2,4,6,.7)' : 'var(--t3)' }}
        >
          {title}
        </h3>
        {icon && (
          <span className="shrink-0 opacity-70" style={{ color: hero ? '#020406' : 'var(--gold)' }}>
            {icon}
          </span>
        )}
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        {/* Near-black on gold: white would measure ~2.3:1, under the 4.5:1 floor. */}
        <span
          className="text-3xl font-bold tracking-tight tabular-nums leading-none"
          style={{ color: hero ? '#020406' : 'var(--t1)' }}
          dir="ltr"
        >
          {value}
        </span>

        {trend != null && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
            style={
              hero
                ? { color: '#020406', background: 'rgba(2,4,6,.12)' }
                : { color: chip.fg, background: chip.bg }
            }
            dir="ltr"
          >
            <TrendIcon size={11} />
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 mt-auto">
        {sub && (
          <p className="text-xs" style={{ color: hero ? 'rgba(2,4,6,.65)' : 'var(--t3)' }}>
            {sub}
          </p>
        )}
        {href && (
          <span
            className="shrink-0 grid place-items-center size-6 rounded-full transition-colors"
            style={{
              background: hero ? 'rgba(2,4,6,.1)' : 'var(--raised)',
              color: hero ? '#020406' : 'var(--t2)',
            }}
          >
            <ArrowUpLeft size={13} />
          </span>
        )}
      </div>

      {series && series.length > 1 && (
        <div className="-mx-5 -mb-5 mt-1">
          <Sparkline
            id={id}
            data={series}
            // 40% near-black stays legible on the gold gradient without punching
            // a hard black stripe through it.
            color={hero ? 'rgba(2,4,6,.4)' : 'var(--gold)'}
          />
        </div>
      )}
    </>
  );

  // Depth is tonal, never a shadow, and hover shifts colour only — a transform
  // here would nudge neighbouring cards and make dense rows twitch.
  const shell =
    'rounded-xl border p-5 flex flex-col gap-3 min-h-[9.5rem] overflow-hidden transition-colors';
  const style = hero
    ? {
        backgroundImage:
          'radial-gradient(120% 100% at 85% 0%, rgba(255,255,255,.08) 0%, transparent 60%), linear-gradient(135deg, var(--gold) 0%, var(--gold2) 100%)',
        borderColor: 'var(--gold2)',
      }
    : { background: 'var(--card-bg)', borderColor: 'var(--rim1)' };

  if (!href) {
    return (
      <div className={shell} style={style}>
        {body}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className={`${shell} ${hero ? '' : 'hover:border-[var(--rim2)]'} focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]`}
      style={style}
    >
      {body}
    </Link>
  );
}