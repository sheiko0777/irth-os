'use client';
import { formatMoney, fromMinor } from '@irth/domain';
import { useState, useCallback } from 'react';
import Link from 'next/link';
import { BulkOrderActions } from '@/components/BulkOrderActions';
import { ExportButton } from '@/components/ExportButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { PaginationNav } from '@/components/ui/PaginationNav';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ShoppingCart } from 'lucide-react';

export interface OrderRow { id: string; orderNumber: string; status: string; totalAmountMinor: bigint; createdAt: string | Date; }
interface Props { orders: OrderRow[]; locale: string; page: number; pageSize: number; total: number; filtered?: boolean; }

export function OrdersClient({ orders, locale, page, pageSize, total, filtered }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]); const [key, setKey] = useState(0);
  const allSelected = orders.length > 0 && selectedIds.length === orders.length;
  const toggleAll = () => setSelectedIds(allSelected ? [] : orders.map(o => o.id));
  const toggleOne = (id: string) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const handleSuccess = useCallback(() => { setSelectedIds([]); setKey(k => k + 1); }, []);
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <div className="text-xs text-[var(--t2)]">{total.toLocaleString('ar-EG')} طلب</div>
      <ExportButton type="orders" label="تصدير" />
    </div>
    <div className="overflow-hidden rounded-sm border border-[var(--rim1)] bg-[var(--surface)]">
      <div className="overflow-x-auto">
        <table key={key} className="w-full text-start">
          <thead className="border-b border-[var(--rim1)] bg-raised"><tr>
            <th className="w-10 px-4 py-3"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="تحديد الكل" /></th>
            <th className="px-4 py-3 text-start text-[11px] font-medium tracking-wide text-[var(--t2)]">رقم الطلب</th>
            <th className="px-4 py-3 text-start text-[11px] font-medium tracking-wide text-[var(--t2)]">الحالة</th>
            <th className="px-4 py-3 text-start text-[11px] font-medium tracking-wide text-[var(--t2)]">الإجمالي</th>
            <th className="px-4 py-3 text-start text-[11px] font-medium tracking-wide text-[var(--t2)]">التاريخ</th>
            <th className="px-4 py-3 text-start text-[11px] font-medium tracking-wide text-[var(--t2)]">الإجراء</th>
          </tr></thead>
          <tbody className="divide-y divide-[var(--rim1)]">
            {orders.length === 0 ? <tr><td colSpan={6} className="p-0"><EmptyState icon={ShoppingCart} title={filtered ? 'لا نتائج مطابقة' : 'لا توجد طلبات بعد'} hint={filtered ? 'جرّب إزالة الفلتر أو تغيير البحث.' : 'سيظهر أول طلب هنا فور وصوله.'} /></td></tr> : orders.map(order => <tr key={order.id} className="group transition-colors hover:bg-raised/40">
              <td className="px-4 py-3"><input type="checkbox" checked={selectedIds.includes(order.id)} onChange={() => toggleOne(order.id)} aria-label={`تحديد ${order.orderNumber}`} /></td>
              <td className="px-4 py-3 font-mono text-xs text-[var(--t1)]" dir="ltr"><Link href={`/${locale}/orders/${order.id}`} className="hover:text-[var(--gold)]">{order.orderNumber}</Link></td>
              <td className="px-4 py-3 text-xs"><StatusBadge status={order.status} domain="order" /></td>
              <td className="px-4 py-3 text-xs font-medium text-[var(--t1)]" dir="ltr">{formatMoney(fromMinor(order.totalAmountMinor))}</td>
              <td className="px-4 py-3 text-xs text-[var(--t2)]">{order.createdAt ? new Date(order.createdAt).toLocaleDateString('ar-EG') : '—'}</td>
              <td className="px-4 py-3 text-xs"><div className="flex justify-end gap-3"><Link href={`/${locale}/orders/${order.id}`} className="text-[var(--gold)] hover:underline">عرض</Link><Link href={`/${locale}/orders/${order.id}/print`} target="_blank" rel="noopener noreferrer" className="text-[var(--t2)] hover:underline">طباعة</Link></div></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>
    <BulkOrderActions selectedIds={selectedIds} onSuccess={handleSuccess} />
    <PaginationNav page={page} pageSize={pageSize} total={total} />
  </div>;
}
