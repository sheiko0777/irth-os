import { serverCaller } from '@/server/caller';
import { BarChart } from '@/components/charts/BarChart';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { EmptyState } from '@/components/ui/EmptyState';
import { TrendingUp, Box, Warehouse } from 'lucide-react';

function fmt(n: number) {
  return n.toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtCurrency(n: number) {
  return `${fmt(n)} ج.م`;
}

function GrowthBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span
      className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
        up ? 'bg-[var(--emerald)]/20 text-[var(--emerald)]' : 'bg-[var(--crimson)]/20 text-[var(--crimson)]'
      }`}
    >
      {up ? '+' : ''}{pct}%
    </span>
  );
}

export default async function AnalyticsPage() {
  const caller = await serverCaller();

  const [kpi, revenueRes, topProductsRes, inventoryRes] = await Promise.all([
    caller.analytics.kpiSummary(),
    caller.analytics.revenue({ days: 14 }),
    caller.analytics.topProducts({ limit: 10 }),
    caller.analytics.inventoryTurnover({ days: 30 }),
  ]);

  const kpiData = kpi.data;
  const revenueData = revenueRes.data ?? [];
  const topProducts = topProductsRes.data ?? [];
  const inventory = inventoryRes.data ?? [];
  const lowStockCount = inventoryRes.lowStockCount ?? 0;

  // Build bar chart data from revenue series
  const revenueChartData = revenueData.map((r) => ({
    label: format(new Date(r.day), 'd/M', { locale: ar }),
    value: r.revenue,
  }));

  const maxRevenue = Math.max(...topProducts.map((p) => p.revenue), 1);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">التقارير والتحليلات</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-[var(--rim1)] bg-[var(--surface)] p-4 space-y-1">
          <p className="text-sm text-[var(--t2)]">طلبات اليوم</p>
          <p className="text-2xl font-bold text-[var(--t1)]">{fmt(kpiData.ordersToday)}</p>
        </div>
        <div className="rounded-lg border border-[var(--rim1)] bg-[var(--surface)] p-4 space-y-1">
          <p className="text-sm text-[var(--t2)]">إيرادات اليوم</p>
          <p className="text-2xl font-bold text-[var(--gold)]">{fmtCurrency(kpiData.revenueToday)}</p>
        </div>
        <div className="rounded-lg border border-[var(--rim1)] bg-[var(--surface)] p-4 space-y-1">
          <p className="text-sm text-[var(--t2)]">إيرادات الشهر</p>
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold text-[var(--gold)]">{fmtCurrency(kpiData.revenueThisMonth)}</p>
            <GrowthBadge pct={kpiData.revenueGrowth} />
          </div>
        </div>
        <div className="rounded-lg border border-[var(--rim1)] bg-[var(--surface)] p-4 space-y-1">
          <p className="text-sm text-[var(--t2)]">منتجات منخفضة المخزون</p>
          <p className={`text-2xl font-bold ${lowStockCount > 0 ? 'text-[var(--crimson)]' : 'text-[var(--t1)]'}`}>
            {fmt(lowStockCount)}
          </p>
        </div>
      </div>

      {/* Revenue Chart */}
      <div className="rounded-lg border border-[var(--rim1)] bg-[var(--surface)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg text-[var(--t1)]">الإيرادات — آخر 14 يوم</h2>
          <span className="text-sm text-[var(--t2)]">الطلبات المسلمة فقط</span>
        </div>
        {revenueChartData.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title="لا توجد بيانات في هذه الفترة"
            hint="الرسم بيحسب الطلبات المسلَّمة فقط. جرّب مدى زمني أوسع."
          />
        ) : (
          <BarChart
            data={revenueChartData}
            height={200}
            color="var(--gold)"
            formatValue={fmtCurrency}
          />
        )}
        {/* Revenue numbers below */}
        {revenueData.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[var(--rim1)] flex items-center justify-between text-sm text-[var(--t2)]">
            <span>
              إجمالي الفترة:{' '}
              <span className="font-bold text-[var(--gold)]">
                {fmtCurrency(revenueData.reduce((s, r) => s + r.revenue, 0))}
              </span>
            </span>
            <span>
              إجمالي الطلبات:{' '}
              <span className="font-bold text-[var(--t1)]">
                {fmt(revenueData.reduce((s, r) => s + r.orders, 0))}
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Top Products + Inventory side-by-side on larger screens */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Products */}
        <div className="rounded-lg border border-[var(--rim1)] bg-[var(--surface)] p-6">
          <h2 className="font-semibold text-lg text-[var(--t1)] mb-4">أفضل المنتجات</h2>
          {topProducts.length === 0 ? (
            <EmptyState
              icon={Box}
              title="لا توجد بيانات مبيعات"
              hint="ترتيب المنتجات بيتبني من الطلبات المسلَّمة."
            />
          ) : (
            <div className="space-y-3">
              {topProducts.map((p, i) => {
                const pct = Math.round((p.revenue / maxRevenue) * 100);
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--t1)] font-medium truncate max-w-[60%]">{p.product}</span>
                      <div className="flex items-center gap-3 text-right shrink-0">
                        <span className="text-[var(--t2)] text-xs">{fmt(p.units)} وحدة</span>
                        <span className="font-semibold text-[var(--gold)]">{fmtCurrency(p.revenue)}</span>
                      </div>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-[var(--rim1)]">
                      <div
                        className="h-1.5 rounded-full bg-[var(--gold)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Inventory Turnover */}
        <div className="rounded-lg border border-[var(--rim1)] bg-[var(--surface)] p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-lg text-[var(--t1)]">حركة المخزون</h2>
            <span className="text-xs text-[var(--t2)]">آخر 30 يوم</span>
          </div>
          {inventory.length === 0 ? (
            <EmptyState
              icon={Warehouse}
              title="لا توجد حركة مخزون"
              hint="الحركة بتتسجّل مع كل استلام أو بيع أو تسوية جرد."
            />
          ) : (
            <div className="space-y-2">
              {inventory.slice(0, 12).map((item, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between text-sm px-2 py-1.5 rounded-md ${
                    item.isLow ? 'bg-[var(--crimson)]/10' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-[var(--t1)] truncate">{item.product}</p>
                    <p className="text-[var(--t3)] text-xs truncate">{item.variant}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-right">
                    <span className={`font-semibold ${item.isLow ? 'text-[var(--crimson)]' : 'text-[var(--t1)]'}`}>
                      {item.stock} وحدة
                    </span>
                    {item.outbound > 0 && (
                      <span className="text-[var(--emerald)] text-xs">↓{item.outbound}</span>
                    )}
                    {item.isLow && (
                      <span className="text-[10px] bg-[var(--crimson)] text-void px-1 py-0.5 rounded-full font-bold">
                        منخفض
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Orders summary row */}
      <div className="rounded-lg border border-[var(--rim1)] bg-[var(--surface)] p-4">
        <div className="flex items-center gap-6 text-sm">
          <div>
            <span className="text-[var(--t2)]">إجمالي الطلبات: </span>
            <span className="font-bold text-[var(--t1)]">{fmt(kpiData.totalOrders)}</span>
          </div>
          <div>
            <span className="text-[var(--t2)]">إيرادات الشهر الحالي: </span>
            <span className="font-bold text-[var(--gold)]">{fmtCurrency(kpiData.revenueThisMonth)}</span>
            {kpiData.revenueGrowth !== null && (
              <span className="ms-2">
                <GrowthBadge pct={kpiData.revenueGrowth} />
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
