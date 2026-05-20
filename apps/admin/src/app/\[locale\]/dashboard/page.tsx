import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, DollarSign, Package, ShoppingCart } from "lucide-react";
import { verifySession } from "@/lib/auth";
import { redirect } from "next/navigation";

// Revalidate every 60 seconds
export const revalidate = 60;

export default async function DashboardPage({ params }: { params: { locale: string } }) {
    const { locale } = await params;
    const session = await verifySession();
    if (!session) redirect(`/${locale}/login`);

    const t = await getTranslations("dashboard");
    const caller = await serverCaller();

    let stats;
    try {
        stats = await caller.dashboard.getStats();
    } catch (e) {
        return <div>Error loading dashboard stats</div>;
    }

    if (stats.error) {
        return <div>Error loading dashboard stats</div>;
    }

    const { ordersToday, revenueToday, pendingOrders, activeProducts } = stats.data;

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">
                            {t("ordersToday")}
                        </CardTitle>
                        <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{ordersToday}</div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">
                            {t("revenueToday")}
                        </CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{revenueToday.toLocaleString()}</div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">
                            {t("pendingOrders")}
                        </CardTitle>
                        <Activity className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{pendingOrders}</div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">
                            {t("activeProducts")}
                        </CardTitle>
                        <Package className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{activeProducts}</div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
