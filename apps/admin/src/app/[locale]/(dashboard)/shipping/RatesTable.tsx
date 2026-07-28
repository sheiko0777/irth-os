'use client';

import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { ShippingRate } from './ShippingClient';

interface Props {
  zoneId: string;
}

export function RatesTable({ zoneId }: Props) {
  const ratesQuery = trpc.shipping.rates.list.useQuery(
    { zoneId },
    { enabled: !!zoneId }
  );

  const deleteRateMutation = trpc.shipping.rates.delete.useMutation({
    onSuccess: () => {
      toast.success('تم حذف سعر الشحن');
      ratesQuery.refetch();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء الحذف');
    },
  });

  const rates = (ratesQuery.data as unknown as ShippingRate[]) ?? [];

  return (
    <div className="rounded-md border border-[var(--rim1)] bg-[var(--surface)]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-right">الاسم</TableHead>
            <TableHead className="text-right">النوع</TableHead>
            <TableHead className="text-right">السعر</TableHead>
            <TableHead className="text-right">التوصيل</TableHead>
            <TableHead className="text-right">حذف</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ratesQuery.isLoading ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-[var(--t2)] py-6">
                جاري التحميل...
              </TableCell>
            </TableRow>
          ) : rates.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-[var(--t2)] py-6">
                لا توجد أسعار
              </TableCell>
            </TableRow>
          ) : (
            rates.map((rate) => (
              <TableRow key={rate.id} className="border-b border-[var(--rim1)]">
                <TableCell className="font-medium text-[var(--t1)]">{rate.name}</TableCell>
                <TableCell>
                  <StatusBadge domain="rateType" status={rate.rateType} />
                </TableCell>
                <TableCell className="text-[var(--t1)]" dir="ltr">
                  {rate.rateType === 'free' ? '—' : rate.price}
                </TableCell>
                <TableCell className="text-[var(--t2)] text-sm">
                  {rate.estimatedDaysMin && rate.estimatedDaysMax
                    ? rate.estimatedDaysMin + '-' + rate.estimatedDaysMax + ' أيام'
                    : '—'}
                </TableCell>
                <TableCell>
                  <ConfirmDialog
                    title="حذف سعر الشحن"
                    description="هل أنت متأكد من حذف سعر الشحن هذا؟"
                    confirmLabel="حذف"
                    pending={deleteRateMutation.isPending}
                    onConfirm={() => deleteRateMutation.mutate({ id: rate.id })}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={deleteRateMutation.isPending}
                      style={{ color: 'var(--crimson)' }}
                    >
                      حذف
                    </Button>
                  </ConfirmDialog>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
