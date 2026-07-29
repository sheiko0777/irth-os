'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import Link from 'next/link';
import { toast } from 'sonner';

export interface Return {
  id: string;
  orderId: string;
  returnNumber: string;
  status: 'requested' | 'approved' | 'rejected' | 'received' | 'restocked' | 'refunded' | 'exchanged';
  reason: string;
  resolutionType: string;
  notes: string | null;
  adminNotes: string | null;
  refundAmount: string | null;
  requestedAt: Date | string | null;
  resolvedAt: Date | string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

export interface SummaryData {
  total: number;
  byStatus: {
    requested: number;
    approved: number;
    rejected: number;
    received: number;
    restocked: number;
    refunded: number;
    exchanged: number;
  };
  pendingRefundAmount: number;
}

interface ReturnsClientProps {
  returns: Return[];
  summary: SummaryData;
  locale: string;
}

import { StatusBadge } from '@/components/ui/StatusBadge';

const tabOptions = [
  { value: 'all', label: 'الكل' },
  { value: 'requested', label: 'معلقة' },
  { value: 'approved', label: 'موافق' },
  { value: 'rejected', label: 'مرفوض' },
  { value: 'received', label: 'مستلم' },
  { value: 'restocked', label: 'مُعاد تخزين' },
];

export function ReturnsClient({ returns: initialReturns, summary: initialSummary, locale }: ReturnsClientProps) {
  const [activeTab, setActiveTab] = useState<string>('all');
  const [refundInput, setRefundInput] = useState<Record<string, string>>({});
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  
  const utils = trpc.useUtils();
  
  const updateStatus = trpc.returns.updateStatus.useMutation({
    onSuccess: (_, variables) => {
      toast.success('تم تحديث الحالة بنجاح');
      void utils.returns.list.invalidate();
      void utils.returns.summary.invalidate();
      setPendingIds(prev => ({ ...prev, [variables.id]: false }));
    },
    onError: (err: unknown, variables) => {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء تحديث الحالة');
      setPendingIds(prev => ({ ...prev, [variables.id]: false }));
    }
  });

  const { data: returnsData } = trpc.returns.list.useQuery(
    { 
      page: 1, 
      pageSize: 50, 
      status: activeTab !== 'all' ? (activeTab as Return['status']) : undefined 
    }
  );

  const { data: summaryData } = trpc.returns.summary.useQuery();

  const rawReturns = returnsData?.data;
  
  const displayReturns: Return[] = rawReturns ? rawReturns.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    returnNumber: r.returnNumber,
    status: r.status as Return['status'],
    reason: r.reason,
    resolutionType: r.resolutionType,
    notes: r.notes,
    adminNotes: r.adminNotes,
    refundAmount: r.refundAmount,
    requestedAt: r.requestedAt,
    resolvedAt: r.resolvedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  })) : initialReturns;

  const displaySummary = summaryData?.data ? {
    total: summaryData.data.total,
    byStatus: {
      requested: summaryData.data.byStatus.requested || 0,
      approved: summaryData.data.byStatus.approved || 0,
      rejected: summaryData.data.byStatus.rejected || 0,
      received: summaryData.data.byStatus.received || 0,
      restocked: summaryData.data.byStatus.restocked || 0,
      refunded: summaryData.data.byStatus.refunded || 0,
      exchanged: summaryData.data.byStatus.exchanged || 0,
    },
    pendingRefundAmount: summaryData.data.pendingRefundAmount
  } : initialSummary;

  const handleUpdateStatus = (id: string, status: Return['status']) => {
    setPendingIds(prev => ({ ...prev, [id]: true }));
    let variables: { id: string; status: Return['status']; refundAmount?: string } = { id, status };
    if (status === 'refunded') {
      const amt = refundInput[id];
      if (amt) {
        variables.refundAmount = amt;
      }
    }
    updateStatus.mutate(variables);
  };

  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-[var(--t1)]">إدارة المرتجعات</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-lg p-6">
          <h3 className="text-[var(--t2)] text-sm mb-2">إجمالي المرتجعات</h3>
          <p className="text-2xl font-bold text-[var(--t1)]">{displaySummary.total}</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-lg p-6">
          <h3 className="text-[var(--t2)] text-sm mb-2">قيد المراجعة</h3>
          <p className="text-2xl font-bold text-[var(--t1)]">
            {displaySummary.byStatus.requested || 0}
          </p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-lg p-6">
          <h3 className="text-[var(--t2)] text-sm mb-2">موافق عليها</h3>
          <p className="text-2xl font-bold text-[var(--t1)]">
            {displaySummary.byStatus.approved || 0}
          </p>
        </div>
      </div>

      <div className="flex border-b border-[var(--rim1)] mb-4">
        {tabOptions.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === tab.value
                ? 'text-[var(--gold)] border-b-2 border-[var(--gold)]'
                : 'text-[var(--t2)] hover:text-[var(--t1)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="text-xs text-[var(--t2)] bg-[var(--surface)] border-b border-[var(--rim1)]">
              <tr>
                <th className="px-6 py-4 font-medium">رقم الطلب</th>
                <th className="px-6 py-4 font-medium">السبب</th>
                <th className="px-6 py-4 font-medium">الحالة</th>
                <th className="px-6 py-4 font-medium">التاريخ</th>
                <th className="px-6 py-4 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--rim1)]">
              {displayReturns.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-[var(--t2)]">
                    لا توجد مرتجعات
                  </td>
                </tr>
              ) : (
                displayReturns.map((ret: Return) => {
                  const isPending = pendingIds[ret.id] || false;
                  
                  return (
                    <tr key={ret.id} className="hover:bg-black/5">
                      <td className="px-6 py-4 text-[var(--t2)] font-mono">{ret.orderId.substring(0, 8)}...</td>
                      <td className="px-6 py-4 text-[var(--t1)] capitalize">{ret.reason.replace('_', ' ')}</td>
                      <td className="px-6 py-4">
                        <StatusBadge status={ret.status} domain="return" />
                      </td>
                      <td className="px-6 py-4 text-[var(--t2)]">
                        {ret.createdAt ? new Date(ret.createdAt).toLocaleDateString('ar-EG') : '-'}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2 items-center flex-wrap">
                          {ret.status === 'requested' && (
                            <>
                              <button
                                disabled={isPending}
                                onClick={() => void handleUpdateStatus(ret.id, 'approved')}
                                className="px-3 py-1 bg-emerald/10 text-emerald rounded hover:bg-emerald/20 text-xs disabled:opacity-50"
                              >
                                موافقة
                              </button>
                              <button
                                disabled={isPending}
                                onClick={() => void handleUpdateStatus(ret.id, 'rejected')}
                                className="px-3 py-1 bg-crimson/10 text-crimson rounded hover:bg-crimson/20 text-xs disabled:opacity-50"
                              >
                                رفض
                              </button>
                            </>
                          )}
                          {ret.status === 'approved' && (
                            <button
                              disabled={isPending}
                              onClick={() => void handleUpdateStatus(ret.id, 'received')}
                              className="px-3 py-1 bg-azure/10 text-azure rounded hover:bg-azure/20 text-xs disabled:opacity-50"
                            >
                              تم الاستلام
                            </button>
                          )}
                          {ret.status === 'received' && (
                            <button
                              disabled={isPending}
                              onClick={() => void handleUpdateStatus(ret.id, 'restocked')}
                              className="px-3 py-1 bg-gold/10 text-gold rounded hover:bg-gold/20 text-xs disabled:opacity-50"
                            >
                              إعادة تخزين
                            </button>
                          )}
                          {(ret.status === 'approved' || ret.status === 'received') && (
                            <div className="flex gap-1 items-center">
                              <input
                                type="number"
                                placeholder="المبلغ"
                                className="px-2 py-1 border border-[var(--rim1)] rounded text-xs w-20 bg-transparent text-[var(--t1)]"
                                value={refundInput[ret.id] || ''}
                                onChange={(e) => setRefundInput(prev => ({ ...prev, [ret.id]: e.target.value }))}
                              />
                              <button
                                disabled={isPending}
                                onClick={() => void handleUpdateStatus(ret.id, 'refunded')}
                                className="px-3 py-1 bg-amber/10 text-amber rounded hover:bg-amber/20 text-xs disabled:opacity-50"
                              >
                                استرداد
                              </button>
                            </div>
                          )}
                          <Link href={`/${locale}/returns/${ret.id}`} className="text-azure hover:underline text-xs mr-2">
                            عرض
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
