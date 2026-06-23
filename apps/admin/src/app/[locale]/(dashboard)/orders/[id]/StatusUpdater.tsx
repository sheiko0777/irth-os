"use client";

import { useTransition } from "react";
import { updateOrderStatusAction } from "./actions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslations } from "next-intl";
import { OrderStatus, STATUS_COLUMNS } from "@/lib/orderTypes";
import { toast } from "sonner";

export function StatusUpdater({ orderId, currentStatus }: { orderId: string, currentStatus: string }) {
    const t = useTranslations("orders.status");
    const [isPending, startTransition] = useTransition();

    return (
        <div className="flex items-center gap-4">
            <Select
                defaultValue={currentStatus}
                onValueChange={(val) => {
                    startTransition(async () => {
                        try {
                            await updateOrderStatusAction(orderId, val as OrderStatus);
                            toast.success('تم تحديث حالة الطلب بنجاح');
                        } catch {
                            toast.error('حدث خطأ أثناء تحديث الحالة');
                        }
                    });
                }}
            >
                <SelectTrigger className="w-[180px]" disabled={isPending}>
                    <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                    {STATUS_COLUMNS.map(({ id, label }) => (
                        <SelectItem key={id} value={id}>{label}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {isPending && <span className="text-sm text-muted-foreground">جاري التحديث...</span>}
        </div>
    );
}
