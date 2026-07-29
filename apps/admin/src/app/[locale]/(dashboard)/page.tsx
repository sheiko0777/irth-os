import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { serverCaller } from "@/server/caller";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  ShoppingCart, DollarSign, Clock, Package,
  ArrowLeft, TrendingUp,
} from "lucide-react";
import Link from "next/link";

export const revalidate = 60;

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const headersList = await headers();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  let sessionData = null;
  try {
    const sessionRes = await fetch(`${appUrl}/api/auth/get-session`, {
      headers: {
        cookie: headersList.get("cookie") || "",
        "x-forwarded-host":
          headersList.get("x-forwarded-host") || headersList.get("host") || "",
      },
    });
    if (sessionRes.ok) sessionData = await sessionRes.json();
  } catch {
    // ignore
  }

  if (!sessionData?.session) redirect(`/${locale}/login`);

  const t = await getTranslations("dashboard");
  const caller = await serverCaller();
  const [stats, recent] = await Promise.all([
    caller.dashboard.getStats(),
    caller.dashboard.getRecentOrders(),
  ]);

  if (stats.error) {
    return (
      <div className="text-[var(--crimson)]">
        حدث خطأ أثناء تحميل إحصائيات لوحة القيادة
      </div>
    );
  }

  const { ordersToday, revenueToday, pendingOrders, activeProducts } =
    stats.data;
  const recentOrders = recent.data ?? [];

  return (
    <div className="space-y-8">
      {/* Page title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--t1)]">
            {t("title")}
          </h1>
          <p className="text-sm text-[var(--t3)] mt-1">
            مرحباً بك في نظام إرث — اليوم{" "}
            {new Date().toLocaleDateString("ar-EG", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
        <Link
          href={`/${locale}/orders`}
          className="flex items-center gap-1.5 text-xs text-[var(--gold)] hover:text-[var(--gold2)] transition-colors font-medium"
        >
          <TrendingUp size={13} />
          عرض كل الطلبات
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title={t("ordersToday")}
          value={ordersToday.toLocaleString("ar-EG")}
          color="azure"
          sub="إجمالي الطلبات اليوم"
          icon={<ShoppingCart size={16} />}
        />
        <KpiCard
          title={t("revenueToday")}
          value={`${revenueToday.toLocaleString("ar-EG")} ج.م`}
          color="gold"
          sub="الإيراد من الطلبات المسلَّمة"
          icon={<DollarSign size={16} />}
        />
        <KpiCard
          title={t("pendingOrders")}
          value={pendingOrders.toLocaleString("ar-EG")}
          color="crimson"
          sub="في انتظار المراجعة"
          icon={<Clock size={16} />}
        />
        <KpiCard
          title={t("activeProducts")}
          value={activeProducts.toLocaleString("ar-EG")}
          color="emerald"
          sub="منتجات متاحة للبيع"
          icon={<Package size={16} />}
        />
      </div>

      {/* Recent Orders */}
      <div className="rounded-xl border border-[var(--rim1)] bg-[var(--card-bg)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--rim1)]">
          <h2 className="text-sm font-semibold text-[var(--t1)]">آخر الطلبات</h2>
          <Link
            href={`/${locale}/orders`}
            className="flex items-center gap-1 text-xs text-[var(--t3)] hover:text-[var(--gold)] transition-colors"
          >
            عرض الكل
            <ArrowLeft size={12} />
          </Link>
        </div>

        {recentOrders.length === 0 ? (
          <div className="py-12 text-center">
            <ShoppingCart size={32} className="mx-auto mb-3 text-[var(--t4)]" />
            <p className="text-sm text-[var(--t3)]">لا توجد طلبات بعد</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--rim1)]">
                <th className="px-5 py-3 text-right text-xs font-medium text-[var(--t3)] uppercase tracking-wide">
                  رقم الطلب
                </th>
                <th className="px-5 py-3 text-right text-xs font-medium text-[var(--t3)] uppercase tracking-wide">
                  الحالة
                </th>
                <th className="px-5 py-3 text-right text-xs font-medium text-[var(--t3)] uppercase tracking-wide">
                  الإجمالي
                </th>
                <th className="px-5 py-3 text-right text-xs font-medium text-[var(--t3)] uppercase tracking-wide">
                  التاريخ
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--rim1)]">
              {recentOrders.map((order) => (
                <tr
                  key={order.id}
                  className="hover:bg-[var(--raised)] transition-colors group"
                >
                  <td className="px-5 py-3.5 font-mono text-xs text-[var(--gold)] font-medium">
                    <Link
                      href={`/${locale}/orders`}
                      className="hover:underline underline-offset-2"
                    >
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={order.status as any} />
                  </td>
                  <td className="px-5 py-3.5 text-[var(--t1)] font-medium" dir="ltr">
                    {parseFloat(order.totalAmount ?? "0").toLocaleString("ar-EG")} ج.م
                  </td>
                  <td className="px-5 py-3.5 text-[var(--t3)] text-xs">
                    {order.createdAt
                      ? new Date(order.createdAt).toLocaleDateString("ar-EG", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
