"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslations } from "next-intl";

export function OrdersFilters() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const t = useTranslations("orders");
    const [isPending, startTransition] = useTransition();

    const createQueryString = useCallback(
        (name: string, value: string) => {
            const params = new URLSearchParams(searchParams.toString());
            if (value) {
                params.set(name, value);
            } else {
                params.delete(name);
            }
            params.delete('page'); // Reset to page 1 on filter
            return params.toString();
        },
        [searchParams]
    );

    return (
        <div className="flex gap-4 items-center flex-wrap mb-4">
            <div className="w-64">
                <Input
                    placeholder={t("search")}
                    defaultValue={searchParams.get("search")?.toString() || ""}
                    onChange={(e) => {
                        startTransition(() => {
                            router.push(`${pathname}?${createQueryString("search", e.target.value)}`);
                        });
                    }}
                />
            </div>
            <div className="w-48">
                <Select
                    defaultValue={searchParams.get("status")?.toString() || "all"}
                    onValueChange={(val) => {
                        startTransition(() => {
                            router.push(`${pathname}?${createQueryString("status", val === "all" ? "" : val)}`);
                        });
                    }}
                >
                    <SelectTrigger>
                        <SelectValue placeholder={t("statusFilter")} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">{t("allStatuses")}</SelectItem>
                        <SelectItem value="pending">{t("status.pending")}</SelectItem>
                        <SelectItem value="confirmed">{t("status.confirmed")}</SelectItem>
                        <SelectItem value="shipped">{t("status.shipped")}</SelectItem>
                        <SelectItem value="delivered">{t("status.delivered")}</SelectItem>
                        <SelectItem value="cancelled">{t("status.cancelled")}</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            {/* Adding basic HTML date inputs as native "date range picker" for simplicity, keeping RTL compatibility */}
            <div className="flex gap-2 items-center">
                <Input
                    type="date"
                    className="w-auto"
                    defaultValue={searchParams.get("from")?.toString() || ""}
                    onChange={(e) => {
                        startTransition(() => {
                            router.push(`${pathname}?${createQueryString("from", e.target.value)}`);
                        });
                    }}
                />
                <span className="text-muted-foreground">-</span>
                <Input
                    type="date"
                    className="w-auto"
                    defaultValue={searchParams.get("to")?.toString() || ""}
                    onChange={(e) => {
                        startTransition(() => {
                            router.push(`${pathname}?${createQueryString("to", e.target.value)}`);
                        });
                    }}
                />
            </div>
            {isPending && <div className="text-sm text-muted-foreground">جاري التحديث...</div>}
        </div>
    );
}
