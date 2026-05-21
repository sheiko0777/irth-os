import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { serverCaller } from "@/server/caller";
import { KpiCard } from "@/components/ui/KpiCard";

// Revalidate every 60 seconds
export const revalidate = 60;

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;

    const headersList = await headers();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    
    // CVE-2025-29927 Mitigation: Validate Session internally with headers
    let sessionData = null;
    try {
        const sessionRes = await fetch(`${appUrl}/api/auth/get-session`, {
            headers: {
                cookie: headersList.get("cookie") || "",
                "x-forwarded-host": headersList.get("x-forwarded-host") || headersList.get("host") || "",
            },
        });
        if (sessionRes.ok) {
            sessionData = await sessionRes.json();
        }
    } catch (e) {
        console.error("Failed to check session in dashboard", e);
    }

    if (!sessionData?.session) {
        redirect(`/${locale}/login`);
    }

    const t = await getTranslations("dashboard");
    const caller = await serverCaller();
    const stats = await caller.dashboard.getStats();

    if (stats.error) {
        return <div className="text-[var(--crimson)]">حدث خطأ أثناء تحميل إحصائيات لوحة القيادة</div>;
    }

    const { ordersToday, revenueToday, pendingOrders, activeProducts } = stats.data;

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight text-[var(--t1)]">{t("title")}</h1>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                    title={t("ordersToday")}
                    value={ordersToday}
                    color="azure"
                    sub="مقارنة بالأمس"
                />
                <KpiCard
                    title={t("revenueToday")}
                    value={`${revenueToday.toLocaleString()} ج.م`}
                    color="gold"
                    sub="إجمالي الدخل اليومي"
                />
                <KpiCard
                    title={t("pendingOrders")}
                    value={pendingOrders}
                    color="crimson"
                    sub="في انتظار المراجعة"
                />
                <KpiCard
                    title={t("activeProducts")}
                    value={activeProducts}
                    color="emerald"
                    sub="منتجات متاحة للبيع"
                />
            </div>
        </div>
    );
}
