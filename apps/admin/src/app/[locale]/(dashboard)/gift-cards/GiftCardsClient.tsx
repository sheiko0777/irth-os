'use client';
import { currency, formatMoney, fromMinor, type Money } from '@irth/domain';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/ui/EmptyState';
import { trpc } from '@/lib/trpc';
import { FormDialog } from '@/components/ui/FormDialog';
import { StatusBadge } from '@/components/ui/StatusBadge';

export type GiftCard = {
  id: string;
  code: string;
  initialAmountMinor: bigint;
  balanceMinor: bigint;
  currency: string;
  status: 'active' | 'redeemed' | 'expired' | 'cancelled';
  recipientName: string | null;
  recipientEmail: string | null;
  message: string | null;
  expiresAt: Date | null;
  createdAt: Date;
};

export type GiftCardSummary = {
  total: number;
  active: number;
  totalIssued: Money;
  activeBalance: Money;
};

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className='rounded-xl border border-[var(--rim1)] bg-[var(--surface)] p-5'>
      <div className='text-sm text-[var(--t2)] mb-1'>{label}</div>
      <div className='text-2xl font-bold text-[var(--t1)]'>{value}</div>
    </div>
  );
}

// Was a local parseFloat formatter. The shared one renders the localized currency symbol rather than the
// raw currency code and groups the digits the same way every other screen does.
function formatAmount(amount: Money) {
  return formatMoney(amount);
}

