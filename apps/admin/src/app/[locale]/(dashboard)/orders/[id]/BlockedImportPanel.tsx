"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface UnmappedSourceLine {
    label: string;
    sku: string | null;
    shopifyVariantId: string | null;
    quantity: number;
}

/**
 * Shown on an order stored with import_status='blocked' (0073). Lets the
 * operator link each unmapped Shopify line to a local variant; the server
 * links them and queues the re-import. The server re-checks everything —
 * this component only collects the choice.
 */
export function BlockedImportPanel({ orderId, reason, lines }: { orderId: string; reason: string | null; lines: UnmappedSourceLine[] }) {
    const t = useTranslations("orders.detail.blocked");
    const router = useRouter();
    const [search, setSearch] = useState("");
    const [choice, setChoice] = useState<Record<string, string>>({});

    const variants = trpc.orders.mappableVariants.useQuery({ search: search || undefined });
    const resolve = trpc.orders.resolveBlocked.useMutation({
        onSuccess: () => {
            toast.success(t("queued"));
            router.refresh();
        },
        onError: (err) => toast.error(err.message || t("error")),
    });

    const mappable = lines.filter((l): l is UnmappedSourceLine & { shopifyVariantId: string } => l.shopifyVariantId !== null);
    const allChosen = mappable.length > 0 && mappable.every((l) => choice[l.shopifyVariantId]);
    const options = variants.data?.data ?? [];

    return (
        <div className="rounded-xl border border-[var(--warning)] bg-[var(--card-bg)] p-5 space-y-4" role="alert">
            <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 shrink-0 text-[var(--warning)]" size={20} />
                <div className="space-y-1">
                    <h2 className="text-lg font-bold text-[var(--t1)]">{t("title")}</h2>
                    <p className="text-sm text-[var(--t2)]">{t("hint")}</p>
                    {reason && (
                        <p className="text-xs text-[var(--t3)]">
                            {t("reason")}: {reason}
                        </p>
                    )}
                </div>
            </div>

            <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("search")}
                maxLength={100}
                aria-label={t("search")}
            />

            <ul className="space-y-3">
                {lines.map((line, i) => (
                    <li key={`${line.shopifyVariantId ?? "custom"}-${i}`} className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="text-sm">
                            <span className="font-medium text-[var(--t1)]">{line.label}</span>
                            {line.sku && <span className="ms-2 font-mono text-xs text-[var(--t3)]" dir="ltr">{line.sku}</span>}
                            <span className="ms-2 tabular-nums text-[var(--t3)]" dir="ltr">× {line.quantity}</span>
                        </div>
                        {line.shopifyVariantId ? (
                            <select
                                className="h-9 min-w-[240px] rounded-md border border-[var(--rim1)] bg-transparent px-2 text-sm"
                                aria-label={`${t("mapTo")} ${line.label}`}
                                value={choice[line.shopifyVariantId] ?? ""}
                                onChange={(e) => setChoice((c) => ({ ...c, [line.shopifyVariantId as string]: e.target.value }))}
                            >
                                <option value="">{options.length === 0 ? t("noResults") : `${t("mapTo")}…`}</option>
                                {options.map((v) => (
                                    <option key={v.id} value={v.id}>
                                        {v.productName} — {v.name} ({v.sku})
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <span className="text-xs text-[var(--t3)]">{t("customItem")}</span>
                        )}
                    </li>
                ))}
            </ul>

            <Button
                disabled={!allChosen || resolve.isPending}
                onClick={() =>
                    resolve.mutate({
                        orderId,
                        mappings: mappable.map((l) => ({ shopifyVariantId: l.shopifyVariantId, variantId: choice[l.shopifyVariantId] })),
                    })
                }
            >
                {resolve.isPending ? t("submitting") : t("submit")}
            </Button>
        </div>
    );
}
