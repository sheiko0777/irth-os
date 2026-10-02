import { formatDate, formatNumber } from "@irth/domain";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { serverCaller } from "@/server/caller";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { PipelineBar } from "@/components/ui/PipelineBar";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  ShoppingCart, Wallet, Clock, Package,
  ArrowLeft, TrendingUp, Receipt,
} from "lucide-react";
import { AreaChart } from "@/components/charts/AreaChart";
import { Money } from "@/components/ui/Money";
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

  // Hand the failure to the dashboard error boundary (localised, with retry)
  // instead of a hard-coded Arabic line with no way to recover.
  if (stats.error) {
    throw new Error(`dashboard.getStats failed: ${String(stats.error)}`);
  }
  const tCommon = await getTranslations("common.error");

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

  // The week behind the sparklines, as day names: oldest first, ending today
  // (the router's window is today minus six days, in UTC).
  const weekLabels = series.orders.map((_, i) => {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - (series.orders.length - 1 - i));
    return formatDate(day, { dateTimeOptions: { weekday: "short" } });
  });
  const firstName = String(sessionData.user?.name ?? "").split(" ")[0];

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--text-secondary)]">
            {firstName ? `أهلاً، ${firstName}` : "أهلاً بيك"}
          </p>
          <h1 className="mt-1 text-[1.75rem] font-semibold leading-tight tracking-tight text-[var(--text-primary)]">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            مرحباً بك في نظام إرث — اليوم{" "}
            {formatDate(new Date(), {
              dateTimeOptions: { weekday: "long", year: "numeric", month: "long", day: "numeric" },
            })}
          </p>
        </div>
        <Link
          href={`/${locale}/orders`}
          className="inline-flex min-h-11 items-center gap-2 rounded-[var(--control-radius)] bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-fg)] shadow-[0_8px_18px_-10px_var(--accent)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
        >
          <TrendingUp size={16} aria-hidden="true" />
          عرض كل الطلبات
        </Link>
      </div>

      {/*
        Net sales is the one navy hero. Sparklines and deltas only appear on the
        flow metrics; pending orders and active products are stocks, and a
        day-over-day delta on a stock would be meaningless.
      */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 rise">
        <KpiCard
          id="revenue"
          variant="hero"
          title={t("revenueToday")}
          value={<Money minor={revenueToday.minor} currency={revenueToday.currency} emphasis data-testid="revenue-today" />}
          sub="الإيراد من الطلبات المسلَّمة"
          trend={deltas.revenueToday}
          series={series.revenue}
          href={`/${locale}/finance`}
          icon={<Wallet />}
        />
        <KpiCard
          id="orders"
          title={t("ordersToday")}
          value={ordersToday}
          sub="إجمالي الطلبات اليوم"
          trend={deltas.ordersToday}
          series={series.orders}
          href={`/${locale}/orders`}
          icon={<ShoppingCart />}
        />
        <KpiCard
          id="pending"
          title={t("pendingOrders")}
          value={pendingOrders}
          sub="في انتظار المراجعة"
          href={`/${locale}/orders`}
          icon={<Clock />}
        />
        <KpiCard
          id="products"
          title={t("activeProducts")}
          value={activeProducts}
          sub="منتجات متاحة للبيع"
          href={`/${locale}/products`}
          icon={<Package />}
        />
      </div>

      {/* One entrance sequence, ~90ms apart: KPI row, then the trend and the
          state track, then the table. Collapses to instant under reduced motion. */}
      <div className="grid items-start gap-4 lg:grid-cols-3 rise" style={{ animationDelay: "90ms" }}>
        <section aria-labelledby="orders-trend" className="glass rounded-[var(--card-radius)] p-5 lg:col-span-2">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 id="orders-trend" className="text-sm font-semibold text-[var(--text-primary)]">
                الطلبات — آخر 7 أيام
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">عدد الطلبات الجديدة كل يوم</p>
            </div>
            <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)] tabular-nums" dir="ltr">
              {formatNumber(series.orders.reduce((a, b) => a + b, 0))}
            </span>
          </div>
          <AreaChart
            id="orders-week"
            title="عدد الطلبات في آخر 7 أيام"
            height={180}
            data={series.orders.map((value, i) => ({ label: weekLabels[i], value }))}
          />
        </section>
        <PipelineBar data={pipeline} />
      </div>

      {/* Recent Orders */}
      <section
        aria-labelledby="recent-orders"
        className="rise glass overflow-hidden rounded-[var(--card-radius)]"
        style={{ animationDelay: "180ms" }}
      >
        <div className="flex items-center justify-between px-5 py-4">
          <h2 id="recent-orders" className="text-sm font-semibold text-[var(--text-primary)]">آخر الطلبات</h2>
          <Link
            href={`/${locale}/orders`}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]"
          >
            عرض الكل
            <ArrowLeft size={12} aria-hidden="true" />
          </Link>
        </div>

        {recent.error ? (
          // A failed recent-orders query is not "no orders yet".
          <p role="alert" data-testid="recent-orders-error" className="px-6 py-8 text-sm text-[var(--critical)]">
            {tCommon("section")}
          </p>
        ) : recentOrders.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="لا توجد طلبات بعد"
            hint="أول طلب يوصل هيظهر هنا مع حالته وإجماليه."
            action={{ label: 'فتح صفحة الطلبات', href: `/${locale}/orders` }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--raised)]/60">
                <tr>
                  {["رقم الطلب", "الحالة", "الإجمالي", "التاريخ"].map((h) => (
                    <th key={h} scope="col" className="px-5 py-3 text-start text-xs font-semibold text-[var(--text-secondary)]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--separator)]">
                {recentOrders.map((order) => (
                  <tr key={order.id} className="transition-colors hover:bg-[var(--accent-soft)]">
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/${locale}/orders/${order.id}`}
                        className="inline-flex items-center gap-3 font-medium text-[var(--text-primary)] hover:text-[var(--accent)]"
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]" aria-hidden="true">
                          <Receipt size={16} />
                        </span>
                        <span className="font-mono text-xs" dir="ltr">{order.orderNumber}</span>
                      </Link>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={order.status} domain="order" />
                    </td>
                    <td className="px-5 py-3.5 font-semibold text-[var(--text-primary)]">
                      <Money minor={order.totalAmountMinor} />
                    </td>
                    <td className="px-5 py-3.5 text-xs text-[var(--text-secondary)]">
                      {order.createdAt
                        ? formatDate(order.createdAt, {
                            dateTimeOptions: { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
                          })
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
