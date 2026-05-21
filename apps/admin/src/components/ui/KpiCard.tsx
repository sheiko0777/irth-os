interface KpiCardProps {
  title: string;
  value: string | number;
  sub?: string;
  color?: 'gold' | 'emerald' | 'crimson' | 'azure';
}

const colorMap = {
  gold: 'var(--gold)',
  emerald: 'var(--emerald)',
  crimson: 'var(--crimson)',
  azure: 'var(--azure)'
};

export function KpiCard({ title, value, sub, color = 'gold' }: KpiCardProps) {
  const accentColor = colorMap[color];

  return (
    <div 
      className="rounded-lg bg-[var(--card-bg)] border border-[var(--rim1)] overflow-hidden flex flex-col"
      style={{ borderTop: `2px solid ${accentColor}` }}
    >
      <div className="p-5 flex flex-col gap-2 flex-1">
        <h3 className="text-sm font-medium text-[var(--t2)]">{title}</h3>
        <div className="text-2xl font-bold text-[var(--t1)]">{value}</div>
        {sub && (
          <p className="text-sm text-[var(--t3)] mt-auto pt-2">{sub}</p>
        )}
      </div>
    </div>
  );
}
