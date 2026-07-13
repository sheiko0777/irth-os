'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';

type OrgPlan = 'starter' | 'growth' | 'enterprise';

export type OrgConfig = {
  id: string;
  orgId: string;
  plan: string;
  isActive: boolean;
  enabledScreens: string[] | null;
  disabledScreens: string[] | null;
  maxUsers: number | null;
  notes: string | null;
};

export type OrgRow = {
  id: string;
  name: string;
  slug: string;
  brand: string;
  memberCount: number;
  config: OrgConfig | null;
};

const ALL_SCREENS = [
  { slug: 'orders', label: 'الطلبات' },
  { slug: 'customers', label: 'العملاء' },
  { slug: 'customer-segments', label: 'شرائح العملاء' },
  { slug: 'products', label: 'المنتجات' },
  { slug: 'categories', label: 'التصنيفات' },
  { slug: 'inventory', label: 'المخزون' },
  { slug: 'stocktaking', label: 'جرد المخزون' },
  { slug: 'purchasing', label: 'المشتريات' },
  { slug: 'returns', label: 'المرتجعات' },
  { slug: 'finance', label: 'المالية' },
  { slug: 'analytics', label: 'التحليلات' },
  { slug: 'coupons', label: 'الكوبونات' },
  { slug: 'pricelists', label: 'قوائم الأسعار' },
  { slug: 'campaigns', label: 'الحملات' },
  { slug: 'gift-cards', label: 'بطاقات الهدايا' },
  { slug: 'loyalty', label: 'نقاط الولاء' },
  { slug: 'corporate-accounts', label: 'حسابات الشركات' },
  { slug: 'flash-sales', label: 'العروض المؤقتة' },
  { slug: 'audit-log', label: 'سجل النشاط' },
  { slug: 'courier', label: 'الشحن والتسوية' },
  { slug: 'shipping', label: 'مناطق الشحن' },
  { slug: 'eta', label: 'الفواتير الإلكترونية' },
  { slug: 'integrations', label: 'التكاملات' },
  { slug: 'notifications', label: 'الإشعارات' },
  { slug: 'settings', label: 'الإعدادات' },
];

const STARTER = ['orders', 'customers', 'products', 'inventory', 'settings'];
const GROWTH = [
  ...STARTER,
  'customer-segments', 'categories', 'stocktaking', 'returns',
  'finance', 'analytics', 'coupons', 'campaigns', 'shipping', 'notifications',
];
const ENTERPRISE = ALL_SCREENS.map((s) => s.slug);

const PLAN_SCREENS: Record<OrgPlan, string[]> = {
  starter: STARTER,
  growth: GROWTH,
  enterprise: ENTERPRISE,
};

const PLAN_LABELS: Record<OrgPlan, string> = {
  starter: 'مبتدئ',
  growth: 'نمو',
  enterprise: 'مؤسسة',
};

const PLAN_COLORS: Record<OrgPlan, string> = {
  starter: 'var(--t3)',
  growth: 'var(--gold)',
  enterprise: 'var(--emerald)',
};

function planOf(config: OrgConfig | null): OrgPlan {
  const p = config?.plan;
  if (p === 'growth' || p === 'enterprise') return p;
  return 'starter';
}

