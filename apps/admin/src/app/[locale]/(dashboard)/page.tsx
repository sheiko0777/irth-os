import { formatMoney, fromMinor } from "@irth/domain";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { serverCaller } from "@/server/caller";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { PipelineBar } from "@/components/ui/PipelineBar";
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

  const {
    ordersToday,
    revenueToday,
    pendingOrders,
    activeProducts,
    deltas,
    series,
    pipeline,
  } = stats.data;
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

      {/*
        Revenue is the one hero card. Gold fills exactly two things in this
        console — this card and the active nav bar — so the other three stay
        neutral rather than each taking a decorative hue.
        Sparklines and deltas only appear on the flow metrics; pending orders
        and active products are stocks, and a day-over-day delta on a stock
        would be meaningless.
      */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 rise">
        <KpiCard
          id="revenue"
          variant="hero"
          title={t("revenueToday")}
          value={formatMoney(revenueToday)}
          sub="الإيراد من الطلبات المسلَّمة"
          trend={deltas.revenueToday}
          series={series.revenue}
          href={`/${locale}/reports`}
          icon={<DollarSign size={16} />}
        />
        <KpiCard
          id="orders"
          title={t("ordersToday")}
          value={ordersToday.toLocaleString("ar-EG")}
          sub="إجمالي الطلبات اليوم"
          trend={deltas.ordersToday}
          series={series.orders}
          href={`/${locale}/orders`}
          icon={<ShoppingCart size={16} />}
        />
        <KpiCard
          id="pending"
          title={t("pendingOrders")}
          value={pendingOrders.toLocaleString("ar-EG")}
          sub="في انتظار المراجعة"
          href={`/${locale}/orders`}
          icon={<Clock size={16} />}
        />
        <KpiCard
          id="products"
          title={t("activeProducts")}
          value={activeProducts.toLocaleString("ar-EG")}
          sub="منتجات متاحة للبيع"
          href={`/${locale}/products`}
          icon={<Package size={16} />}
        />
      </div>

      {/* One entrance sequence, ~90ms apart: KPI row, then the state track,
          then the table. Enough to establish reading order, not enough to make
          an operator wait. Collapses to instant under reduced motion. */}
      <div className="rise" style={{ animationDelay: '90ms' }}>
        <PipelineBar data={pipeline} />
      </div>

      {/* Recent Orders */}
      <div
        className="rise rounded-xl border border-[var(--rim1)] bg-[var(--card-bg)] overflow-hidden"
        style={{ animationDelay: '180ms' }}
      >
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
          <EmptyState
            icon={ShoppingCart}
            title="لا توجد طلبات بعد"
            hint="أول طلب يوصل هيظهر هنا مع حالته وإجماليه."
            action={{ label: 'فتح صفحة الطلبات', href: `/${locale}/orders` }}
          />
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
                    <StatusBadge status={order.status} domain="order" />
                  </td>
                  <td className="px-5 py-3.5 text-[var(--t1)] font-medium tabular-nums" dir="ltr">
                    {formatMoney(fromMinor(order.totalAmountMinor))}
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
