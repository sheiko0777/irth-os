import { serverCaller } from "@/server/caller";
import { formatMoney, fromMinor } from "@irth/domain";
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { getTranslations } from "next-intl/server";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslations("customers");
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
      case 'earn': return t("detail.transactionTypes.earn");
      case 'redeem': return t("detail.transactionTypes.redeem");
      case 'adjust': return t("detail.transactionTypes.adjust");
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
          {t("detail.backToCustomers")}
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">{customer.name}</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-[var(--surface)] p-4">
          <p className="text-sm text-[var(--t2)]">{t("summary.loyaltyPoints")}</p>
          <p className="text-2xl font-bold text-[var(--gold)]">{customer.loyaltyPoints ?? 0}</p>
        </div>
        <div className="rounded-lg border bg-[var(--surface)] p-4">
          <p className="text-sm text-[var(--t2)]">{t("summary.totalOrders")}</p>
          <p className="text-2xl font-bold text-[var(--t1)]">{customer.totalOrders ?? 0}</p>
        </div>
        <div className="rounded-lg border bg-[var(--surface)] p-4">
          <p className="text-sm text-[var(--t2)]">{t("summary.totalSpent")}</p>
          <p className="text-2xl font-bold text-[var(--t1)]">{formatMoney(fromMinor(customer.totalSpentMinor ?? 0n))}</p>
        </div>
      </div>

      <div className="rounded-lg border bg-[var(--surface)] p-6 space-y-3">
        <h2 className="font-semibold text-lg text-[var(--t1)]">{t("detail.contact.title")}</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-[var(--t2)]">{t("detail.contact.email")}: </span>
            <span className="text-[var(--t1)]" dir="ltr">{customer.email || '-'}</span>
          </div>
          <div>
            <span className="text-[var(--t2)]">{t("detail.contact.phone")}: </span>
            <span className="text-[var(--t1)]" dir="ltr">{customer.phone || '-'}</span>
          </div>
          <div className="col-span-2">
            <span className="text-[var(--t2)]">{t("detail.contact.address")}: </span>
            <span className="text-[var(--t1)]">{customer.address || '-'}</span>
          </div>
          {customer.notes && (
            <div className="col-span-2">
              <span className="text-[var(--t2)]">{t("detail.contact.notes")}: </span>
              <span className="text-[var(--t1)]">{customer.notes}</span>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border bg-[var(--surface)]">
        <div className="p-4 border-b border-[var(--rim1)]">
          <h2 className="font-semibold text-lg text-[var(--t1)]">{t("detail.loyaltyHistory")}</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("detail.transactionsTable.type")}</TableHead>
              <TableHead>{t("detail.transactionsTable.points")}</TableHead>
              <TableHead>{t("detail.transactionsTable.balanceAfter")}</TableHead>
              <TableHead>{t("detail.transactionsTable.note")}</TableHead>
              <TableHead>{t("detail.transactionsTable.date")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="p-0"><EmptyState title={t("detail.transactionsEmpty.title")} hint={t("detail.transactionsEmpty.hint")} /></TableCell>
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
