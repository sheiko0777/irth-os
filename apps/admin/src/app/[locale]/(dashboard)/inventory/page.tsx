import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExportButton } from "@/components/ExportButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { FilterTabs, type FilterTab } from "@/components/ui/FilterTabs";
import { Warehouse, AlertTriangle, CheckCircle2 } from "lucide-react";

const STOCK_STATES = {
  out: { label: "نفد", fg: "var(--crimson)", bg: "rgba(232,56,56,.15)" },
  low: { label: "منخفض", fg: "var(--amber)", bg: "rgba(245,165,0,.15)" },
  ok: { label: "متوفر", fg: "var(--emerald)", bg: "rgba(0,196,120,.15)" },
} as const;
type StockState = keyof typeof STOCK_STATES;
function isStockState(v: string | undefined): v is StockState { return v === "out" || v === "low" || v === "ok"; }
function stateOf(quantity: number, reorderPoint: number): StockState { if (quantity <= 0) return "out"; if (quantity <= reorderPoint) return "low"; return "ok"; }

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ stock?: string }> }) {
  const t = await getTranslations();
  const { stock: stockParam } = await searchParams;
  const stock = isStockState(stockParam) ? stockParam : undefined;
  const caller = await serverCaller();
  const itemsResponse = await caller.inventory.list({ stock });
  if (itemsResponse.error) return <ErrorState message="تعذّر تحميل بيانات المخزون." />;
  const items = itemsResponse.data;
  const counts = itemsResponse.meta?.counts ?? { out: 0, low: 0, ok: 0, all: 0 };
  const tabs: FilterTab[] = [
    { label: "الكل", count: counts.all },
    { value: "out", label: STOCK_STATES.out.label, count: counts.out },
    { value: "low", label: STOCK_STATES.low.label, count: counts.low },
    { value: "ok", label: STOCK_STATES.ok.label, count: counts.ok },
  ];
  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 border-b border-[var(--rim1)] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="mb-1 text-[10px] font-semibold tracking-[0.18em] text-[var(--t2)]">OPERATIONS / INVENTORY</p><h1 className="text-2xl font-semibold tracking-tight text-[var(--t1)]">{t("inventory.title")}</h1><p className="mt-1 text-xs text-[var(--t2)]">صحة المخزون ونقاط إعادة الطلب في عرض تشغيلي واحد.</p></div>
        <ExportButton type="inventory" label="تصدير المخزون" />
      </header>
      <section className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="ملخص المخزون">
        <div className="flex items-center gap-3 border border-[var(--rim1)] bg-[var(--surface)] px-4 py-3"><Warehouse className="h-4 w-4 text-[var(--t2)]" aria-hidden="true" /><div><p className="text-[10px] text-[var(--t2)]">إجمالي الأصناف</p><p className="tabular-nums text-lg font-semibold text-[var(--t1)]">{counts.all.toLocaleString("ar-EG")}</p></div></div>
        <div className="flex items-center gap-3 border border-[var(--rim1)] bg-[var(--surface)] px-4 py-3"><AlertTriangle className="h-4 w-4 text-[var(--amber)]" aria-hidden="true" /><div><p className="text-[10px] text-[var(--t2)]">تحتاج مراجعة</p><p className="tabular-nums text-lg font-semibold text-[var(--t1)]">{(counts.out + counts.low).toLocaleString("ar-EG")}</p></div></div>
        <div className="flex items-center gap-3 border border-[var(--rim1)] bg-[var(--surface)] px-4 py-3"><CheckCircle2 className="h-4 w-4 text-[var(--emerald)]" aria-hidden="true" /><div><p className="text-[10px] text-[var(--t2)]">متوفر</p><p className="tabular-nums text-lg font-semibold text-[var(--t1)]">{counts.ok.toLocaleString("ar-EG")}</p></div></div>
      </section>
      <FilterTabs param="stock" tabs={tabs} />
      <div className="overflow-hidden rounded-sm border border-[var(--rim1)] bg-[var(--surface)]">
        <div className="overflow-x-auto"><Table><TableHeader className="bg-[var(--raised)]"><TableRow><TableHead className="text-start">{t("inventory.columns.product")}</TableHead><TableHead className="text-start">{t("inventory.columns.variant")}</TableHead><TableHead className="text-start">{t("inventory.columns.quantity")}</TableHead><TableHead className="text-start">{t("inventory.columns.reorderPoint")}</TableHead><TableHead className="text-start">{t("inventory.columns.status")}</TableHead></TableRow></TableHeader><TableBody>
          {items.length === 0 ? <TableRow className="hover:bg-transparent"><TableCell colSpan={5} className="p-0">{stock ? <EmptyState icon={Warehouse} title={`لا توجد أصناف بحالة "${STOCK_STATES[stock].label}"`} hint="غيّر الفلتر لعرض باقي الأصناف." /> : <EmptyState icon={Warehouse} title="لا توجد عناصر في المخزون" hint="المخزون بيتكوّن من متغيّرات المنتجات. ابدأ بإضافة منتج وحدّد كمياته." action={{ label: "إضافة منتج", href: "/ar/products/new" }} />}</TableCell></TableRow> : items.map((row: { item: { id: string; quantity: number; reorderPoint: number }; product: { name: string; nameAr: string | null }; variant: { name: string } }) => { const state = stateOf(row.item.quantity, row.item.reorderPoint); const style = STOCK_STATES[state]; return <TableRow key={row.item.id} className="border-b border-[var(--rim1)] transition-colors hover:bg-[var(--raised)]/50"><TableCell className="font-medium text-[var(--t1)]">{row.product.nameAr || row.product.name}</TableCell><TableCell className="text-[var(--t2)]">{row.variant.name}</TableCell><TableCell className="tabular-nums text-[var(--t1)]" dir="ltr">{row.item.quantity.toLocaleString("ar-EG")}</TableCell><TableCell className="tabular-nums text-[var(--t2)]" dir="ltr">{row.item.reorderPoint.toLocaleString("ar-EG")}</TableCell><TableCell><span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: style.fg, background: style.bg }}>{style.label}</span></TableCell></TableRow>; })}
        </TableBody></Table></div>
      </div>
    </div>
  );
}