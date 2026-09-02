'use client';
import { useState } from 'react';

import { trpc } from '@/lib/trpc';

import { Button } from '@/components/ui/button';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormDialog } from '@/components/ui/FormDialog';
import { ClipboardList } from 'lucide-react';


export type StocktakingSession = {
  id: string;
  orgId: string;
  status: 'draft' | 'in_progress' | 'completed' | 'cancelled';
  startedAt: Date | null;
  completedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  itemCount: number;
  varianceCount: number;
};

export type StocktakingSummary = {
  totalSessions: number;
  activeSessions: number;
  lastCompletedAt: Date | null;
};

type SessionItem = { productName: string; sku: string; expectedQty: number; countedQty: number; };

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}

interface Props { sessions: StocktakingSession[]; summary: StocktakingSummary; }

export function StocktakingClient({ sessions: initialSessions, summary }: Props) {
  const utils = trpc.useUtils();
  const [detailSession, setDetailSession] = useState<StocktakingSession | null>(null);
  const [items, setItems] = useState<SessionItem[]>([]);

  const createMutation = trpc.stocktaking.sessions.create.useMutation({
    onSuccess: () => utils.stocktaking.sessions.list.invalidate(),
  });
  const completeMutation = trpc.stocktaking.sessions.complete.useMutation({
    onSuccess: () => utils.stocktaking.sessions.list.invalidate(),
  });
  const getItemsQuery = trpc.stocktaking.sessions.getItems.useQuery(
    { sessionId: detailSession?.id ?? '' },
    { enabled: !!detailSession }
  );

  return (
    <div>
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-[var(--rim1)] bg-[var(--surface)] p-4">
          <p className="text-sm text-[var(--t2)]">اجمالي جلسات الجرد</p>
          <p className="text-3xl font-bold text-[var(--t1)] mt-1">{summary.totalSessions}</p>
        </div>
        <div className="rounded-xl border border-[var(--rim1)] bg-[var(--surface)] p-4">
          <p className="text-sm text-[var(--t2)]">جلسات نشطة</p>
          <p className="text-3xl font-bold mt-1" style={{ color: 'var(--gold)' }}>{summary.activeSessions}</p>
        </div>
        <div className="rounded-xl border border-[var(--rim1)] bg-[var(--surface)] p-4">
          <p className="text-sm text-[var(--t2)]">اخر جرد مكتمل</p>
          <p className="text-lg font-semibold mt-1" style={{ color: 'var(--emerald)' }}>{formatDate(summary.lastCompletedAt)}</p>
        </div>
      </div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold text-[var(--t1)]">جرد المخزون</h1>
        <Button onClick={() => createMutation.mutate({})} disabled={createMutation.isPending} style={{ background: 'var(--gold)', color: 'var(--void)' }}>
          {createMutation.isPending ? '...' : '+ بدء جرد جديد'}
        </Button>
      </div>
      <div className="rounded-md border border-[var(--rim1)] bg-[var(--surface)]">
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-start">الحالة</TableHead>
            <TableHead className="text-start">تاريخ البدء</TableHead>
            <TableHead className="text-start">عدد الاصناف</TableHead>
            <TableHead className="text-start">فروقات</TableHead>
            <TableHead className="text-start">الاجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {initialSessions.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="p-0"><EmptyState icon={ClipboardList} title="لا توجد جلسات جرد" hint="جلسة الجرد بتقارن الكمية الدفترية بالفعلية وتطبّق الفروق على المخزون." /></TableCell></TableRow>
            ) : initialSessions.map(session => (
              <TableRow key={session.id} className="border-b border-[var(--rim1)]">
                <TableCell>
                  <StatusBadge status={session.status} domain="stocktaking" />
                </TableCell>
                <TableCell className="text-[var(--t2)]">{formatDate(session.startedAt)}</TableCell>
                <TableCell className="text-[var(--t1)]">{session.itemCount}</TableCell>
                <TableCell>
                  {session.varianceCount > 0
                    ? <span style={{ color: 'var(--crimson)' }} className="font-semibold">{session.varianceCount}</span>
                    : <span style={{ color: 'var(--emerald)' }}>0</span>}
                </TableCell>
                <TableCell className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setDetailSession(session)}>عرض التفاصيل</Button>
                  {session.status === 'in_progress' && (
                    <Button variant="ghost" size="sm" onClick={() => completeMutation.mutate({ id: session.id })} disabled={completeMutation.isPending} style={{ color: 'var(--emerald)' }}>
                      اتمام الجرد
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <FormDialog open={!!detailSession} onClose={() => setDetailSession(null)} title="تفاصيل الجرد" width="672px">
        {detailSession && (
          getItemsQuery.isLoading ? <p className="text-center text-[var(--t2)] py-8">جاري التحميل...</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-start">المنتج</TableHead>
                <TableHead className="text-start">SKU</TableHead>
                <TableHead className="text-start">الكمية المتوقعة</TableHead>
                <TableHead className="text-start">الكمية المحسوبة</TableHead>
                <TableHead className="text-start">الفرق</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {items.length === 0
                  ? <TableRow><TableCell colSpan={5} className="text-center text-[var(--t2)] py-6">لا توجد اصناف</TableCell></TableRow>
                  : items.map((item, i) => {
                      const variance = item.expectedQty - item.countedQty;
                      return (
                        <TableRow key={i} className="border-b border-[var(--rim1)]">
                          <TableCell className="font-medium text-[var(--t1)]">{item.productName}</TableCell>
                          <TableCell className="text-[var(--t2)]" dir="ltr">{item.sku}</TableCell>
                          <TableCell className="text-[var(--t1)]">{item.expectedQty}</TableCell>
                          <TableCell className="text-[var(--t1)]">{item.countedQty}</TableCell>
                          <TableCell>
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ color: variance === 0 ? 'var(--emerald)' : 'var(--crimson)' }}>
                              {variance > 0 ? '+' + variance : variance}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })
                }
              </TableBody>
            </Table>
          )
        )}
      </FormDialog>
    </div>
  );
}