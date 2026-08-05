import { useState } from 'react';
import { type OrgPlan, PLAN_SCREENS, toSlug } from '@/lib/platformPlans';
import { statusMaps } from '@/lib/statusMaps';
import { FormDialog } from '@/components/ui/FormDialog';

interface Props {
  show: boolean;
  onClose: () => void;
  creating: boolean;
  inviteUrl: string | null;
  onCreate: (data: {
    name: string;
    slug: string;
    ownerEmail: string;
    plan: OrgPlan;
    enabledScreens: string[];
    maxUsers: number | null;
    notes: string | null;
  }) => void;
}

export function CreateOrgModal({ show, onClose, creating, inviteUrl, onCreate }: Props) {
  const [cName, setCName] = useState('');
  const [cSlug, setCSlug] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cPlan, setCPlan] = useState<OrgPlan>('starter');
  const [cScreens, setCScreens] = useState<string[]>(PLAN_SCREENS.starter);
  const [cMaxUsers, setCMaxUsers] = useState('');
  const [cNotes, setCNotes] = useState('');

  // Reset form when opened initially (if needed, this can be handled via key or parent)
  // We'll trust the parent to remount or we can keep it as is.

  function applyPreset(plan: OrgPlan) {
    setCPlan(plan);
    setCScreens(PLAN_SCREENS[plan]);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!cName || !cSlug || !cEmail) return;
    onCreate({
      name: cName,
      slug: cSlug,
      ownerEmail: cEmail,
      plan: cPlan,
      enabledScreens: cScreens,
      maxUsers: cMaxUsers ? Number(cMaxUsers) : null,
      notes: cNotes || null,
    });
  }

  return (
    <FormDialog open={show} onClose={onClose} title="إنشاء حساب جديد">
      {inviteUrl ? (
        <div className="space-y-4">
          <h2 className="font-bold text-base">تم إنشاء الحساب</h2>
          <p className="text-sm" style={{ color: 'var(--t2)' }}>أرسل رابط الدعوة التالي لصاحب الحساب:</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={inviteUrl}
              className="flex-1 text-xs rounded-md border px-3 py-2 outline-none"
              style={{ borderColor: 'var(--rim2)', background: 'var(--rim1)', color: 'var(--t1)', direction: 'ltr' }}
            />
            <button
              onClick={() => navigator.clipboard.writeText(inviteUrl)}
              className="text-xs px-3 rounded-md border font-medium"
              style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
            >
              نسخ
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--t3)' }}>الرابط صالح ٧ أيام</p>
          <button
            onClick={onClose}
            className="w-full py-2 rounded-md text-sm font-bold"
            style={{ background: 'var(--gold)', color: 'var(--void)' }}
          >
            إغلاق
          </button>
        </div>
      ) : (
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs mb-1" style={{ color: 'var(--t3)' }}>اسم المؤسسة *</label>
              <input
                required
                value={cName}
                onChange={(e: { target: { value: string } }) => {
                  setCName(e.target.value);
                  setCSlug(toSlug(e.target.value));
                }}
                className="w-full text-sm rounded-md border px-3 py-2 outline-none"
                style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)' }}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs mb-1" style={{ color: 'var(--t3)' }}>المعرّف (slug) *</label>
              <input
                required
                value={cSlug}
                onChange={(e: { target: { value: string } }) => setCSlug(e.target.value)}
                className="w-full text-sm rounded-md border px-3 py-2 outline-none"
                style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)', direction: 'ltr' }}
                placeholder="my-org"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs mb-1" style={{ color: 'var(--t3)' }}>بريد المسؤول *</label>
              <input
                required
                type="email"
                value={cEmail}
                onChange={(e: { target: { value: string } }) => setCEmail(e.target.value)}
                className="w-full text-sm rounded-md border px-3 py-2 outline-none"
                style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)', direction: 'ltr' }}
                placeholder="owner@company.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs mb-2" style={{ color: 'var(--t3)' }}>الخطة</label>
            <div className="flex gap-2">
              {(['starter', 'growth', 'enterprise'] as OrgPlan[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className="flex-1 py-1.5 rounded-md border text-xs font-medium"
                  style={{
                    borderColor: cPlan === p ? 'var(--gold)' : 'var(--rim2)',
                    background: cPlan === p ? 'var(--gold-bg)' : 'transparent',
                    color: cPlan === p ? 'var(--gold)' : 'var(--t2)',
                  }}
                >
                  {statusMaps.plan[p].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--t3)' }}>الحد الأقصى للأعضاء</label>
            <input
              type="number"
              value={cMaxUsers}
              onChange={(e: { target: { value: string } }) => setCMaxUsers(e.target.value)}
              min="1"
              placeholder="غير محدود"
              className="w-32 text-sm rounded-md border px-3 py-1.5 outline-none"
              style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)' }}
            />
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--t3)' }}>ملاحظات</label>
            <textarea
              value={cNotes}
              onChange={(e: { target: { value: string } }) => setCNotes(e.target.value)}
              rows={2}
              className="w-full text-sm rounded-md border px-3 py-2 outline-none resize-none"
              style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)' }}
            />
          </div>

          <button
            type="submit"
            disabled={creating}
            className="w-full py-2.5 rounded-md text-sm font-bold"
            style={{ background: 'var(--gold)', color: 'var(--void)', opacity: creating ? 0.6 : 1 }}
          >
            {creating ? 'جارٍ الإنشاء...' : 'إنشاء الحساب وإرسال دعوة'}
          </button>
        </form>
      )}
    </FormDialog>
  );
}
