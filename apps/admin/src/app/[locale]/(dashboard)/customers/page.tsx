import { serverCaller } from "@/server/caller";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import CustomerActions from "./CustomerActions";

export default async function CustomersPage() {
  const caller = await serverCaller();
  const response = await caller.customers.list({ page: 1, pageSize: 100 });
  const summary = await caller.customers.summary();

  if (response.error) {
    return <div>Error loading customers</div>;
  }

  const customerList = response.data;

  return (
    <div className="space-y-6 font-cairo">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">العملاء</h1>
        <CustomerActions actionType="create" />
      </div>

      {summary.data && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border bg-[var(--surface)] p-4">
            <p className="text-sm text-[var(--t2)]">إجمالي العملاء</p>
            <p className="text-2xl font-bold text-[var(--t1)]">{summary.data.totalCustomers}</p>
          </div>
          <div className="rounded-lg border bg-[var(--surface)] p-4">
            <p className="text-sm text-[var(--t2)]">نقاط الولاء المتراكمة</p>
            <p className="text-2xl font-bold text-[var(--gold)]">{summary.data.totalLoyaltyPoints}</p>
          </div>
        </div>
      )}

      <div className="rounded-md border bg-[var(--surface)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الاسم</TableHead>
              <TableHead>البريد الإلكتروني</TableHead>
              <TableHead>الهاتف</TableHead>
              <TableHead>نقاط الولاء</TableHead>
              <TableHead>الطلبات</TableHead>
              <TableHead>الإجمالي</TableHead>
              <TableHead className="text-end">الإجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customerList.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center">لا يوجد عملاء.</TableCell>
              </TableRow>
            ) : (
              customerList.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium">
                    <Link href={`/ar/customers/${customer.id}`} className="hover:text-[var(--gold)] transition-colors">
                      {customer.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-left" dir="ltr">{customer.email || '-'}</TableCell>
                  <TableCell className="text-left" dir="ltr">{customer.phone || '-'}</TableCell>
                  <TableCell className="text-[var(--gold)] font-semibold">{customer.loyaltyPoints ?? 0}</TableCell>
                  <TableCell>{customer.totalOrders ?? 0}</TableCell>
                  <TableCell>{customer.totalSpent ? `${customer.totalSpent} ج.م` : '-'}</TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-2">
                      <CustomerActions actionType="addPoints" customerId={customer.id} customerName={customer.name} currentPoints={customer.loyaltyPoints ?? 0} />
                    </div>
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
