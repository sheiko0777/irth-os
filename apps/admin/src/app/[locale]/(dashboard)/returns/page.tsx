import { serverCaller } from '@/server/caller';
import Link from 'next/link';

export const metadata = {
  title: 'Returns | IRTH',
};

const badgeColors: Record<string, string> = {
  requested: 'var(--gold)',
  approved: 'var(--emerald)',
  rejected: 'var(--crimson)',
  received: 'var(--gold)',
  restocked: 'var(--emerald)',
  refunded: 'var(--emerald)',
  exchanged: 'var(--emerald)',
};

export default async function ReturnsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  const caller = await serverCaller();

  const [summaryRes, returnsRes] = await Promise.all([
    caller.returns.summary(),
    caller.returns.list({ page: 1, pageSize: 50 }),
  ]);

  const summary = summaryRes.data;
  const returns = returnsRes.data;

  return (
    <div className="flex flex-col gap-6 w-full font-cairo">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-[var(--t1)]">المرتجعات (Returns)</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-lg p-6">
          <h3 className="text-[var(--t2)] text-sm mb-2">إجمالي المرتجعات (Total Returns)</h3>
          <p className="text-2xl font-bold text-[var(--t1)]">{summary.total}</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-lg p-6">
          <h3 className="text-[var(--t2)] text-sm mb-2">قيد المراجعة (Pending Review)</h3>
          <p className="text-2xl font-bold text-[var(--t1)]">
            {(summary.byStatus.requested || 0) + (summary.byStatus.approved || 0)}
          </p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-lg p-6">
          <h3 className="text-[var(--t2)] text-sm mb-2">مبالغ مستردة معلقة (Pending Refund Amount)</h3>
          <p className="text-2xl font-bold text-[var(--t1)]">
            {summary.pendingRefundAmount.toFixed(2)} EGP
          </p>
        </div>
      </div>

      <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-[var(--t2)] bg-[var(--surface)] border-b border-[var(--rim1)]">
              <tr>
                <th className="px-6 py-4 font-medium">الرقم (Number)</th>
                <th className="px-6 py-4 font-medium">الطلب (Order ID)</th>
                <th className="px-6 py-4 font-medium">السبب (Reason)</th>
                <th className="px-6 py-4 font-medium">الحالة (Status)</th>
                <th className="px-6 py-4 font-medium">طريقة الحل (Resolution)</th>
                <th className="px-6 py-4 font-medium">التاريخ (Date)</th>
                <th className="px-6 py-4 font-medium text-right">إجراء (Action)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--rim1)]">
              {returns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-[var(--t2)]">
                    لا توجد مرتجعات (No returns found)
                  </td>
                </tr>
              ) : (
                returns.map((ret) => (
                  <tr key={ret.id} className="hover:bg-black/5">
                    <td className="px-6 py-4 font-mono font-medium text-[var(--t1)]">{ret.returnNumber}</td>
                    <td className="px-6 py-4 text-[var(--t2)]">{ret.orderId.substring(0, 8)}...</td>
                    <td className="px-6 py-4 text-[var(--t1)] capitalize">{ret.reason.replace('_', ' ')}</td>
                    <td className="px-6 py-4">
                      <span
                        className="px-2 py-1 rounded-full text-xs font-medium border text-black"
                        style={{
                          backgroundColor: badgeColors[ret.status] || 'var(--rim1)',
                          borderColor: 'rgba(0,0,0,0.1)'
                        }}
                      >
                        {ret.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-[var(--t1)] capitalize">{ret.resolutionType.replace('_', ' ')}</td>
                    <td className="px-6 py-4 text-[var(--t2)]">{new Date(ret.requestedAt).toLocaleDateString('ar-EG')}</td>
                    <td className="px-6 py-4 text-right">
                      <Link href={`/${locale}/returns/${ret.id}`} className="text-blue-500 hover:underline">
                        عرض التفاصيل
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
