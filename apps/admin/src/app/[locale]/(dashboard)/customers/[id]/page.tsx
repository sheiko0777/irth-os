import { Money } from "@/components/ui/Money";
import { serverCaller } from "@/server/caller";
import { fromMinor } from "@irth/domain";
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatBox } from "@/components/ui/StatBox";
import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslations("customers");
  const { id } = await params;
  const locale = await getLocale();
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
      <PageHeader
        eyebrow="عام"
        title={customer.name}
        icon={<Users />}
        actions={
          <Button asChild variant="outline">
            <Link href={`/${locale}/customers`}>{t("detail.backToCustomers")}</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatBox label={t("summary.loyaltyPoints")} value={customer.loyaltyPoints ?? 0} valueClassName="text-[var(--gold)]" />
        <StatBox label={t("summary.totalOrders")} value={customer.totalOrders ?? 0} />
        <StatBox label={t("summary.totalSpent")} value={<Money value={fromMinor(customer.totalSpentMinor ?? 0n)} />} />
      </div>

      <div className="glass rounded-[var(--card-radius)] p-6 space-y-3">
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

      <div className="glass rounded-[var(--card-radius)]">
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
