import { serverCaller } from "@/server/caller";
import { formatMoney, fromMinor } from "@irth/domain";
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import CustomerActions from "./CustomerActions";
import { ExportButton } from "@/components/ExportButton";
import { PaginationNav } from "@/components/ui/PaginationNav";
import { ErrorState } from "@/components/ui/ErrorState";
import { getTranslations } from "next-intl/server";

const PAGE_SIZE = 50;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const t = await getTranslations("customers");
  const { page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? '1', 10));

  const caller = await serverCaller();
  const response = await caller.customers.list({ page, pageSize: PAGE_SIZE });
  const summary = await caller.customers.summary();

  if (response.error) {
    return <ErrorState message={t("errors.loadCustomers")} />;
  }

  const customerList = response.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <div className="flex items-center gap-2">
          <ExportButton type="customers" label={t("actions.export")} />
          <CustomerActions actionType="create" />
        </div>
      </div>

      {summary.data && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border bg-[var(--surface)] p-4">
            <p className="text-sm text-[var(--t2)]">{t("summary.totalCustomers")}</p>
            <p className="text-2xl font-bold text-[var(--t1)]">{summary.data.totalCustomers}</p>
          </div>
          <div className="rounded-lg border bg-[var(--surface)] p-4">
            <p className="text-sm text-[var(--t2)]">{t("summary.totalLoyaltyPoints")}</p>
            <p className="text-2xl font-bold text-[var(--gold)]">{summary.data.totalLoyaltyPoints}</p>
          </div>
        </div>
      )}

      <div className="rounded-md border bg-[var(--surface)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.name")}</TableHead>
              <TableHead>{t("table.email")}</TableHead>
              <TableHead>{t("table.phone")}</TableHead>
              <TableHead>{t("table.loyaltyPoints")}</TableHead>
              <TableHead>{t("table.orders")}</TableHead>
              <TableHead>{t("table.total")}</TableHead>
              <TableHead className="text-end">{t("table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customerList.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="p-0"><EmptyState title={t("empty.title")} hint={t("empty.hint")} /></TableCell>
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
                  {/* Was `${customer.totalSpent} ج.م` — the raw column value,
                      so it printed ungrouped ("1234.56 ج.م"). */}
                  <TableCell>{customer.totalSpentMinor ? formatMoney(fromMinor(customer.totalSpentMinor)) : '-'}</TableCell>
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

      <PaginationNav page={page} pageSize={PAGE_SIZE} total={response.meta?.total ?? 0} />
    </div>
  );
}
