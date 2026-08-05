'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { trpc } from '@/lib/trpc';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export type Campaign = {
  id: string;
  orgId: string;
  name: string;
  message: string;
  channel: 'whatsapp' | 'sms' | 'email';
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';
  targetSegment: 'all' | 'vip' | 'inactive' | 'new' | 'custom';
  scheduledAt: Date | null;
  sentAt: Date | null;
  totalRecipients: number;
  deliveredCount: number;
  failedCount: number;
  createdAt: Date;
};

export type CampaignSummary = {
  total: number;
  sent: number;
  inProgress: number;
  totalDelivered: number;
};

import { StatusBadge } from '@/components/ui/StatusBadge';
import { statusLabel } from '@/lib/statusMaps';

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl p-5 border" style={{ background: 'var(--surface)', borderColor: 'var(--rim1)' }}>
      <p className="text-sm mb-1" style={{ color: 'var(--t2)' }}>{label}</p>
      <p className="text-3xl font-bold" style={{ color: 'var(--gold)' }}>{value.toLocaleString('ar-EG')}</p>
    </div>
  );
}

export default function CampaignsClient({
  initialData,
  summary,
}: {
  initialData: Campaign[];
  summary: CampaignSummary;
}) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialData);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [previewCampaign, setPreviewCampaign] = useState<Campaign | null>(null);
  const [form, setForm] = useState({
    name: '',
    message: '',
    channel: 'whatsapp' as Campaign['channel'],
    targetSegment: 'all' as Campaign['targetSegment'],
    scheduledAt: '',
  });

  const createMutation = trpc.campaigns.create.useMutation({
    onSuccess: (res) => {
      toast.success('تم إنشاء الحملة بنجاح');
      if (res.data) setCampaigns((prev) => [res.data as unknown as Campaign, ...prev]);
      setIsCreateOpen(false);
      setForm({ name: '', message: '', channel: 'whatsapp', targetSegment: 'all', scheduledAt: '' });
      router.refresh();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء إنشاء الحملة');
    },
  });

  const sendMutation = trpc.campaigns.send.useMutation({
    onSuccess: (res) => {
      toast.success('تم إرسال الحملة');
      if (res.data) setCampaigns((prev) => prev.map((c) => (c.id === res.data?.id ? (res.data as unknown as Campaign) : c)));
      router.refresh();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء الإرسال');
    },
  });

  const deleteMutation = trpc.campaigns.delete.useMutation({
    onSuccess: (_: unknown, vars: { id: string }) => {
      toast.success('تم حذف الحملة');
      setCampaigns((prev) => prev.filter((c) => c.id !== vars.id));
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء الحذف');
    },
  });

  const handleCreate = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    createMutation.mutate({
      name: form.name,
      message: form.message,
      channel: form.channel,
      targetSegment: form.targetSegment,
      scheduledAt: form.scheduledAt ? new Date(form.scheduledAt) : undefined,
    });
  };

  return (
    <div className="p-6" style={{ color: 'var(--t1)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">مدير الحملات التسويقية</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--t2)' }}>إرسال رسائل واتساب وSMS للعملاء</p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="px-4 py-2 rounded-lg font-semibold text-sm"
          style={{ background: 'var(--gold)', color: 'var(--void)' }}
        >
          + حملة جديدة
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="إجمالي الحملات" value={summary.total} />
        <StatCard label="تم الإرسال" value={summary.sent} />
        <StatCard label="قيد التنفيذ" value={summary.inProgress} />
        <StatCard label="رسائل مُسلَّمة" value={summary.totalDelivered} />
      </div>

      {/* Campaigns Table */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--rim1)', background: 'var(--surface)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rim1)' }}>
              {['اسم الحملة', 'القناة', 'الشريحة', 'الحالة', 'المستلمون', 'الإرسال', 'إجراءات'].map((h) => (
                <th key={h} className="px-4 py-3 text-right font-semibold" style={{ color: 'var(--t2)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 && (
              <tr><td colSpan={7} className="p-0"><EmptyState title="لا توجد حملات بعد" hint="الحملة بتبعت رسالة لشريحة عملاء عبر واتساب أو البريد." /></td></tr>
            )}
            {campaigns.map((c) => (
              <tr key={c.id} className="border-t" style={{ borderColor: 'var(--rim1)' }}>
                <td className="px-4 py-3 font-medium">
                  <button onClick={() => setPreviewCampaign(c)} className="hover:underline" style={{ color: 'var(--gold)' }}>{c.name}</button>
                </td>
                <td className="px-4 py-3" style={{ color: 'var(--t2)' }}>{statusLabel('campaignChannel', c.channel)}</td>
                <td className="px-4 py-3" style={{ color: 'var(--t2)' }}>{statusLabel('campaignSegment', c.targetSegment)}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={c.status} domain="campaign" />
                </td>
                <td className="px-4 py-3 text-center">{c.totalRecipients > 0 ? c.deliveredCount + '/' + c.totalRecipients : '—'}</td>
                <td className="px-4 py-3" style={{ color: 'var(--t2)' }}>{c.sentAt ? new Date(c.sentAt).toLocaleDateString('ar-EG') : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 justify-end">
                    {(c.status === 'draft' || c.status === 'scheduled') && (
                      <ConfirmDialog
                        title="إرسال الحملة"
                        description={`سيتم إرسال الحملة «${c.name}» الآن إلى جميع المستلمين المستهدفين.`}
                        confirmLabel="إرسال"
                        destructive={false}
                        pending={sendMutation.isPending}
                        onConfirm={() => sendMutation.mutate({ id: c.id })}>
                        <button
                          className="px-3 py-1 rounded-md text-xs font-semibold"
                          style={{ background: 'var(--emerald)', color: 'var(--void)' }}>
                          إرسال
                        </button>
                      </ConfirmDialog>
                    )}
                    {c.status !== 'sending' && (
                      <ConfirmDialog
                        title="حذف الحملة"
                        description={`هل أنت متأكد من حذف الحملة «${c.name}»؟`}
                        confirmLabel="حذف"
                        pending={deleteMutation.isPending}
                        onConfirm={() => deleteMutation.mutate({ id: c.id })}>
                        <button
                          className="px-3 py-1 rounded-md text-xs"
                          style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--crimson)' }}>
                          حذف
                        </button>
                      </ConfirmDialog>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <form onSubmit={handleCreate} className="rounded-xl p-6 w-full max-w-lg border" style={{ background: 'var(--surface)', borderColor: 'var(--rim1)' }}>
            <h2 className="text-lg font-bold mb-5">حملة جديدة</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--t2)' }}>اسم الحملة</label>
                <input value={form.name}
                  onChange={(e: { target: { value: string } }) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{ background: 'var(--surface)', borderColor: 'var(--rim1)', color: 'var(--t1)' }}
                  placeholder="مثال: عروض رمضان 2026" />
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--t2)' }}>نص الرسالة</label>
                <textarea value={form.message}
                  onChange={(e: { target: { value: string } }) => setForm((f) => ({ ...f, message: e.target.value }))}
                  required rows={4} className="w-full px-3 py-2 rounded-lg border text-sm resize-none"
                  style={{ background: 'var(--surface)', borderColor: 'var(--rim1)', color: 'var(--t1)' }}
                  placeholder="نص الرسالة التي سيتلقاها العملاء..." />
                <p className="text-xs mt-1" style={{ color: 'var(--t2)' }}>{form.message.length}/1024 حرف</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm mb-1" style={{ color: 'var(--t2)' }}>القناة</label>
                  <select value={form.channel}
                    onChange={(e: { target: { value: string } }) => setForm((f) => ({ ...f, channel: e.target.value as Campaign['channel'] }))}
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    style={{ background: 'var(--surface)', borderColor: 'var(--rim1)', color: 'var(--t1)' }}>
                    <option value="whatsapp">واتساب</option>
                    <option value="sms">رسالة نصية</option>
                    <option value="email">بريد إلكتروني</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm mb-1" style={{ color: 'var(--t2)' }}>الشريحة المستهدفة</label>
                  <select value={form.targetSegment}
                    onChange={(e: { target: { value: string } }) => setForm((f) => ({ ...f, targetSegment: e.target.value as Campaign['targetSegment'] }))}
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    style={{ background: 'var(--surface)', borderColor: 'var(--rim1)', color: 'var(--t1)' }}>
                    <option value="all">جميع العملاء</option>
                    <option value="vip">عملاء VIP</option>
                    <option value="inactive">غير نشطين</option>
                    <option value="new">عملاء جدد</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--t2)' }}>جدولة (اختياري)</label>
                <input type="datetime-local" value={form.scheduledAt}
                  onChange={(e: { target: { value: string } }) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{ background: 'var(--surface)', borderColor: 'var(--rim1)', color: 'var(--t1)' }} />
              </div>
            </div>
            <div className="flex gap-3 mt-6 justify-end">
              <button type="button" onClick={() => setIsCreateOpen(false)}
                className="px-4 py-2 rounded-lg text-sm" style={{ color: 'var(--t2)' }}>إلغاء</button>
              <button type="submit" disabled={createMutation.isPending}
                className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--gold)', color: 'var(--void)' }}>
                {createMutation.isPending ? 'جاري الحفظ...' : 'إنشاء الحملة'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Preview Modal */}
      {previewCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="rounded-xl p-6 w-full max-w-md border" style={{ background: 'var(--surface)', borderColor: 'var(--rim1)' }}>
            <h2 className="text-lg font-bold mb-4">{previewCampaign.name}</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span style={{ color: 'var(--t2)' }}>القناة:</span>
                <span>{statusLabel('campaignChannel', previewCampaign.channel)}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--t2)' }}>الشريحة:</span>
                <span>{statusLabel('campaignSegment', previewCampaign.targetSegment)}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--t2)' }}>الحالة:</span>
                <StatusBadge status={previewCampaign.status} domain="campaign" />
              </div>
              <hr style={{ borderColor: 'var(--rim1)' }} />
              <div>
                <p className="mb-2" style={{ color: 'var(--t2)' }}>نص الرسالة:</p>
                <div className="p-3 rounded-lg text-sm whitespace-pre-wrap" style={{ background: 'var(--rim1)' }}>
                  {previewCampaign.message}
                </div>
              </div>
            </div>
            <button onClick={() => setPreviewCampaign(null)}
              className="mt-5 w-full py-2 rounded-lg text-sm"
              style={{ background: 'var(--rim1)', color: 'var(--t1)' }}>إغلاق</button>
          </div>
        </div>
      )}
    </div>
  );
}
