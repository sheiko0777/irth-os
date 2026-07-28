import { useState } from 'react';
import { type OrgRow, planOf } from '@/lib/platformPlans';
import { statusLabel, statusMaps } from '@/lib/statusMaps';

interface Props {
  orgs: OrgRow[];
  selectedId: string | null;
  onSelect: (org: OrgRow) => void;
  onOpenCreate: () => void;
}

export function OrgListSidebar({ orgs, selectedId, onSelect, onOpenCreate }: Props) {
  const [search, setSearch] = useState('');

  const filtered = search
    ? orgs.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()) || o.slug.includes(search.toLowerCase()))
    : orgs;

  return (
    <div className="w-72 shrink-0 flex flex-col border-l" style={{ borderColor: 'var(--rim1)', background: 'var(--surface)' }}>
      <div className="p-4 border-b space-y-3" style={{ borderColor: 'var(--rim1)' }}>
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-bold">لوحة الأدمن العام</h1>
          <button onClick={onOpenCreate} className="text-xs px-2.5 py-1 rounded font-bold" style={{ background: 'var(--gold)', color: '#fff' }}>+ حساب</button>
        </div>
        <input
          value={search}
          onChange={(e: { target: { value: string } }) => setSearch(e.target.value)}
          placeholder="بحث..."
          className="w-full text-sm rounded-md px-3 py-2 border outline-none"
          style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)' }}
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.map((org) => {
          const p = planOf(org.config);
          const planStatus = statusMaps.plan[p];
          const isSel = selectedId === org.id;
          return (
            <button
              key={org.id}
              onClick={() => onSelect(org)}
              className="w-full text-right px-4 py-3 border-b transition-colors"
              style={{
                borderColor: 'var(--rim1)',
                background: isSel ? 'var(--gold-bg)' : 'transparent',
                color: isSel ? 'var(--gold)' : 'var(--t1)',
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm truncate">{org.name}</span>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0"
                  style={{ color: planStatus.color, background: 'var(--rim1)' }}
                >
                  {planStatus.label}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs" style={{ color: 'var(--t3)' }}>{org.memberCount} عضو</span>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: org.config?.isActive !== false ? 'var(--emerald)' : 'var(--crimson)' }} />
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && <p className="p-4 text-sm text-center" style={{ color: 'var(--t3)' }}>لا توجد نتائج</p>}
      </div>
    </div>
  );
}
