'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface CustomerPointsDialogProps {
  customerId: string;
  customerName?: string;
  currentPoints?: number;
}

export default function CustomerPointsDialog({ customerId, customerName, currentPoints }: CustomerPointsDialogProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  // Points form state
  const [points, setPoints] = useState('');
  const [pointsNote, setPointsNote] = useState('');
  const [pointsAction, setPointsAction] = useState<'add' | 'redeem'>('add');

  const addPointsMutation = trpc.customers.addPoints.useMutation({
    onSuccess: () => {
      toast.success('تم إضافة النقاط بنجاح');
      router.refresh();
      setIsOpen(false);
      setPoints('');
      setPointsNote('');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ');
    },
  });

  const redeemPointsMutation = trpc.customers.redeemPoints.useMutation({
    onSuccess: () => {
      toast.success('تم استخدام النقاط بنجاح');
      router.refresh();
      setIsOpen(false);
      setPoints('');
      setPointsNote('');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ');
    },
  });

  const handlePointsSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const pts = parseInt(points, 10);
    if (!customerId || isNaN(pts) || pts <= 0) {
      toast.error('يرجى إدخال عدد نقاط صحيح');
      return;
    }
    if (pointsAction === 'add') {
      addPointsMutation.mutate({ id: customerId, points: pts, note: pointsNote || undefined });
    } else {
      redeemPointsMutation.mutate({ id: customerId, points: pts, note: pointsNote || undefined });
    }
  };

  const isPending = addPointsMutation.isPending || redeemPointsMutation.isPending;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setIsOpen(true)}>نقاط</Button>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setIsOpen(false)}>
          <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-lg p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-1">إدارة نقاط الولاء</h2>
            <p className="text-sm text-[var(--t2)] mb-4">
              {customerName} — الرصيد الحالي: <span className="text-[var(--gold)] font-bold">{currentPoints ?? 0}</span>
            </p>
            <form onSubmit={handlePointsSubmit} className="space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPointsAction('add')}
                  className={`flex-1 py-2 rounded-md text-sm font-semibold border transition-colors ${
                    pointsAction === 'add'
                      ? 'bg-[var(--emerald)] text-void border-[var(--emerald)]'
                      : 'border-[var(--rim1)] text-[var(--t2)]'
                  }`}
                >
                  إضافة
                </button>
                <button
                  type="button"
                  onClick={() => setPointsAction('redeem')}
                  className={`flex-1 py-2 rounded-md text-sm font-semibold border transition-colors ${
                    pointsAction === 'redeem'
                      ? 'bg-[var(--crimson)] text-void border-[var(--crimson)]'
                      : 'border-[var(--rim1)] text-[var(--t2)]'
                  }`}
                >
                  استخدام
                </button>
              </div>
              <div>
                <label className="block text-sm text-[var(--t2)] mb-1">عدد النقاط</label>
                <input
                  type="number"
                  min={1}
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                  required
                  className="w-full bg-[var(--surface)] border border-[var(--rim1)] text-[var(--t1)] rounded-md px-3 py-2 outline-none focus:border-[var(--t2)]"
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--t2)] mb-1">ملاحظة</label>
                <input
                  value={pointsNote}
                  onChange={(e) => setPointsNote(e.target.value)}
                  className="w-full bg-[var(--surface)] border border-[var(--rim1)] text-[var(--t1)] rounded-md px-3 py-2 outline-none focus:border-[var(--t2)]"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex-1 bg-[var(--t1)] text-[var(--surface)] font-bold py-2 px-4 rounded-md hover:opacity-90 disabled:opacity-50"
                >
                  {isPending ? 'جاري الحفظ...' : 'تأكيد'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="flex-1 border border-[var(--rim1)] text-[var(--t2)] py-2 px-4 rounded-md hover:bg-[var(--rim1)]"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
