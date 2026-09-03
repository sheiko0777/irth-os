'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { trpc } from '@/lib/trpc';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { useTranslations } from 'next-intl';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { statusLabel } from '@/lib/statusMaps';

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
  const t = useTranslations('campaigns');
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
      toast.success(t('toasts.created'));
      if (res.data) setCampaigns((prev) => [res.data as unknown as Campaign, ...prev]);
      setIsCreateOpen(false);
      setForm({ name: '', message: '', channel: 'whatsapp', targetSegment: 'all', scheduledAt: '' });
      router.refresh();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : t('errors.createCampaign'));
    },
  });

  const sendMutation = trpc.campaigns.send.useMutation({
    onSuccess: (res) => {
      toast.success(t('toasts.sent'));
      if (res.data) setCampaigns((prev) => prev.map((c) => (c.id === res.data?.id ? (res.data as unknown as Campaign) : c)));
      router.refresh();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : t('errors.sendCampaign'));
    },
  });

  const deleteMutation = trpc.campaigns.delete.useMutation({
    onSuccess: (_: unknown, vars: { id: string }) => {
      toast.success(t('toasts.deleted'));
      setCampaigns((prev) => prev.filter((c) => c.id !== vars.id));
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : t('errors.deleteCampaign'));
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

  const tableHeaders = [
    t('table.name'),
    t('table.channel'),
    t('table.segment'),
    t('table.status'),
    t('table.recipients'),
    t('table.sentAt'),
    t('table.actions'),
  ];

  return (
    <div className="p-6" style={{ color: 'var(--t1)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--t2)' }}>{t('subtitle')}</p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="px-4 py-2 rounded-lg font-semibold text-sm"
          style={{ background: 'var(--gold)', color: 'var(--void)' }}
        >
          {t('actions.new')}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label={t('summary.total')} value={summary.total} />
        <StatCard label={t('summary.sent')} value={summary.sent} />
        <StatCard label={t('summary.inProgress')} value={summary.inProgress} />
        <StatCard label={t('summary.totalDelivered')} value={summary.totalDelivered} />
      </div>

      {/* Campaigns Table */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--rim1)', background: 'var(--surface)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rim1)' }}>
              {tableHeaders.map((h) => (
                <th key={h} className="px-4 py-3 text-start font-semibold" style={{ color: 'var(--t2)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 && (
              <tr><td colSpan={7} className="p-0"><EmptyState title={t('empty.title')} hint={t('empty.hint')} /></td></tr>
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
                        title={t('confirm.sendTitle')}
                        description={t('confirm.sendDescription', { name: c.name })}
                        confirmLabel={t('actions.send')}
                        destructive={false}
                        pending={sendMutation.isPending}
                        onConfirm={() => sendMutation.mutate({ id: c.id })}>
                        <button
                          className="px-3 py-1 rounded-md text-xs font-semibold"
                          style={{ background: 'var(--emerald)', color: 'var(--void)' }}>
                          {t('actions.send')}
                        </button>
                      </ConfirmDialog>
                    )}
                    {c.status !== 'sending' && (
                      <ConfirmDialog
                        title={t('confirm.deleteTitle')}
                        description={t('confirm.deleteDescription', { name: c.name })}
                        confirmLabel={t('actions.delete')}
                        pending={deleteMutation.isPending}
                        onConfirm={() => deleteMutation.mutate({ id: c.id })}>
                        <button
                          className="px-3 py-1 rounded-md text-xs"
                          style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--crimson)' }}>
                          {t('actions.delete')}
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
      <FormDialog open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title={t('createModal.title')} width="512px">
        <form onSubmit={handleCreate}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm mb-1" style={{ color: 'var(--t2)' }}>{t('form.name')}</label>
              <input value={form.name}
                onChange={(e: { target: { value: string } }) => setForm((f) => ({ ...f, name: e.target.value }))}
                required className="w-full px-3 py-2 rounded-lg border text-sm"
                style={{ background: 'var(--surface)', borderColor: 'var(--rim1)', color: 'var(--t1)' }}
                placeholder={t('form.namePlaceholder')} />
            </div>
            <div>
              <label className="block text-sm mb-1" style={{ color: 'var(--t2)' }}>{t('form.message')}</label>
              <textarea value={form.message}
                onChange={(e: { target: { value: string } }) => setForm((f) => ({ ...f, message: e.target.value }))}
                required rows={4} className="w-full px-3 py-2 rounded-lg border text-sm resize-none"
                style={{ background: 'var(--surface)', borderColor: 'var(--rim1)', color: 'var(--t1)' }}
                placeholder={t('form.messagePlaceholder')} />
              <p className="text-xs mt-1" style={{ color: 'var(--t2)' }}>{t('form.messageLength', { count: form.message.length })}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--t2)' }}>{t('form.channel')}</label>
                <select value={form.channel}
                  onChange={(e: { target: { value: string } }) => setForm((f) => ({ ...f, channel: e.target.value as Campaign['channel'] }))}
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{ background: 'var(--surface)', borderColor: 'var(--rim1)', color: 'var(--t1)' }}>
                  <option value="whatsapp">{t('channels.whatsapp')}</option>
                  <option value="sms">{t('channels.sms')}</option>
                  <option value="email">{t('channels.email')}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--t2)' }}>{t('form.targetSegment')}</label>
                <select value={form.targetSegment}
                  onChange={(e: { target: { value: string } }) => setForm((f) => ({ ...f, targetSegment: e.target.value as Campaign['targetSegment'] }))}
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{ background: 'var(--surface)', borderColor: 'var(--rim1)', color: 'var(--t1)' }}>
                  <option value="all">{t('segments.all')}</option>
                  <option value="vip">{t('segments.vip')}</option>
                  <option value="inactive">{t('segments.inactive')}</option>
                  <option value="new">{t('segments.new')}</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm mb-1" style={{ color: 'var(--t2)' }}>{t('form.scheduledAt')}</label>
              <input type="datetime-local" value={form.scheduledAt}
                onChange={(e: { target: { value: string } }) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border text-sm"
                style={{ background: 'var(--surface)', borderColor: 'var(--rim1)', color: 'var(--t1)' }} />
            </div>
          </div>
          <div className="flex gap-3 mt-6 justify-end">
            <button type="button" onClick={() => setIsCreateOpen(false)}
              className="px-4 py-2 rounded-lg text-sm" style={{ color: 'var(--t2)' }}>{t('actions.cancel')}</button>
            <button type="submit" disabled={createMutation.isPending}
              className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--gold)', color: 'var(--void)' }}>
              {createMutation.isPending ? t('actions.saving') : t('actions.create')}
            </button>
          </div>
        </form>
      </FormDialog>

      {/* Preview Modal */}
      <FormDialog
        open={!!previewCampaign}
        onClose={() => setPreviewCampaign(null)}
        title={previewCampaign?.name ?? ''}
        width="448px"
      >
        {previewCampaign && (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span style={{ color: 'var(--t2)' }}>{t('preview.channel')}</span>
              <span>{statusLabel('campaignChannel', previewCampaign.channel)}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--t2)' }}>{t('preview.segment')}</span>
              <span>{statusLabel('campaignSegment', previewCampaign.targetSegment)}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--t2)' }}>{t('preview.status')}</span>
              <StatusBadge status={previewCampaign.status} domain="campaign" />
            </div>
            <hr style={{ borderColor: 'var(--rim1)' }} />
            <div>
              <p className="mb-2" style={{ color: 'var(--t2)' }}>{t('preview.message')}</p>
              <div className="p-3 rounded-lg text-sm whitespace-pre-wrap" style={{ background: 'var(--rim1)' }}>
                {previewCampaign.message}
              </div>
            </div>
            <button onClick={() => setPreviewCampaign(null)}
              className="mt-5 w-full py-2 rounded-lg text-sm"
              style={{ background: 'var(--rim1)', color: 'var(--t1)' }}>{t('actions.close')}</button>
          </div>
        )}
      </FormDialog>
    </div>
  );
}