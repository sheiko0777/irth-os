import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExportButton } from "@/components/ExportButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { FilterTabs, type FilterTab } from "@/components/ui/FilterTabs";
import { Warehouse } from "lucide-react";
import Link from "next/link";

/**
 * Three stock states, not two. "Out" cannot be sold today; "low" can, but needs
 * a purchase order. Collapsing them into one red badge — as this page used to —
 * hides the difference between "act now" and "act this week".
 */
const STOCK_STATES = {
  out: { label: "نفد", fg: "var(--crimson)", bg: "rgba(232,56,56,.15)" },
  low: { label: "منخفض", fg: "var(--amber)", bg: "rgba(245,165,0,.15)" },
  ok: { label: "متوفر", fg: "var(--emerald)", bg: "rgba(0,196,120,.15)" },
} as const;

type StockState = keyof typeof STOCK_STATES;

function isStockState(v: string | undefined): v is StockState {
  return v === "out" || v === "low" || v === "ok";
}

function stateOf(quantity: number, reorderPoint: number): StockState {
  if (quantity <= 0) return "out";
  if (quantity <= reorderPoint) return "low";
  return "ok";
}

export default async function InventoryPage({
  searchParams,
  params,
}: {
  searchParams: Promise<{ stock?: string }>;
  params: Promise<{ locale: string }>;
}) {
  const t = await getTranslations();
  const { stock: stockParam } = await searchParams;
  const { locale } = await params;
  const stock = isStockState(stockParam) ? stockParam : undefined;

  const caller = await serverCaller();
  const itemsResponse = await caller.inventory.list({ stock });

  if (itemsResponse.error) {
    return <ErrorState message="تعذّر تحميل بيانات المخزون." />;
  }

  const items = itemsResponse.data;
  const counts = itemsResponse.meta?.counts ?? { out: 0, low: 0, ok: 0, all: 0 };

  const tabs: FilterTab[] = [
    { label: "الكل", count: counts.all },
    { value: "out", label: STOCK_STATES.out.label, count: counts.out },
    { value: "low", label: STOCK_STATES.low.label, count: counts.low },
    { value: "ok", label: STOCK_STATES.ok.label, count: counts.ok },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-[var(--t1)]">{t("inventory.title")}</h1>
        <div className="flex items-center gap-2">
          <Link href={`/${locale}/inventory/lots`} className="text-sm font-medium text-[var(--gold)] hover:underline">المخازن والتشغيلات</Link>
          <ExportButton type="inventory" label="تصدير المخزون" />
        </div>
      </div>

      {/* The banner is gone: the tab strip carries the same warning as a live,
          clickable count instead of a static sentence the operator cannot act on. */}
      <FilterTabs param="stock" tabs={tabs} />

      <div className="rounded-md border border-[var(--rim1)] overflow-hidden bg-[var(--surface)]">
        <Table>
          <TableHeader className="bg-[var(--rim1)]">
            <TableRow>
              <TableHead className="text-start">{t("inventory.columns.product")}</TableHead>
              <TableHead className="text-start">{t("inventory.columns.variant")}</TableHead>
              <TableHead className="text-start">{t("inventory.columns.quantity")}</TableHead>
              <TableHead className="text-start">{t("inventory.columns.reorderPoint")}</TableHead>
              <TableHead className="text-start">{t("inventory.columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="p-0">
                  {stock ? (
                    <EmptyState
                      icon={Warehouse}
                      title={`لا توجد أصناف بحالة "${STOCK_STATES[stock].label}"`}
                      hint="غيّر الفلتر لعرض باقي الأصناف."
                    />
                  ) : (
                    <EmptyState
                      icon={Warehouse}
                      title="لا توجد عناصر في المخزون"
                      hint="المخزون بيتكوّن من متغيّرات المنتجات. ابدأ بإضافة منتج وحدّد كمياته."
                      action={{ label: "إضافة منتج", href: "/ar/products/new" }}
                    />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              items.map((row: { item: { id: string; quantity: number; reorderPoint: number }; product: { name: string; nameAr: string | null }; variant: { name: string } }) => {
                const state = stateOf(row.item.quantity, row.item.reorderPoint);
                const style = STOCK_STATES[state];
                return (
                  <TableRow key={row.item.id} className="border-b border-[var(--rim1)]">
                    <TableCell className="font-medium text-[var(--t1)]">
                      {row.product.nameAr || row.product.name}
                    </TableCell>
                    <TableCell className="text-[var(--t2)]">{row.variant.name}</TableCell>
                    <TableCell className="text-[var(--t1)] tabular-nums" dir="ltr">
                      {row.item.quantity.toLocaleString("ar-EG")}
                    </TableCell>
                    <TableCell className="text-[var(--t2)] tabular-nums" dir="ltr">
                      {row.item.reorderPoint.toLocaleString("ar-EG")}
                    </TableCell>
                    <TableCell>
                      {/* Tinted, never a solid fill — the same treatment as every
                          other status surface in the console. */}
                      <span
                        className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold"
                        style={{ color: style.fg, background: style.bg }}
                      >
                        {style.label}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
