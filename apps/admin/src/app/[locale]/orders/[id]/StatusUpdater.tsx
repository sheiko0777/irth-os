"use client";

import { useTransition } from "react";
import { updateOrderStatusAction } from "./actions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "next-intl";

export function StatusUpdater({
  orderId,
  currentStatus,
}: {
  orderId: string;
  currentStatus: string;
}) {
  const t = useTranslations("orders.status");
  const [isPending, startTransition] = useTransition();

  const statuses = [
    "pending",
    "confirmed",
    "payment_failed",
    "shipped",
    "delivered",
    "cancelled",
  ];

  return (
    <div className="flex items-center gap-4">
      <Select
        defaultValue={currentStatus}
        onValueChange={(val) => {
          startTransition(async () => {
            await updateOrderStatusAction(orderId, val as any);
          });
        }}
      >
        <SelectTrigger className="w-[180px]" disabled={isPending}>
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          {statuses.map((s) => (
            <SelectItem key={s} value={s}>
              {t(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isPending && (
        <span className="text-sm text-muted-foreground">جاري التحديث...</span>
      )}
    </div>
  );
}
