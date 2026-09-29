import { currency, formatDate, formatMoney, fromMinor, multiply, sum } from "@irth/domain";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { TRPCError } from "@trpc/server";
import { ArrowRight, PackageSearch } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { serverCaller } from "@/server/caller";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { StatusUpdater } from "./StatusUpdater";
import { BlockedImportPanel } from "./BlockedImportPanel";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string, locale: string }> }) {
    const { id, locale } = await params;
    const t = await getTranslations("orders");
    const caller = await serverCaller();

    // Only a genuinely missing order (or a malformed id in the URL) is "not
    // found". Every other failure is rethrown to the dashboard error boundary:
    // telling an operator a real order does not exist because the database
    // blipped is worse than admitting the page failed to load.
    let response: Awaited<ReturnType<typeof caller.orders.getById>> | null;
    try {
        response = await caller.orders.getById({ id });
    } catch (err) {
        if (err instanceof TRPCError && (err.code === "NOT_FOUND" || err.code === "BAD_REQUEST")) {
            response = null;
        } else {
            throw err;
        }
    }

    if (response?.error) {
        throw new Error(`orders.getById failed: ${String(response.error)}`);
    }

    if (!response?.data) {
        // Was a bare English <div>Order not found</div> with no way back — a
        // dead end on a URL an operator can easily reach from a stale link.
        return (
            <div className="rounded-xl border border-[var(--rim1)] bg-[var(--card-bg)]">
                <EmptyState
                    icon={PackageSearch}
                    title={t("detail.notFound.title")}
                    hint={t("detail.notFound.hint")}
                    action={{ label: t("detail.notFound.action"), href: `/${locale}/orders` }}
                />
            </div>
        );
    }

    const { order, items, history, sourceLines } = response.data;
    const orderCurrency = currency(order.currency);
    const money = (minor: bigint | null | undefined) =>
        minor == null ? t("detail.totals.unknown") : formatMoney(fromMinor(minor, orderCurrency));
    const isBlocked = order.importStatus === "blocked";
    const address = (a: typeof order.shippingAddress) =>
        a ? [a.name, a.address1, a.address2, a.city, a.province, a.country].filter(Boolean).join("، ") : t("detail.buyer.notCaptured");

    // Was Number(i.price) * i.quantity accumulated into a float. Each line is
    // multiplied in minor units and summed exactly, so the footer total always
    // equals the sum of the rows above it.
    const itemsTotal = sum(
        items.map((i) => multiply(fromMinor(i.priceMinor), i.quantity)),
    );

    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <Link
                    href={`/${locale}/orders`}
                    className="inline-flex items-center gap-1.5 text-xs text-[var(--t3)] transition-colors hover:text-[var(--gold)]"
                >
                    <ArrowRight size={13} />
                    {t("title")}
                </Link>
                <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-3xl font-bold tracking-tight text-[var(--t1)]">
                        {t("detail.title")}
                    </h1>
                    {/* The order number is data, not prose — forced LTR so the
                        hash and digits do not reorder inside the RTL heading. */}
                    <span className="font-mono text-xl text-[var(--gold)] tabular-nums" dir="ltr">
                        {t("detail.orderNumber", { orderNumber: order.orderNumber })}
                    </span>
                    {/* Current state belongs in the header. Previously the only
                        way to see it was to open the status dropdown. */}
                    <StatusBadge status={order.status} domain="order" />
                    {isBlocked && (
                        <span className="rounded-full border border-[var(--warning)] px-2 py-0.5 text-xs font-medium text-[var(--warning)]">
                            {t("detail.blocked.badge")}
                        </span>
                    )}
                </div>
            </div>

            {isBlocked && (
                <BlockedImportPanel
                    orderId={order.id}
                    reason={order.blockedReason}
                    lines={sourceLines.filter((l) => l.mappedVariant === null)}
                />
            )}

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>{t("detail.buyer.title")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                            <dt className="text-[var(--t3)]">{t("detail.buyer.name")}</dt>
                            <dd>{order.buyer?.name ?? t("detail.buyer.notCaptured")}</dd>
                            <dt className="text-[var(--t3)]">{t("detail.buyer.phone")}</dt>
                            <dd dir="ltr" className="text-end md:text-start">{order.buyer?.phone ?? t("detail.buyer.notCaptured")}</dd>
                            <dt className="text-[var(--t3)]">{t("detail.buyer.email")}</dt>
                            <dd dir="ltr" className="text-end md:text-start">{order.buyer?.email ?? t("detail.buyer.notCaptured")}</dd>
                            <dt className="text-[var(--t3)]">{t("detail.buyer.shipping")}</dt>
                            <dd>{address(order.shippingAddress)}</dd>
                            <dt className="text-[var(--t3)]">{t("detail.buyer.billing")}</dt>
                            <dd>{address(order.billingAddress)}</dd>
                            {order.customerNote && (
                                <>
                                    <dt className="text-[var(--t3)]">{t("detail.buyer.note")}</dt>
                                    <dd className="whitespace-pre-wrap">{order.customerNote}</dd>
                                </>
                            )}
                        </dl>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>{t("detail.totals.title")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
                            <dt className="text-[var(--t3)]">{t("detail.totals.subtotal")}</dt>
                            <dd className="tabular-nums" dir="ltr">{money(order.subtotalMinor)}</dd>
                            <dt className="text-[var(--t3)]">{t("detail.totals.discount")}</dt>
                            <dd className="tabular-nums" dir="ltr">{money(order.discountMinor)}</dd>
                            <dt className="text-[var(--t3)]">{t("detail.totals.shipping")}</dt>
                            <dd className="tabular-nums" dir="ltr">{money(order.shippingMinor)}</dd>
                            <dt className="text-[var(--t3)]">{t("detail.totals.tax")}</dt>
                            <dd className="tabular-nums" dir="ltr">{money(order.taxMinor)}</dd>
                            <dt className="border-t border-[var(--rim1)] pt-2 font-bold">{t("detail.totals.total")}</dt>
                            <dd className="border-t border-[var(--rim1)] pt-2 text-lg font-bold tabular-nums" dir="ltr">{money(order.totalAmountMinor)}</dd>
                        </dl>
                    </CardContent>
                </Card>

                {sourceLines.length > 0 && (
                    <Card className="md:col-span-2">
                        <CardHeader>
                            <CardTitle>{t("detail.sourceLines.title")}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t("detail.sourceLines.item")}</TableHead>
                                        <TableHead>{t("detail.sourceLines.sku")}</TableHead>
                                        <TableHead>{t("detail.sourceLines.quantity")}</TableHead>
                                        <TableHead className="text-end">{t("detail.sourceLines.unitPrice")}</TableHead>
                                        <TableHead>{t("detail.sourceLines.status")}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sourceLines.map((line, i) => (
                                        <TableRow key={`${line.shopifyVariantId ?? "custom"}-${i}`}>
                                            <TableCell>{line.label}</TableCell>
                                            <TableCell className="font-mono text-xs" dir="ltr">{line.sku ?? "—"}</TableCell>
                                            <TableCell className="tabular-nums" dir="ltr">{line.quantity.toLocaleString("ar-EG")}</TableCell>
                                            <TableCell className="text-end tabular-nums" dir="ltr">{money(line.unitPriceMinor)}</TableCell>
                                            <TableCell>
                                                {line.mappedVariant
                                                    ? <span className="text-xs">{t("detail.blocked.mapped")}: <span className="font-mono" dir="ltr">{line.mappedVariant.sku}</span></span>
                                                    : <span className="text-xs text-[var(--warning)]">{t("detail.blocked.badge")}</span>}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                )}
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>{t("detail.updateStatus")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <StatusUpdater orderId={order.id} currentStatus={order.status} />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>{t("detail.items")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t("detail.itemsTable.sku")}</TableHead>
                                    <TableHead>{t("detail.itemsTable.quantity")}</TableHead>
                                    <TableHead className="text-end">{t("detail.itemsTable.price")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map((item) => (
                                    <TableRow key={item.id}>
                                        <TableCell className="font-mono text-xs" dir="ltr">{item.sku}</TableCell>
                                        <TableCell className="tabular-nums" dir="ltr">
                                            {item.quantity.toLocaleString("ar-EG")}
                                        </TableCell>
                                        <TableCell className="text-end tabular-nums" dir="ltr">
                                            {formatMoney(fromMinor(item.priceMinor))}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>

                        {/* A line-item table with no sum makes the reader add it up
                            themselves, on a screen that is about money. */}
                        {items.length > 0 && (
                            <div className="mt-3 flex items-center justify-between border-t border-[var(--rim1)] pt-3">
                                <span className="text-xs text-[var(--t3)]">{t("detail.itemsTable.total")}</span>
                                <span className="text-lg font-bold text-[var(--t1)] tabular-nums" dir="ltr">
                                    {formatMoney(itemsTotal)}
                                </span>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>{t("detail.history")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {history.length === 0 ? (
                            <EmptyState title={t("detail.historyEmpty.title")} hint={t("detail.historyEmpty.hint")} />
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t("detail.historyTable.provider")}</TableHead>
                                        <TableHead>{t("detail.historyTable.trackingNumber")}</TableHead>
                                        <TableHead>{t("detail.historyTable.status")}</TableHead>
                                        <TableHead>{t("detail.historyTable.date")}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {history.map((record: { id: string, provider: string, trackingNumber: string | null, status: string | null, createdAt: string | Date }) => (
                                        <TableRow key={record.id}>
                                            <TableCell>{record.provider}</TableCell>
                                            <TableCell className="font-mono text-xs" dir="ltr">
                                                {record.trackingNumber || "—"}
                                            </TableCell>
                                            <TableCell>{record.status || "—"}</TableCell>
                                            <TableCell className="tabular-nums" dir="ltr">
                                                {formatDate(record.createdAt, { withTime: true })}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}