export default function PlatformAdminClient({ initialOrgs }: { initialOrgs: OrgRow[] }) {
  const [orgs, setOrgs] = useState<OrgRow[]>(initialOrgs);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editPlan, setEditPlan] = useState<OrgPlan>('starter');
  const [editActive, setEditActive] = useState(true);
  const [editScreens, setEditScreens] = useState<string[]>(STARTER);
  const [editMaxUsers, setEditMaxUsers] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const selected = orgs.find((o) => o.id === selectedId) ?? null;

  function selectOrg(org: OrgRow) {
    setSelectedId(org.id);
    const p = planOf(org.config);
    setEditPlan(p);
    setEditActive(org.config?.isActive ?? true);
    setEditScreens(
      org.config?.enabledScreens?.length ? org.config.enabledScreens : PLAN_SCREENS[p]
    );
    setEditMaxUsers(org.config?.maxUsers != null ? String(org.config.maxUsers) : '');
    setEditNotes(org.config?.notes ?? '');
    setMsg('');
  }

  function applyPreset(plan: OrgPlan) {
    setEditPlan(plan);
    setEditScreens(PLAN_SCREENS[plan]);
  }

  function toggleScreen(slug: string) {
    setEditScreens((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  }

  const setConfig = trpc.platformAdmin.setOrgConfig.useMutation({
    onSuccess: (res) => {
      setOrgs((prev) =>
        prev.map((o) => (o.id === selectedId ? { ...o, config: res.data as OrgConfig } : o))
      );
      setMsg('تم الحفظ بنجاح');
      setSaving(false);
    },
    onError: (err) => {
      setMsg('خطأ: ' + err.message);
      setSaving(false);
    },
  });

  const resetConfig = trpc.platformAdmin.resetConfig.useMutation({
    onSuccess: () => {
      setOrgs((prev) =>
        prev.map((o) => (o.id === selectedId ? { ...o, config: null } : o))
      );
      applyPreset('starter');
      setEditActive(true);
      setEditMaxUsers('');
      setEditNotes('');
      setMsg('تمت الإعادة للإعدادات الافتراضية');
      setSaving(false);
    },
    onError: (err) => {
      setMsg('خطأ: ' + err.message);
      setSaving(false);
    },
  });

  function handleSave() {
    if (!selectedId) return;
    setSaving(true);
    setMsg('');
    setConfig.mutate({
      orgId: selectedId,
      plan: editPlan,
      isActive: editActive,
      enabledScreens: editScreens,
      disabledScreens: ALL_SCREENS.map((s) => s.slug).filter((s) => !editScreens.includes(s)),
      maxUsers: editMaxUsers ? Number(editMaxUsers) : null,
      notes: editNotes || null,
    });
  }

  function handleReset() {
    if (!selectedId || !confirm('إعادة الإعدادات الافتراضية لهذه المؤسسة؟')) return;
    setSaving(true);
    resetConfig.mutate({ orgId: selectedId });
  }

  const filtered = search
    ? orgs.filter(
        (o) =>
          o.name.toLowerCase().includes(search.toLowerCase()) ||
          o.slug.includes(search.toLowerCase())
      )
    : orgs;

  return (
    <div
      dir="rtl"
      className="font-cairo flex"
      style={{ minHeight: '100vh', color: 'var(--t1)', background: 'var(--background)' }}
    >
      {/* Org list */}
      <div
        className="w-72 shrink-0 flex flex-col border-l"
        style={{ borderColor: 'var(--rim1)', background: 'var(--surface)' }}
      >
        <div className="p-4 border-b" style={{ borderColor: 'var(--rim1)' }}>
          <h1 className="text-sm font-bold mb-3">لوحة الأدمن العام</h1>
          <input
            value={search}
            onChange={(e: { target: { value: string } }) => setSearch(e.target.value)}
            placeholder="بحث عن مؤسسة..."
            className="w-full text-sm rounded-md px-3 py-2 border outline-none"
            style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)' }}
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map((org) => {
            const p = planOf(org.config);
            const isSel = selectedId === org.id;
            return (
              <button
                key={org.id}
                onClick={() => selectOrg(org)}
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
                    style={{ color: PLAN_COLORS[p], background: 'var(--rim1)' }}
                  >
                    {PLAN_LABELS[p]}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs" style={{ color: 'var(--t3)' }}>
                    {org.memberCount} عضو
                  </span>
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      background:
                        org.config?.isActive !== false ? 'var(--emerald)' : 'var(--crimson)',
                    }}
                  />
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="p-4 text-sm text-center" style={{ color: 'var(--t3)' }}>
              لا توجد نتائج
            </p>
          )}
        </div>
      </div>

      {/* Config panel */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selected ? (
          <div
            className="flex items-center justify-center"
            style={{ height: '60vh', color: 'var(--t3)' }}
          >
            <p className="text-sm">اختر مؤسسة من القائمة للتعديل</p>
          </div>
        ) : (
          <div className="max-w-2xl space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold">{selected.name}</h2>
                <p className="text-sm mt-0.5" style={{ color: 'var(--t3)' }}>
                  {selected.slug} · {selected.memberCount} عضو
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleReset}
                  disabled={saving}
                  className="text-xs px-3 py-1.5 rounded border transition-colors"
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
                  {saving ? 'جارٍ الحفظ...' : 'حفظ'}
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

            {/* Plan */}
            <section
              className="rounded-lg border p-4 space-y-4"
              style={{ borderColor: 'var(--rim1)', background: 'var(--surface)' }}
            >
              <h3 className="font-semibold text-sm">الخطة والحالة</h3>
              <div className="flex gap-2">
                {(['starter', 'growth', 'enterprise'] as OrgPlan[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => applyPreset(p)}
                    className="flex-1 py-2 rounded border text-sm font-medium transition-all"
                    style={{
                      borderColor: editPlan === p ? 'var(--gold)' : 'var(--rim2)',
                      background: editPlan === p ? 'var(--gold-bg)' : 'transparent',
                      color: editPlan === p ? 'var(--gold)' : 'var(--t2)',
                    }}
                  >
                    {PLAN_LABELS[p]}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={editActive}
                  onChange={(e: { target: { checked: boolean } }) =>
                    setEditActive(e.target.checked)
                  }
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm">المؤسسة مفعّلة</span>
              </label>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--t3)' }}>
                  الحد الأقصى للأعضاء (فارغ = غير محدود)
                </label>
                <input
                  type="number"
                  value={editMaxUsers}
                  onChange={(e: { target: { value: string } }) => setEditMaxUsers(e.target.value)}
                  placeholder="غير محدود"
                  min="1"
                  className="w-32 text-sm rounded border px-3 py-1.5 outline-none"
                  style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)' }}
                />
              </div>
            </section>

            {/* Screens */}
            <section
              className="rounded-lg border p-4 space-y-3"
              style={{ borderColor: 'var(--rim1)', background: 'var(--surface)' }}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">الشاشات المتاحة</h3>
                <span className="text-xs" style={{ color: 'var(--t3)' }}>
                  {editScreens.length} / {ALL_SCREENS.length}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {ALL_SCREENS.map((s) => (
                  <label key={s.slug} className="flex items-center gap-2 cursor-pointer py-0.5">
                    <input
                      type="checkbox"
                      checked={editScreens.includes(s.slug)}
                      onChange={() => toggleScreen(s.slug)}
                      className="w-4 h-4 rounded shrink-0"
                    />
                    <span className="text-sm">{s.label}</span>
                  </label>
                ))}
              </div>
            </section>

            {/* Notes */}
            <section
              className="rounded-lg border p-4"
              style={{ borderColor: 'var(--rim1)', background: 'var(--surface)' }}
            >
              <h3 className="font-semibold text-sm mb-2">ملاحظات داخلية</h3>
              <textarea
                value={editNotes}
                onChange={(e: { target: { value: string } }) => setEditNotes(e.target.value)}
                placeholder="ملاحظات خاصة بهذه المؤسسة..."
                rows={3}
                className="w-full text-sm rounded border px-3 py-2 outline-none resize-none"
                style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)' }}
              />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