export default function GiftCardsClient({
  initialData,
  summary,
}: {
  initialData: GiftCard[];
  summary: GiftCardSummary;
}) {
  const t = useTranslations('giftCards');
  const [cards, setCards] = useState<GiftCard[]>(initialData);
  const [sum, setSum] = useState<GiftCardSummary>(summary);
  const [showCreate, setShowCreate] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // create form
  const [amount, setAmount] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [message, setMessage] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [createErr, setCreateErr] = useState('');

  const listQuery = trpc.giftCards.list.useQuery(undefined, { enabled: false });
  const summaryQuery = trpc.giftCards.summary.useQuery(undefined, { enabled: false });

  const refresh = async () => {
    const [lr, sr] = await Promise.all([listQuery.refetch(), summaryQuery.refetch()]);
    if (lr.data?.data) setCards(lr.data.data as GiftCard[]);
    if (sr.data?.data) setSum(sr.data.data as GiftCardSummary);
  };

  const createMutation = trpc.giftCards.create.useMutation({
    onSuccess: () => {
      setShowCreate(false);
      setAmount(''); setRecipientName(''); setRecipientEmail(''); setMessage(''); setExpiresAt('');
      setCreateErr('');
      refresh();
    },
    onError: (e) => setCreateErr(e.message),
  });

  const cancelMutation = trpc.giftCards.cancel.useMutation({ onSuccess: refresh });

  const handleCreate = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setCreateErr(t('validation.amountPositive')); return; }
    createMutation.mutate({
      initialAmount: amt,
      recipientName: recipientName || undefined,
      recipientEmail: recipientEmail || undefined,
      message: message || undefined,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    });
  };

  return (
    <div>
      {/* Header */}
      <div className='flex items-center justify-between mb-6'>
        <div>
          <h1 className='text-2xl font-bold text-[var(--t1)]'>{t('title')}</h1>
          <p className='text-sm text-[var(--t2)] mt-1'>{t('subtitle')}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className='rounded-lg px-4 py-2 text-sm font-medium text-void'
          style={{ background: 'var(--gold)' }}
        >
          {t('actions.issue')}
        </button>
      </div>

      {/* Stats */}
      <div className='grid grid-cols-2 gap-4 md:grid-cols-4 mb-6'>
        <StatCard label={t('summary.total')} value={sum.total} />
        <StatCard label={t('summary.active')} value={sum.active} />
        <StatCard label={t('summary.totalIssued')} value={formatAmount(sum.totalIssued)} />
        <StatCard label={t('summary.activeBalance')} value={formatAmount(sum.activeBalance)} />
      </div>

      {/* Table */}
      <div className='rounded-xl border border-[var(--rim1)] bg-[var(--surface)] overflow-hidden'>
        <div className='overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='border-b border-[var(--rim1)] text-[var(--t2)]'>
                <th className='px-4 py-3 text-start font-medium'>{t('table.code')}</th>
                <th className='px-4 py-3 text-start font-medium'>{t('table.balance')}</th>
                <th className='px-4 py-3 text-start font-medium'>{t('table.initialAmount')}</th>
                <th className='px-4 py-3 text-start font-medium'>{t('table.recipient')}</th>
                <th className='px-4 py-3 text-start font-medium'>{t('table.status')}</th>
                <th className='px-4 py-3 text-start font-medium'>{t('table.issuedAt')}</th>
                <th className='px-4 py-3 text-start font-medium'>{t('table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {cards.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-0"><EmptyState title={t('empty.title')} hint={t('empty.hint')} /></td>
                </tr>
              )}
              {cards.map((card) => (
                <tr key={card.id} className='border-b border-[var(--rim1)] hover:bg-[var(--rim1)] transition-colors'>
                  <td className='px-4 py-3'>
                    <div className='flex items-center gap-2'>
                      <span className='font-mono text-xs font-bold tracking-wider text-[var(--gold)]'>
                        {card.code}
                      </span>
                      <button
                        onClick={() => copyCode(card.code)}
                        className='text-xs px-2 py-0.5 rounded-md border border-[var(--rim2)] text-[var(--t2)] hover:text-[var(--t1)] transition-colors'
                      >
                        {copiedCode === card.code ? t('actions.copied') : t('actions.copy')}
                      </button>
                    </div>
                  </td>
                  <td className='px-4 py-3 font-semibold text-[var(--t1)]'>
                    {formatAmount(fromMinor(card.balanceMinor, currency(card.currency)))}
                  </td>
                  <td className='px-4 py-3 text-[var(--t2)]'>
                    {formatAmount(fromMinor(card.initialAmountMinor, currency(card.currency)))}
                  </td>
                  <td className='px-4 py-3 text-[var(--t2)]'>
                    {card.recipientName || '—'}
                  </td>
                  <td className='px-4 py-3'>
                    <StatusBadge status={card.status} domain="giftCard" />
                  </td>
                  <td className='px-4 py-3 text-[var(--t2)] text-xs'>
                    {new Date(card.createdAt).toLocaleDateString('ar-EG')}
                  </td>
                  <td className='px-4 py-3'>
                    {card.status === 'active' && (
                      <button
                        onClick={() => cancelMutation.mutate({ id: card.id })}
                        className='text-xs text-[var(--crimson)] hover:underline'
                      >
                        {t('actions.cancel')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      <FormDialog open={showCreate} onClose={() => { setShowCreate(false); setCreateErr(''); }} title={t('createModal.title')} width="448px">
        <form onSubmit={handleCreate} className='space-y-4'>
          <div>
            <label className='block text-sm text-[var(--t2)] mb-1'>{t('form.amount')}</label>
            <input
              type='number'
              min='1'
              step='0.01'
              value={amount}
              onChange={(e: { target: { value: string } }) => setAmount(e.target.value)}
              className='w-full rounded-lg border border-[var(--rim2)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--t1)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)]'
              placeholder={t('form.amountPlaceholder')}
              required
            />
          </div>
          <div>
            <label className='block text-sm text-[var(--t2)] mb-1'>{t('form.recipientName')}</label>
            <input
              type='text'
              value={recipientName}
              onChange={(e: { target: { value: string } }) => setRecipientName(e.target.value)}
              className='w-full rounded-lg border border-[var(--rim2)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--t1)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)]'
              placeholder={t('form.optional')}
            />
          </div>
          <div>
            <label className='block text-sm text-[var(--t2)] mb-1'>{t('form.recipientEmail')}</label>
            <input
              type='email'
              value={recipientEmail}
              onChange={(e: { target: { value: string } }) => setRecipientEmail(e.target.value)}
              className='w-full rounded-lg border border-[var(--rim2)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--t1)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)]'
              placeholder={t('form.optional')}
              dir='ltr'
            />
          </div>
          <div>
            <label className='block text-sm text-[var(--t2)] mb-1'>{t('form.message')}</label>
            <textarea
              value={message}
              onChange={(e: { target: { value: string } }) => setMessage(e.target.value)}
              className='w-full rounded-lg border border-[var(--rim2)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--t1)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)] resize-none'
              rows={2}
              placeholder={t('form.messagePlaceholder')}
            />
          </div>
          <div>
            <label className='block text-sm text-[var(--t2)] mb-1'>{t('form.expiresAt')}</label>
            <input
              type='date'
              value={expiresAt}
              onChange={(e: { target: { value: string } }) => setExpiresAt(e.target.value)}
              className='w-full rounded-lg border border-[var(--rim2)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--t1)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)]'
              dir='ltr'
            />
          </div>
          {createErr && <p className='text-sm' style={{ color: 'var(--crimson)' }}>{createErr}</p>}
          <div className='flex gap-3 pt-2'>
            <button
              type='submit'
              disabled={createMutation.isPending}
              className='flex-1 rounded-lg py-2 text-sm font-medium text-void disabled:opacity-50'
              style={{ background: 'var(--gold)' }}
            >
              {createMutation.isPending ? t('actions.issuing') : t('actions.issueCard')}
            </button>
            <button
              type='button'
              onClick={() => { setShowCreate(false); setCreateErr(''); }}
              className='flex-1 rounded-lg border border-[var(--rim2)] py-2 text-sm text-[var(--t2)] hover:text-[var(--t1)] transition-colors'
            >
              {t('actions.cancel')}
            </button>
          </div>
        </form>
      </FormDialog>
    </div>
  );
}