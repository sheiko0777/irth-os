"use client";

import { useTransition } from "react";
import { updateOrderStatusAction } from "./actions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslations } from "next-intl";
import { OrderStatus, STATUS_COLUMNS } from "@/lib/orderTypes";
import { toast } from "sonner";

export function StatusUpdater({ orderId, currentStatus }: { orderId: string, currentStatus: string }) {
    const t = useTranslations("orders");
    const [isPending, startTransition] = useTransition();

    return (
        <div className="flex items-center gap-4">
            <Select
                defaultValue={currentStatus}
                onValueChange={(val) => {
                    startTransition(async () => {
                        try {
                            await updateOrderStatusAction(orderId, val as OrderStatus);
                            toast.success(t("detail.statusUpdater.success"));
                        } catch {
                            toast.error(t("detail.statusUpdater.error"));
                        }
                    });
                }}
            >
                <SelectTrigger className="w-[180px]" disabled={isPending}>
                    <SelectValue placeholder={t("detail.statusUpdater.placeholder")} />
                </SelectTrigger>
                <SelectContent>
                    {STATUS_COLUMNS.map(({ id }) => (
                        <SelectItem key={id} value={id}>{t(`status.${id}`)}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {isPending && <span className="text-sm text-muted-foreground">{t("detail.statusUpdater.loading")}</span>}
        </div>
    );
}
