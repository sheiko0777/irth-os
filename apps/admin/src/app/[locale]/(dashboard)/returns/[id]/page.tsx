import { formatMoney, fromMinor, toDecimalString } from "@irth/domain";
import { serverCaller } from '@/server/caller';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import UpdateStatusForm from './UpdateStatusForm';
import { StatusBadge } from '@/components/ui/StatusBadge';

export const metadata = {
  title: 'Return Details | IRTH',
};

export default async function ReturnDetailsPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;

  const caller = await serverCaller();

  let returnObj;
  try {
    const res = await caller.returns.get({ id });
    returnObj = res.data;
  } catch (err) {
    return notFound();
  }

  if (!returnObj) {
    return notFound();
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/${locale}/returns`} className="text-[var(--t2)] hover:text-[var(--t1)]">
            &larr; عودة (Back)
          </Link>
          <h1 className="text-2xl font-bold text-[var(--t1)]">تفاصيل المرتجع (Return Details)</h1>
        </div>
      </div>

      <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-lg p-6 flex flex-col gap-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <h3 className="text-[var(--t2)] text-sm">رقم المرتجع (Return Number)</h3>
            <p className="text-lg font-bold font-mono text-[var(--t1)]">{returnObj.returnNumber}</p>
          </div>
          <div>
            <h3 className="text-[var(--t2)] text-sm">رقم الطلب (Order ID)</h3>
            <p className="text-[var(--t1)]">{returnObj.orderId.substring(0, 8)}...</p>
          </div>
          <div>
            <h3 className="text-[var(--t2)] text-sm">السبب (Reason)</h3>
            <p className="text-[var(--t1)] capitalize">{returnObj.reason.replace('_', ' ')}</p>
          </div>
          <div>
            <h3 className="text-[var(--t2)] text-sm">الحالة (Status)</h3>
            <span className="inline-block mt-1">
              <StatusBadge status={returnObj.status} domain="return" />
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 border-t border-[var(--rim1)] pt-4">
          <div>
            <h3 className="text-[var(--t2)] text-sm">طريقة الحل (Resolution)</h3>
            <p className="text-[var(--t1)] capitalize">{returnObj.resolutionType.replace('_', ' ')}</p>
          </div>
          <div>
            <h3 className="text-[var(--t2)] text-sm">تاريخ الطلب (Requested Date)</h3>
            <p className="text-[var(--t1)]">{new Date(returnObj.requestedAt!).toLocaleString('ar-EG')}</p>
          </div>
          {returnObj.notes && (
            <div className="col-span-1 md:col-span-2">
              <h3 className="text-[var(--t2)] text-sm">ملاحظات العميل (Customer Notes)</h3>
              <p className="text-[var(--t1)] bg-black/5 p-3 rounded-md mt-1">{returnObj.notes}</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-grow flex flex-col gap-4">
          <h2 className="text-xl font-bold text-[var(--t1)]">العناصر (Items)</h2>
          <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-start">
                <thead className="text-xs text-[var(--t2)] bg-[var(--surface)] border-b border-[var(--rim1)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">المنتج (Product)</th>
                    <th className="px-4 py-3 font-medium">الكمية (Qty)</th>
                    <th className="px-4 py-3 font-medium">السعر (Price)</th>
                    <th className="px-4 py-3 font-medium">الحالة (Condition)</th>
                    <th className="px-4 py-3 font-medium">إعادة التخزين (Restocked)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--rim1)]">
                  {returnObj.items.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-[var(--t2)]">
                        لا توجد عناصر (No items)
                      </td>
                    </tr>
                  ) : (
                    returnObj.items.map((item) => (
                      <tr key={item.id} className="hover:bg-black/5">
                        <td className="px-4 py-3 text-[var(--t1)]">
                          {item.productName}
                          {item.variantName && <span className="text-[var(--t2)] block text-xs">{item.variantName}</span>}
                        </td>
                        <td className="px-4 py-3 text-[var(--t1)]">{item.quantity}</td>
                        <td className="px-4 py-3 text-[var(--t1)]">{item.unitPriceMinor === null ? '-' : formatMoney(fromMinor(item.unitPriceMinor))}</td>
                        <td className="px-4 py-3 text-[var(--t1)] capitalize">{item.condition}</td>
                        <td className="px-4 py-3">
                          {item.restock ? (
                            <span className="text-[var(--emerald)]">✓ نعم (Yes)</span>
                          ) : (
                            <span className="text-[var(--t2)]">✗ لا (No)</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="w-full md:w-80 flex-shrink-0">
          <h2 className="text-xl font-bold text-[var(--t1)] mb-4">الإجراءات (Actions)</h2>
          <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-lg p-4">
            <UpdateStatusForm
              returnId={returnObj.id}
              currentStatus={returnObj.status}
              adminNotes={returnObj.adminNotes || ''}
              refundAmount={returnObj.refundAmountMinor === null ? '' : toDecimalString(fromMinor(returnObj.refundAmountMinor))}
              resolutionType={returnObj.resolutionType}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
