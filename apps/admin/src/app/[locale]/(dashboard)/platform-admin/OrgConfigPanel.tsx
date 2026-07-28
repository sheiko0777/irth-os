import { useState, useEffect } from 'react';
import { type OrgRow, type OrgPlan, planOf, PLAN_SCREENS, ALL_SCREENS } from '@/lib/platformPlans';
import { statusMaps } from '@/lib/statusMaps';
import { ScreenCheckboxGrid } from './ScreenCheckboxGrid';

interface Props {
  selectedOrg: OrgRow | null;
  saving: boolean;
  msg: string;
  onSave: (config: {
    plan: OrgPlan;
    isActive: boolean;
    enabledScreens: string[];
    disabledScreens: string[];
    maxUsers: number | null;
    notes: string | null;
  }) => void;
  onReset: () => void;
}

export function OrgConfigPanel({ selectedOrg, saving, msg, onSave, onReset }: Props) {
  const [editPlan, setEditPlan] = useState<OrgPlan>('starter');
  const [editActive, setEditActive] = useState(true);
  const [editScreens, setEditScreens] = useState<string[]>(PLAN_SCREENS.starter);
  const [editMaxUsers, setEditMaxUsers] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Sync state when selected org changes
  useEffect(() => {
    if (selectedOrg) {
      const p = planOf(selectedOrg.config);
      setEditPlan(p);
      setEditActive(selectedOrg.config?.isActive ?? true);
      setEditScreens(
        selectedOrg.config?.enabledScreens?.length
          ? selectedOrg.config.enabledScreens
          : PLAN_SCREENS[p]
      );
      setEditMaxUsers(selectedOrg.config?.maxUsers != null ? String(selectedOrg.config.maxUsers) : '');
      setEditNotes(selectedOrg.config?.notes ?? '');
    }
  }, [selectedOrg]);

  if (!selectedOrg) {
    return (
      <div className="flex items-center justify-center" style={{ height: '60vh', color: 'var(--t3)' }}>
        <p className="text-sm">اختر مؤسسة أو أنشئ حساباً جديداً</p>
      </div>
    );
  }

  function applyPreset(plan: OrgPlan) {
    setEditPlan(plan);
    setEditScreens(PLAN_SCREENS[plan]);
  }

  function handleSave() {
    onSave({
      plan: editPlan,
      isActive: editActive,
      enabledScreens: editScreens,
      disabledScreens: ALL_SCREENS.map((s) => s.slug).filter((s) => !editScreens.includes(s)),
      maxUsers: editMaxUsers ? Number(editMaxUsers) : null,
      notes: editNotes || null,
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold">{selectedOrg.name}</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--t3)' }}>
            {selectedOrg.slug} · {selectedOrg.memberCount} عضو
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onReset}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded border"
            style={{ borderColor: 'var(--rim2)', color: 'var(--crimson)' }}
          >
            إعادة افتراضي
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs px-4 py-1.5 rounded font-bold"
            style={{ background: 'var(--gold)', color: '#fff', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? '...' : 'حفظ'}
          </button>
        </div>
      </div>

      {msg && (
        <p
          className="text-sm px-3 py-2 rounded"
          style={{
            background: 'var(--rim1)',
            color: msg.startsWith('خطأ') ? 'var(--crimson)' : 'var(--emerald)',
          }}
        >
          {msg}
        </p>
      )}

      <section className="rounded-lg border p-4 space-y-4" style={{ borderColor: 'var(--rim1)', background: 'var(--surface)' }}>
        <h3 className="font-semibold text-sm">الخطة والحالة</h3>
        <div className="flex gap-2">
          {(['starter', 'growth', 'enterprise'] as OrgPlan[]).map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className="flex-1 py-2 rounded border text-sm font-medium"
              style={{
                borderColor: editPlan === p ? 'var(--gold)' : 'var(--rim2)',
                background: editPlan === p ? 'var(--gold-bg)' : 'transparent',
                color: editPlan === p ? 'var(--gold)' : 'var(--t2)',
              }}
            >
              {statusMaps.plan[p].label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={editActive}
            onChange={(e: { target: { checked: boolean } }) => setEditActive(e.target.checked)}
            className="w-4 h-4 rounded"
          />
          <span className="text-sm">المؤسسة مفعّلة</span>
        </label>
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--t3)' }}>الحد الأقصى للأعضاء</label>
          <input
            type="number"
            value={editMaxUsers}
            onChange={(e: { target: { value: string } }) => setEditMaxUsers(e.target.value)}
            min="1"
            placeholder="غير محدود"
            className="w-32 text-sm rounded border px-3 py-1.5 outline-none"
            style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)' }}
          />
        </div>
      </section>

      <section className="rounded-lg border p-4 space-y-3" style={{ borderColor: 'var(--rim1)', background: 'var(--surface)' }}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">الشاشات المتاحة</h3>
          <span className="text-xs" style={{ color: 'var(--t3)' }}>
            {editScreens.length} / {ALL_SCREENS.length}
          </span>
        </div>
        <ScreenCheckboxGrid screens={editScreens} onChange={setEditScreens} />
      </section>

      <section className="rounded-lg border p-4" style={{ borderColor: 'var(--rim1)', background: 'var(--surface)' }}>
        <h3 className="font-semibold text-sm mb-2">ملاحظات داخلية</h3>
        <textarea
          value={editNotes}
          onChange={(e: { target: { value: string } }) => setEditNotes(e.target.value)}
          rows={3}
          className="w-full text-sm rounded border px-3 py-2 outline-none resize-none"
          style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)' }}
        />
      </section>
    </div>
  );
}
