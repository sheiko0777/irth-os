'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { trpc } from '@/lib/trpc';

export type GiftCard = {
  id: string;
  code: string;
  initialAmount: string;
  balance: string;
  currency: string;
  status: 'active' | 'redeemed' | 'expired' | 'cancelled';
  recipientName: string | null;
  recipientEmail: string | null;
  message: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type GiftCardSummary = {
  total: number;
  active: number;
  totalIssued: number;
  activeBalance: number;
};

import { StatusBadge } from '@/components/ui/StatusBadge';

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className='rounded-xl border border-[var(--rim1)] bg-[var(--surface)] p-5'>
      <div className='text-sm text-[var(--t2)] mb-1'>{label}</div>
      <div className='text-2xl font-bold text-[var(--t1)]'>{value}</div>
    </div>
  );
}

function formatAmount(amount: string | number, currency = 'EGP') {
  return `${parseFloat(String(amount)).toLocaleString('ar-EG', { minimumFractionDigits: 2 })} ${currency}`;
}

export default function GiftCardsClient({
  initialData,
  summary,
}: {
  initialData: GiftCard[];
  summary: GiftCardSummary;
}) {
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
    if (!amt || amt <= 0) { setCreateErr('المبلغ يجب أن يكون أكبر من صفر'); return; }
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
          <h1 className='text-2xl font-bold text-[var(--t1)]'>بطاقات الهدايا والرصيد</h1>
          <p className='text-sm text-[var(--t2)] mt-1'>إصدار وإدارة بطاقات الهدايا</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className='rounded-lg px-4 py-2 text-sm font-medium text-void'
          style={{ background: 'var(--gold)' }}
        >
          + إصدار بطاقة هدية
        </button>
      </div>

      {/* Stats */}
      <div className='grid grid-cols-2 gap-4 md:grid-cols-4 mb-6'>
        <StatCard label='إجمالي البطاقات' value={sum.total} />
        <StatCard label='البطاقات النشطة' value={sum.active} />
        <StatCard label='إجمالي المُصدر' value={formatAmount(sum.totalIssued)} />
        <StatCard label='الرصيد النشط' value={formatAmount(sum.activeBalance)} />
      </div>

      {/* Table */}
      <div className='rounded-xl border border-[var(--rim1)] bg-[var(--surface)] overflow-hidden'>
        <div className='overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='border-b border-[var(--rim1)] text-[var(--t2)]'>
                <th className='px-4 py-3 text-right font-medium'>الكود</th>
                <th className='px-4 py-3 text-right font-medium'>الرصيد</th>
                <th className='px-4 py-3 text-right font-medium'>المبلغ الأصلي</th>
                <th className='px-4 py-3 text-right font-medium'>المستلم</th>
                <th className='px-4 py-3 text-right font-medium'>الحالة</th>
                <th className='px-4 py-3 text-right font-medium'>تاريخ الإصدار</th>
                <th className='px-4 py-3 text-right font-medium'>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {cards.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-0"><EmptyState title="لا توجد بطاقات هدايا" hint="البطاقة برصيد مدفوع مقدماً، العميل يستخدمها في الدفع." /></td>
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
                        {copiedCode === card.code ? 'تم النسخ' : 'نسخ'}
                      </button>
                    </div>
                  </td>
                  <td className='px-4 py-3 font-semibold text-[var(--t1)]'>
                    {formatAmount(card.balance, card.currency)}
                  </td>
                  <td className='px-4 py-3 text-[var(--t2)]'>
                    {formatAmount(card.initialAmount, card.currency)}
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
                        إلغاء
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
      {showCreate && (
        <div className='fixed inset-0 z-50 flex items-center justify-center' style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className='rounded-xl border border-[var(--rim1)] bg-[var(--surface)] p-6 w-full max-w-md shadow-2xl'>
            <h2 className='text-lg font-bold text-[var(--t1)] mb-4'>إصدار بطاقة هدية جديدة</h2>
            <form onSubmit={handleCreate} className='space-y-4'>
              <div>
                <label className='block text-sm text-[var(--t2)] mb-1'>المبلغ (جنيه مصري) *</label>
                <input
                  type='number'
                  min='1'
                  step='0.01'
                  value={amount}
                  onChange={(e: { target: { value: string } }) => setAmount(e.target.value)}
                  className='w-full rounded-lg border border-[var(--rim2)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--t1)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)]'
                  placeholder='مثال: 500'
                  required
                />
              </div>
              <div>
                <label className='block text-sm text-[var(--t2)] mb-1'>اسم المستلم</label>
                <input
                  type='text'
                  value={recipientName}
                  onChange={(e: { target: { value: string } }) => setRecipientName(e.target.value)}
                  className='w-full rounded-lg border border-[var(--rim2)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--t1)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)]'
                  placeholder='اختياري'
                />
              </div>
              <div>
                <label className='block text-sm text-[var(--t2)] mb-1'>البريد الإلكتروني للمستلم</label>
                <input
                  type='email'
                  value={recipientEmail}
                  onChange={(e: { target: { value: string } }) => setRecipientEmail(e.target.value)}
                  className='w-full rounded-lg border border-[var(--rim2)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--t1)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)]'
                  placeholder='اختياري'
                  dir='ltr'
                />
              </div>
              <div>
                <label className='block text-sm text-[var(--t2)] mb-1'>رسالة هدية</label>
                <textarea
                  value={message}
                  onChange={(e: { target: { value: string } }) => setMessage(e.target.value)}
                  className='w-full rounded-lg border border-[var(--rim2)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--t1)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)] resize-none'
                  rows={2}
                  placeholder='رسالة مع البطاقة (اختياري)'
                />
              </div>
              <div>
                <label className='block text-sm text-[var(--t2)] mb-1'>تاريخ انتهاء الصلاحية</label>
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
                  {createMutation.isPending ? 'جارٍ الإصدار…' : 'إصدار البطاقة'}
                </button>
                <button
                  type='button'
                  onClick={() => { setShowCreate(false); setCreateErr(''); }}
                  className='flex-1 rounded-lg border border-[var(--rim2)] py-2 text-sm text-[var(--t2)] hover:text-[var(--t1)] transition-colors'
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
