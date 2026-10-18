"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { FormDialog } from "@/components/ui/FormDialog";
import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";

interface Item {
    id: string;
    sku: string | null;
    quantity: number;
    returnedQuantity: number;
}

interface CreateReturnDialogProps {
    orderId: string;
    items: Item[];
    locale: string;
}

export function CreateReturnDialog({ orderId, items, locale }: CreateReturnDialogProps) {
    const t = useTranslations("orders.detail.createReturn");
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState<'damaged'|'wrong_item'|'not_as_described'|'changed_mind'|'other'>('other');
    const [resolution, setResolution] = useState<'refund'|'exchange'|'store_credit'|'none'>('none');
    const [notes, setNotes] = useState('');

    // Map item id to { quantity, condition }
    const [selectedItems, setSelectedItems] = useState<Record<string, { quantity: number; condition: 'new'|'good'|'damaged'|'unknown' }>>({});

    const createMutation = trpc.returns.create.useMutation({
        onSuccess: (data) => {
            toast.success(t("success"));
            setOpen(false);
            router.refresh();
            router.push(`/${locale}/returns/${data.data.id}`);
        },
        onError: (err) => {
            // Error is handled by form submission showing the alert
        }
    });

    const handleQuantityChange = (itemId: string, value: number, maxQty: number) => {
        const qty = Math.max(0, Math.min(value, maxQty));
        setSelectedItems(prev => {
            const next = { ...prev };
            if (qty === 0) {
                delete next[itemId];
            } else {
                next[itemId] = {
                    ...next[itemId],
                    quantity: qty,
                    condition: next[itemId]?.condition ?? 'unknown'
                };
            }
            return next;
        });
    };

    const handleConditionChange = (itemId: string, condition: 'new'|'good'|'damaged'|'unknown') => {
        setSelectedItems(prev => {
            if (!prev[itemId]) return prev;
            return {
                ...prev,
                [itemId]: { ...prev[itemId], condition }
            };
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const returnItems = Object.entries(selectedItems).map(([orderItemId, { quantity, condition }]) => ({
            orderItemId,
            quantity,
            condition
        }));

        if (returnItems.length === 0) {
            toast.error(t("errorEmpty"));
            return;
        }

        const idempotencyKey = crypto.randomUUID();

        createMutation.mutate({
            orderId,
            reason,
            resolutionType: resolution,
            notes: notes || undefined,
            items: returnItems,
            idempotencyKey
        });
    };

    // Calculate maximum available for each item (ordered - returned so far)
    // For this UI, we'll assume `quantity` is the remaining quantity, or we'll cap it at `quantity`
    // The tRPC router rejects if above ordered minus prior returns.

    return (
        <>
            <Button onClick={() => setOpen(true)} variant="outline">{t("action")}</Button>

            <FormDialog open={open} onClose={() => setOpen(false)} title={t("title")} width="600px">
                <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-4">
                    {createMutation.error && (
                        <div role="alert" className="mb-4">
                            <ErrorState
                                title="Error"
                                message={createMutation.error.message}
                            />
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-2">
                            <Label>{t("reason")}</Label>
                            <Select value={reason} onValueChange={(v: any) => setReason(v)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="damaged">{t("reason_damaged")}</SelectItem>
                                    <SelectItem value="wrong_item">{t("reason_wrong_item")}</SelectItem>
                                    <SelectItem value="not_as_described">{t("reason_not_as_described")}</SelectItem>
                                    <SelectItem value="changed_mind">{t("reason_changed_mind")}</SelectItem>
                                    <SelectItem value="other">{t("reason_other")}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex flex-col gap-2">
                            <Label>{t("resolution")}</Label>
                            <Select value={resolution} onValueChange={(v: any) => setResolution(v)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="refund">{t("resolution_refund")}</SelectItem>
                                    <SelectItem value="exchange">{t("resolution_exchange")}</SelectItem>
                                    <SelectItem value="store_credit">{t("resolution_store_credit")}</SelectItem>
                                    <SelectItem value="none">{t("resolution_none")}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2 mt-2">
                        <Label>Items to Return</Label>
                        <div className="border border-[var(--rim1)] rounded-md divide-y divide-[var(--rim1)] max-h-60 overflow-y-auto">
                            {items.map(item => {
                                const remaining = item.quantity - (item.returnedQuantity || 0);
                                if (remaining <= 0) return null;

                                const selected = selectedItems[item.id];

                                return (
                                    <div key={item.id} className="p-3 flex flex-col gap-2 bg-[var(--surface)]">
                                        <div className="flex justify-between items-center">
                                            <span className="font-mono text-sm">{item.sku}</span>
                                            <span className="text-xs text-[var(--t2)]">Max: {remaining}</span>
                                        </div>
                                        <div className="flex gap-2 items-center">
                                            <Input
                                                type="number"
                                                min={0}
                                                max={remaining}
                                                value={selected?.quantity || 0}
                                                onChange={(e) => handleQuantityChange(item.id, parseInt(e.target.value) || 0, remaining)}
                                                className="w-20"
                                            />
                                            <div className="flex-1">
                                                <Select
                                                    value={selected?.condition || 'unknown'}
                                                    onValueChange={(v: any) => handleConditionChange(item.id, v)}
                                                    disabled={!selected?.quantity}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="new">{t("condition_new")}</SelectItem>
                                                        <SelectItem value="good">{t("condition_good")}</SelectItem>
                                                        <SelectItem value="damaged">{t("condition_damaged")}</SelectItem>
                                                        <SelectItem value="unknown">{t("condition_unknown")}</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            {items.every(i => (i.quantity - (i.returnedQuantity || 0)) <= 0) && (
                                <div className="p-4 text-center text-[var(--t2)] text-sm">
                                    No items available to return.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col gap-2 mt-2">
                        <Label>{t("notes")}</Label>
                        <Textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder={t("notesPlaceholder")}
                            className="resize-none h-20"
                        />
                    </div>

                    <div className="flex justify-end gap-2 mt-4">
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={createMutation.isPending}>
                            {createMutation.isPending ? t("submitting") : t("submit")}
                        </Button>
                    </div>
                </form>
            </FormDialog>
        </>
    );
}
