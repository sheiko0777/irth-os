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
const GROWTH = [...STARTER, 'customer-segments', 'categories', 'stocktaking', 'returns', 'finance', 'analytics', 'coupons', 'campaigns', 'shipping', 'notifications'];
const ENTERPRISE = ALL_SCREENS.map((s) => s.slug);

const PLAN_SCREENS: Record<OrgPlan, string[]> = { starter: STARTER, growth: GROWTH, enterprise: ENTERPRISE };
const PLAN_LABELS: Record<OrgPlan, string> = { starter: 'مبتدئ', growth: 'نمو', enterprise: 'مؤسسة' };
const PLAN_COLORS: Record<OrgPlan, string> = { starter: 'var(--t3)', growth: 'var(--gold)', enterprise: 'var(--emerald)' };

function planOf(config: OrgConfig | null): OrgPlan {
  const p = config?.plan;
  if (p === 'growth' || p === 'enterprise') return p;
  return 'starter';
}

function toSlug(name: string) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 50);
}

interface Props { initialOrgs: OrgRow[]; locale: string }

export default function PlatformAdminClient({ initialOrgs, locale }: Props) {
  const [orgs, setOrgs] = useState<OrgRow[]>(initialOrgs);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Edit config state
  const [editPlan, setEditPlan] = useState<OrgPlan>('starter');
  const [editActive, setEditActive] = useState(true);
  const [editScreens, setEditScreens] = useState<string[]>(STARTER);
  const [editMaxUsers, setEditMaxUsers] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // Create org modal state
  const [showCreate, setShowCreate] = useState(false);
  const [cName, setCName] = useState('');
  const [cSlug, setCSlug] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cPlan, setCPlan] = useState<OrgPlan>('starter');
  const [cScreens, setCScreens] = useState<string[]>(STARTER);
  const [cMaxUsers, setCMaxUsers] = useState('');
  const [cNotes, setCNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const selected = orgs.find((o) => o.id === selectedId) ?? null;

  function selectOrg(org: OrgRow) {
    setSelectedId(org.id);
    const p = planOf(org.config);
    setEditPlan(p);
    setEditActive(org.config?.isActive ?? true);
    setEditScreens(org.config?.enabledScreens?.length ? org.config.enabledScreens : PLAN_SCREENS[p]);
    setEditMaxUsers(org.config?.maxUsers != null ? String(org.config.maxUsers) : '');
    setEditNotes(org.config?.notes ?? '');
    setMsg('');
  }

  function applyPreset(plan: OrgPlan, setScreensFn: (s: string[]) => void, setPlanFn: (p: OrgPlan) => void) {
    setPlanFn(plan);
    setScreensFn(PLAN_SCREENS[plan]);
  }

  const setConfig = trpc.platformAdmin.setOrgConfig.useMutation({
    onSuccess: (res) => {
      setOrgs((prev) => prev.map((o) => o.id === selectedId ? { ...o, config: res.data as OrgConfig } : o));
      setMsg('تم الحفظ بنجاح');
      setSaving(false);
    },
    onError: (err) => { setMsg('خطأ: ' + err.message); setSaving(false); },
  });

  const resetConfig = trpc.platformAdmin.resetConfig.useMutation({
    onSuccess: () => {
      setOrgs((prev) => prev.map((o) => o.id === selectedId ? { ...o, config: null } : o));
      applyPreset('starter', setEditScreens, setEditPlan);
      setEditActive(true); setEditMaxUsers(''); setEditNotes('');
      setMsg('تمت الإعادة للافتراضي');
      setSaving(false);
    },
    onError: (err) => { setMsg('خطأ: ' + err.message); setSaving(false); },
  });

  const createOrg = trpc.platformAdmin.createOrg.useMutation({
    onSuccess: (res) => {
      const url = `${window.location.origin}/${locale}/join?token=${res.data.inviteToken}`;
      setInviteUrl(url);
      setCreating(false);
      // Refresh by reloading (server state changed)
      window.location.reload();
    },
    onError: (err) => {
      setMsg('خطأ: ' + err.message);
      setCreating(false);
    },
  });

  function handleSave() {
    if (!selectedId) return;
    setSaving(true); setMsg('');
    setConfig.mutate({ orgId: selectedId, plan: editPlan, isActive: editActive, enabledScreens: editScreens, disabledScreens: ALL_SCREENS.map((s) => s.slug).filter((s) => !editScreens.includes(s)), maxUsers: editMaxUsers ? Number(editMaxUsers) : null, notes: editNotes || null });
  }

  function handleReset() {
    if (!selectedId || !confirm('إعادة الإعدادات الافتراضية لهذه المؤسسة؟')) return;
    setSaving(true);
    resetConfig.mutate({ orgId: selectedId });
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!cName || !cSlug || !cEmail) return;
    setCreating(true);
    createOrg.mutate({ name: cName, slug: cSlug, ownerEmail: cEmail, plan: cPlan, enabledScreens: cScreens, disabledScreens: ALL_SCREENS.map((s) => s.slug).filter((s) => !cScreens.includes(s)), maxUsers: cMaxUsers ? Number(cMaxUsers) : null, notes: cNotes || null });
  }

  function openCreate() {
    setCName(''); setCSlug(''); setCEmail(''); setCPlan('starter'); setCScreens(STARTER); setCMaxUsers(''); setCNotes('');
    setInviteUrl(null);
    setShowCreate(true);
  }

  const filtered = search ? orgs.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()) || o.slug.includes(search.toLowerCase())) : orgs;

  return (
    <div dir="rtl" className="font-cairo flex" style={{ minHeight: '100vh', color: 'var(--t1)', background: 'var(--background)' }}>

      {/* Create org modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md rounded-xl border overflow-y-auto max-h-[90vh]" style={{ borderColor: 'var(--rim1)', background: 'var(--surface)' }}>
            <div className="p-6">
              {inviteUrl ? (
                <div className="space-y-4">
                  <h2 className="font-bold text-base">تم إنشاء الحساب</h2>
                  <p className="text-sm" style={{ color: 'var(--t2)' }}>أرسل رابط الدعوة التالي لصاحب الحساب:</p>
                  <div className="flex gap-2">
                    <input readOnly value={inviteUrl} className="flex-1 text-xs rounded border px-3 py-2 outline-none" style={{ borderColor: 'var(--rim2)', background: 'var(--rim1)', color: 'var(--t1)', direction: 'ltr' }} />
                    <button onClick={() => navigator.clipboard.writeText(inviteUrl)} className="text-xs px-3 rounded border font-medium" style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}>نسخ</button>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--t3)' }}>الرابط صالح ٧ أيام</p>
                  <button onClick={() => setShowCreate(false)} className="w-full py-2 rounded text-sm font-bold" style={{ background: 'var(--gold)', color: '#fff' }}>إغلاق</button>
                </div>
              ) : (
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="font-bold text-base">إنشاء حساب جديد</h2>
                    <button type="button" onClick={() => setShowCreate(false)} className="text-sm" style={{ color: 'var(--t3)' }}>✕</button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs mb-1" style={{ color: 'var(--t3)' }}>اسم المؤسسة *</label>
                      <input required value={cName} onChange={(e: { target: { value: string } }) => { setCName(e.target.value); setCSlug(toSlug(e.target.value)); }} className="w-full text-sm rounded border px-3 py-2 outline-none" style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)' }} />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs mb-1" style={{ color: 'var(--t3)' }}>المعرّف (slug) *</label>
                      <input required value={cSlug} onChange={(e: { target: { value: string } }) => setCSlug(e.target.value)} className="w-full text-sm rounded border px-3 py-2 outline-none" style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)', direction: 'ltr' }} placeholder="my-org" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs mb-1" style={{ color: 'var(--t3)' }}>بريد المسؤول *</label>
                      <input required type="email" value={cEmail} onChange={(e: { target: { value: string } }) => setCEmail(e.target.value)} className="w-full text-sm rounded border px-3 py-2 outline-none" style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)', direction: 'ltr' }} placeholder="owner@company.com" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs mb-2" style={{ color: 'var(--t3)' }}>الخطة</label>
                    <div className="flex gap-2">
                      {(['starter', 'growth', 'enterprise'] as OrgPlan[]).map((p) => (
                        <button key={p} type="button" onClick={() => applyPreset(p, setCScreens, setCPlan)} className="flex-1 py-1.5 rounded border text-xs font-medium" style={{ borderColor: cPlan === p ? 'var(--gold)' : 'var(--rim2)', background: cPlan === p ? 'var(--gold-bg)' : 'transparent', color: cPlan === p ? 'var(--gold)' : 'var(--t2)' }}>
                          {PLAN_LABELS[p]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs mb-1" style={{ color: 'var(--t3)' }}>الحد الأقصى للأعضاء</label>
                    <input type="number" value={cMaxUsers} onChange={(e: { target: { value: string } }) => setCMaxUsers(e.target.value)} min="1" placeholder="غير محدود" className="w-32 text-sm rounded border px-3 py-1.5 outline-none" style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)' }} />
                  </div>

                  <div>
                    <label className="block text-xs mb-1" style={{ color: 'var(--t3)' }}>ملاحظات</label>
                    <textarea value={cNotes} onChange={(e: { target: { value: string } }) => setCNotes(e.target.value)} rows={2} className="w-full text-sm rounded border px-3 py-2 outline-none resize-none" style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)' }} />
                  </div>

                  <button type="submit" disabled={creating} className="w-full py-2.5 rounded text-sm font-bold" style={{ background: 'var(--gold)', color: '#fff', opacity: creating ? 0.6 : 1 }}>
                    {creating ? 'جارٍ الإنشاء...' : 'إنشاء الحساب وإرسال دعوة'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Org list */}
      <div className="w-72 shrink-0 flex flex-col border-l" style={{ borderColor: 'var(--rim1)', background: 'var(--surface)' }}>
        <div className="p-4 border-b space-y-3" style={{ borderColor: 'var(--rim1)' }}>
          <div className="flex items-center justify-between">
            <h1 className="text-sm font-bold">لوحة الأدمن العام</h1>
            <button onClick={openCreate} className="text-xs px-2.5 py-1 rounded font-bold" style={{ background: 'var(--gold)', color: '#fff' }}>+ حساب</button>
          </div>
          <input value={search} onChange={(e: { target: { value: string } }) => setSearch(e.target.value)} placeholder="بحث..." className="w-full text-sm rounded-md px-3 py-2 border outline-none" style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)' }} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map((org) => {
            const p = planOf(org.config);
            const isSel = selectedId === org.id;
            return (
              <button key={org.id} onClick={() => selectOrg(org)} className="w-full text-right px-4 py-3 border-b transition-colors" style={{ borderColor: 'var(--rim1)', background: isSel ? 'var(--gold-bg)' : 'transparent', color: isSel ? 'var(--gold)' : 'var(--t1)' }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">{org.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0" style={{ color: PLAN_COLORS[p], background: 'var(--rim1)' }}>{PLAN_LABELS[p]}</span>
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

      {/* Config panel */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selected ? (
          <div className="flex items-center justify-center" style={{ height: '60vh', color: 'var(--t3)' }}>
            <p className="text-sm">اختر مؤسسة أو أنشئ حساباً جديداً</p>
          </div>
        ) : (
          <div className="max-w-2xl space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold">{selected.name}</h2>
                <p className="text-sm mt-0.5" style={{ color: 'var(--t3)' }}>{selected.slug} · {selected.memberCount} عضو</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleReset} disabled={saving} className="text-xs px-3 py-1.5 rounded border" style={{ borderColor: 'var(--rim2)', color: 'var(--crimson)' }}>إعادة افتراضي</button>
                <button onClick={handleSave} disabled={saving} className="text-xs px-4 py-1.5 rounded font-bold" style={{ background: 'var(--gold)', color: '#fff', opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'حفظ'}</button>
              </div>
            </div>

            {msg && <p className="text-sm px-3 py-2 rounded" style={{ background: 'var(--rim1)', color: msg.startsWith('خطأ') ? 'var(--crimson)' : 'var(--emerald)' }}>{msg}</p>}

            <section className="rounded-lg border p-4 space-y-4" style={{ borderColor: 'var(--rim1)', background: 'var(--surface)' }}>
              <h3 className="font-semibold text-sm">الخطة والحالة</h3>
              <div className="flex gap-2">
                {(['starter', 'growth', 'enterprise'] as OrgPlan[]).map((p) => (
                  <button key={p} onClick={() => applyPreset(p, setEditScreens, setEditPlan)} className="flex-1 py-2 rounded border text-sm font-medium" style={{ borderColor: editPlan === p ? 'var(--gold)' : 'var(--rim2)', background: editPlan === p ? 'var(--gold-bg)' : 'transparent', color: editPlan === p ? 'var(--gold)' : 'var(--t2)' }}>{PLAN_LABELS[p]}</button>
                ))}
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={editActive} onChange={(e: { target: { checked: boolean } }) => setEditActive(e.target.checked)} className="w-4 h-4 rounded" />
                <span className="text-sm">المؤسسة مفعّلة</span>
              </label>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--t3)' }}>الحد الأقصى للأعضاء</label>
                <input type="number" value={editMaxUsers} onChange={(e: { target: { value: string } }) => setEditMaxUsers(e.target.value)} min="1" placeholder="غير محدود" className="w-32 text-sm rounded border px-3 py-1.5 outline-none" style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)' }} />
              </div>
            </section>

            <section className="rounded-lg border p-4 space-y-3" style={{ borderColor: 'var(--rim1)', background: 'var(--surface)' }}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">الشاشات المتاحة</h3>
                <span className="text-xs" style={{ color: 'var(--t3)' }}>{editScreens.length} / {ALL_SCREENS.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {ALL_SCREENS.map((s) => (
                  <label key={s.slug} className="flex items-center gap-2 cursor-pointer py-0.5">
                    <input type="checkbox" checked={editScreens.includes(s.slug)} onChange={() => setEditScreens((prev) => prev.includes(s.slug) ? prev.filter((x) => x !== s.slug) : [...prev, s.slug])} className="w-4 h-4 rounded shrink-0" />
                    <span className="text-sm">{s.label}</span>
                  </label>
                ))}
              </div>
            </section>

            <section className="rounded-lg border p-4" style={{ borderColor: 'var(--rim1)', background: 'var(--surface)' }}>
              <h3 className="font-semibold text-sm mb-2">ملاحظات داخلية</h3>
              <textarea value={editNotes} onChange={(e: { target: { value: string } }) => setEditNotes(e.target.value)} rows={3} className="w-full text-sm rounded border px-3 py-2 outline-none resize-none" style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)' }} />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
