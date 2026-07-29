'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { FormDialog } from '@/components/ui/FormDialog';
import type { ShippingRate } from './ShippingClient';

interface Props {
  open: boolean;
  onClose: () => void;
  zoneId: string | null;
  onSuccess: () => void;
}

export function CreateRateModal({ open, onClose, zoneId, onSuccess }: Props) {
  const [rateName, setRateName] = useState('');
  const [rateType, setRateType] = useState<ShippingRate['rateType']>('flat');
  const [ratePrice, setRatePrice] = useState('');
  const [rateMinOrder, setRateMinOrder] = useState('');
  const [rateMaxOrder, setRateMaxOrder] = useState('');
  const [rateDaysMin, setRateDaysMin] = useState('');
  const [rateDaysMax, setRateDaysMax] = useState('');

  const createRateMutation = trpc.shipping.rates.create.useMutation({
    onSuccess: () => {
      setRateName('');
      setRateType('flat');
      setRatePrice('');
      setRateMinOrder('');
      setRateMaxOrder('');
      setRateDaysMin('');
      setRateDaysMax('');
      onSuccess();
    },
  });

  const handleCreateRate = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!zoneId) return;
    createRateMutation.mutate({
      zoneId,
      name: rateName,
      rateType,
      price: rateType === 'free' ? 0 : parseFloat(ratePrice) || 0,
      minOrderValue: rateMinOrder ? parseFloat(rateMinOrder) : undefined,
      maxOrderValue: rateMaxOrder ? parseFloat(rateMaxOrder) : undefined,
      estimatedDaysMin: rateDaysMin ? parseInt(rateDaysMin) : undefined,
      estimatedDaysMax: rateDaysMax ? parseInt(rateDaysMax) : undefined,
    });
  };

  return (
    <FormDialog open={open} onClose={onClose} title="إضافة سعر شحن">
      <form onSubmit={handleCreateRate} className="space-y-3">
        <div>
          <label className="block text-sm text-[var(--t2)] mb-1">الاسم</label>
          <input
            required
            value={rateName}
            onChange={(e) => setRateName(e.target.value)}
            className="w-full p-2 border rounded border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]"
          />
        </div>
        <div>
          <label className="block text-sm text-[var(--t2)] mb-1">النوع</label>
          <select
            value={rateType}
            onChange={(e) => setRateType(e.target.value as ShippingRate['rateType'])}
            className="w-full p-2 border rounded border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]"
          >
            <option value="flat">ثابت</option>
            <option value="weight_based">حسب الوزن</option>
            <option value="price_based">حسب السعر</option>
            <option value="free">مجاني</option>
          </select>
        </div>
        {rateType !== 'free' && (
          <div>
            <label className="block text-sm text-[var(--t2)] mb-1">السعر</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={ratePrice}
              onChange={(e) => setRatePrice(e.target.value)}
              className="w-full p-2 border rounded border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]"
              dir="ltr"
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm text-[var(--t2)] mb-1">أدنى طلب</label>
            <input
              type="number"
              min="0"
              value={rateMinOrder}
              onChange={(e) => setRateMinOrder(e.target.value)}
              className="w-full p-2 border rounded border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--t2)] mb-1">أقصى طلب</label>
            <input
              type="number"
              min="0"
              value={rateMaxOrder}
              onChange={(e) => setRateMaxOrder(e.target.value)}
              className="w-full p-2 border rounded border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]"
              dir="ltr"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm text-[var(--t2)] mb-1">أيام توصيل (من)</label>
            <input
              type="number"
              min="0"
              value={rateDaysMin}
              onChange={(e) => setRateDaysMin(e.target.value)}
              className="w-full p-2 border rounded border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--t2)] mb-1">أيام توصيل (إلى)</label>
            <input
              type="number"
              min="0"
              value={rateDaysMax}
              onChange={(e) => setRateDaysMax(e.target.value)}
              className="w-full p-2 border rounded border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]"
              dir="ltr"
            />
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            type="submit"
            disabled={createRateMutation.isPending}
            style={{ background: 'var(--emerald)', color: '#fff' }}
          >
            {createRateMutation.isPending ? '...' : 'إضافة'}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}
