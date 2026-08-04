import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ExportButton } from "@/components/ExportButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Warehouse } from "lucide-react";

export default async function InventoryPage() {
    const t = await getTranslations();
    const caller = await serverCaller();

    const [itemsResponse, alertsResponse] = await Promise.all([
        caller.inventory.list(),
        caller.inventory.alerts()
    ]);

    if (itemsResponse.error || alertsResponse.error) {
        return <ErrorState message="تعذّر تحميل بيانات المخزون." />;
    }

    const { data: items } = itemsResponse;
    const { data: alerts } = alertsResponse;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-[var(--t1)]">{t('inventory.title')}</h1>
                <ExportButton type="inventory" label="تصدير المخزون" />
            </div>

            {alerts.length > 0 && (
                /* Was gold text on a solid crimson fill: roughly 1.5:1, illegible.
                   Tinted like every other status surface in the console, with the
                   crimson carried by a 3px edge bar instead of a full flood. */
                <div className="rounded-md border border-[var(--rim1)] border-s-[3px] border-s-[var(--crimson)] bg-[rgba(232,56,56,.10)] p-4">
                    <p className="font-semibold text-[var(--t1)]">
                        {t('inventory.alerts_banner', { count: alerts.length })}
                    </p>
                </div>
            )}

            <div className="rounded-md border border-[var(--rim1)] overflow-hidden bg-[var(--surface)]">
                <Table>
                    <TableHeader className="bg-[var(--rim1)]">
                        <TableRow>
                            <TableHead className="text-right">{t('inventory.columns.product')}</TableHead>
                            <TableHead className="text-right">{t('inventory.columns.variant')}</TableHead>
                            <TableHead className="text-right">{t('inventory.columns.quantity')}</TableHead>
                            <TableHead className="text-right">{t('inventory.columns.reorderPoint')}</TableHead>
                            <TableHead className="text-right">{t('inventory.columns.status')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.length === 0 ? (
                            <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={5} className="p-0">
                                    <EmptyState
                                        icon={Warehouse}
                                        title="لا توجد عناصر في المخزون"
                                        hint="المخزون بيتكوّن من متغيّرات المنتجات. ابدأ بإضافة منتج وحدّد كمياته."
                                        action={{ label: 'إضافة منتج', href: '/ar/products/new' }}
                                    />
                                </TableCell>
                            </TableRow>
                        ) : (
                            items.map((row: { item: { id: string, quantity: number, reorderPoint: number }, product: { name: string, nameAr: string | null }, variant: { name: string } }) => {
                                const isLowStock = row.item.quantity <= row.item.reorderPoint;
                                return (
                                    <TableRow key={row.item.id} className="border-b border-[var(--rim1)]">
                                        <TableCell className="font-medium text-[var(--t1)]">{row.product.nameAr || row.product.name}</TableCell>
                                        <TableCell className="text-[var(--t2)]">{row.variant.name}</TableCell>
                                        <TableCell className="text-[var(--t1)]">{row.item.quantity}</TableCell>
                                        <TableCell className="text-[var(--t2)]">{row.item.reorderPoint}</TableCell>
                                        <TableCell>
                                            {isLowStock ? (
                                                <Badge className="bg-[var(--crimson)] hover:bg-[var(--crimson)] text-void">
                                                    {t('inventory.status.low')}
                                                </Badge>
                                            ) : (
                                                <Badge className="bg-[var(--emerald)] hover:bg-[var(--emerald)] text-void">
                                                    {t('inventory.status.ok')}
                                                </Badge>
                                            )}
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
