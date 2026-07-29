import { serverCaller } from "@/server/caller";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await serverCaller();

  let response;
  try {
    response = await caller.customers.get({ id });
  } catch {
    notFound();
  }

  if (!response || response.error) {
    notFound();
  }

  const customer = response.data;
  const transactions = customer.transactions ?? [];

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'earn': return 'مكتسبة';
      case 'redeem': return 'مستخدمة';
      case 'adjust': return 'تعديل';
      default: return type;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'earn': return 'text-[var(--emerald)]';
      case 'redeem': return 'text-[var(--crimson)]';
      default: return 'text-[var(--t2)]';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/ar/customers" className="text-[var(--t2)] hover:text-[var(--t1)] text-sm">
          ← العملاء
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">{customer.name}</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-[var(--surface)] p-4">
          <p className="text-sm text-[var(--t2)]">نقاط الولاء</p>
          <p className="text-2xl font-bold text-[var(--gold)]">{customer.loyaltyPoints ?? 0}</p>
        </div>
        <div className="rounded-lg border bg-[var(--surface)] p-4">
          <p className="text-sm text-[var(--t2)]">إجمالي الطلبات</p>
          <p className="text-2xl font-bold text-[var(--t1)]">{customer.totalOrders ?? 0}</p>
        </div>
        <div className="rounded-lg border bg-[var(--surface)] p-4">
          <p className="text-sm text-[var(--t2)]">إجمالي الإنفاق</p>
          <p className="text-2xl font-bold text-[var(--t1)]">{customer.totalSpent ? `${customer.totalSpent} ج.م` : '0 ج.م'}</p>
        </div>
      </div>

      <div className="rounded-lg border bg-[var(--surface)] p-6 space-y-3">
        <h2 className="font-semibold text-lg text-[var(--t1)]">معلومات التواصل</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-[var(--t2)]">البريد الإلكتروني: </span>
            <span className="text-[var(--t1)]" dir="ltr">{customer.email || '-'}</span>
          </div>
          <div>
            <span className="text-[var(--t2)]">الهاتف: </span>
            <span className="text-[var(--t1)]" dir="ltr">{customer.phone || '-'}</span>
          </div>
          <div className="col-span-2">
            <span className="text-[var(--t2)]">العنوان: </span>
            <span className="text-[var(--t1)]">{customer.address || '-'}</span>
          </div>
          {customer.notes && (
            <div className="col-span-2">
              <span className="text-[var(--t2)]">ملاحظات: </span>
              <span className="text-[var(--t1)]">{customer.notes}</span>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border bg-[var(--surface)]">
        <div className="p-4 border-b border-[var(--rim1)]">
          <h2 className="font-semibold text-lg text-[var(--t1)]">سجل نقاط الولاء</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>النوع</TableHead>
              <TableHead>النقاط</TableHead>
              <TableHead>الرصيد بعد</TableHead>
              <TableHead>ملاحظة</TableHead>
              <TableHead>التاريخ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center">لا توجد معاملات.</TableCell>
              </TableRow>
            ) : (
              transactions.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className={getTypeColor(tx.type)}>{getTypeLabel(tx.type)}</TableCell>
                  <TableCell className={tx.points > 0 ? 'text-[var(--emerald)]' : 'text-[var(--crimson)]'}>
                    {tx.points > 0 ? '+' : ''}{tx.points}
                  </TableCell>
                  <TableCell className="font-semibold">{tx.balanceAfter}</TableCell>
                  <TableCell>{tx.note || '-'}</TableCell>
                  <TableCell dir="ltr" className="text-left text-sm text-[var(--t2)]">
                    {tx.createdAt ? format(new Date(tx.createdAt), 'PP', { locale: ar }) : '-'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
