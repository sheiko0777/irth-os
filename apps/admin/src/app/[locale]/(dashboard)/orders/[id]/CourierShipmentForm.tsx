"use client";

import { useTransition, useState } from "react";
import { setShipmentAction } from "./actions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

export function CourierShipmentForm({
    orderId,
    initialCourier,
    initialTrackingNumber
}: {
    orderId: string,
    initialCourier: string | null,
    initialTrackingNumber: string | null
}) {
    const t = useTranslations("orders.detail.courierShipment");
    const [isPending, startTransition] = useTransition();
    const [courier, setCourier] = useState<string>(initialCourier ?? "");
    const [trackingNumber, setTrackingNumber] = useState<string>(initialTrackingNumber ?? "");

    const handleSave = () => {
        if (!courier || !trackingNumber || trackingNumber.trim().length < 3) {
            return;
        }

        startTransition(async () => {
            try {
                await setShipmentAction(orderId, courier as "bosta" | "aramex", trackingNumber);
                toast.success(t("success"));
            } catch {
                toast.error(t("error"));
            }
        });
    };

    return (
        <div className="flex items-center gap-4 mt-4 pt-4 border-t">
            <Select
                value={courier}
                onValueChange={setCourier}
            >
                <SelectTrigger className="w-[180px]" disabled={isPending}>
                    <SelectValue placeholder={t("placeholder")} />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="bosta">{t("bosta")}</SelectItem>
                    <SelectItem value="aramex">{t("aramex")}</SelectItem>
                </SelectContent>
            </Select>
            <Input
                className="w-[200px]"
                placeholder={t("trackingNumber")}
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                disabled={isPending}
            />
            <Button
                onClick={handleSave}
                disabled={isPending || !courier || trackingNumber.trim().length < 3}
            >
                {t("save")}
            </Button>
        </div>
    );
}
