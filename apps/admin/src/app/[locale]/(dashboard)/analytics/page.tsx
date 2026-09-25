import { serverCaller } from '@/server/caller';
import { BarChart } from '@/components/charts/BarChart';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatBox } from '@/components/ui/StatBox';
import { TrendingUp, Box, Warehouse, Globe, FileText } from 'lucide-react';
import { AnalyticsTabs } from './AnalyticsTabs';

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

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const caller = await serverCaller();

  const [kpi, revenueRes, topProductsRes, inventoryRes, sourcesRes, topPagesRes] = await Promise.all([
    caller.analytics.kpiSummary(),
    caller.analytics.revenue({ days: 14 }),
    caller.analytics.topProducts({ limit: 10 }),
    caller.analytics.inventoryTurnover({ days: 30 }),
    caller.analytics.storefrontSources({ days: 30 }),
    caller.analytics.storefrontTopPages({ days: 30, limit: 10 }),
  ]);

  const kpiData = kpi.data;
  const revenueData = revenueRes.data ?? [];
  const topProducts = topProductsRes.data ?? [];
  const inventory = inventoryRes.data ?? [];
  const lowStockCount = inventoryRes.lowStockCount ?? 0;
  const sources = sourcesRes.data ?? [];
  const topPages = topPagesRes.data ?? [];

  // Build bar chart data from revenue series
  const revenueChartData = revenueData.map((r) => ({
    label: format(new Date(r.day), 'd/M', { locale: ar }),
    value: r.revenue,
  }));

  const maxRevenue = Math.max(...topProducts.map((p) => p.revenue), 1);
  const maxSourceSessions = Math.max(...sources.map((s) => s.sessions), 1);
  const maxPageViews = Math.max(...topPages.map((p) => p.views), 1);

  const salesContent = (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatBox label="طلبات اليوم" value={fmt(kpiData.ordersToday)} />
        <StatBox label="صافي مبيعات اليوم" value={fmtCurrency(kpiData.revenueToday)} valueClassName="text-[var(--gold)]" />
        <StatBox
          label="صافي مبيعات الشهر"
          value={fmtCurrency(kpiData.revenueThisMonth)}
          valueClassName="text-[var(--gold)]"
          trailing={<GrowthBadge pct={kpiData.revenueGrowth} />}
        />
        <StatBox
          label="منتجات منخفضة المخزون"
          value={fmt(lowStockCount)}
          valueClassName={lowStockCount > 0 ? 'text-[var(--crimson)]' : 'text-[var(--t1)]'}
        />
      </div>

      {/* Revenue Chart */}
      <div className="rounded-lg border border-[var(--rim1)] bg-[var(--surface)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg text-[var(--t1)]">صافي المبيعات — آخر 14 يوم (من القيود، بدون الضريبة)</h2>
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
            <span className="text-[var(--t2)]">صافي مبيعات الشهر الحالي: </span>
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

  const sourcesContent = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Traffic Sources */}
      <div className="rounded-lg border border-[var(--rim1)] bg-[var(--surface)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg text-[var(--t1)] flex items-center gap-2">
            <Globe className="w-5 h-5 text-[var(--gold)]" />
            <span>مصادر الزيارات (Traffic Sources)</span>
          </h2>
          <span className="text-xs text-[var(--t2)]">آخر 30 يوم</span>
        </div>
        {sources.length === 0 ? (
          <EmptyState
            icon={Globe}
            title="لا توجد بيانات مصادر زيارات"
            hint="سيبدأ رصد مصادر الزيارات تلقائياً بمجرد زيارة المتجر."
          />
        ) : (
          <div className="space-y-3">
            {sources.map((s, i) => {
              const pct = Math.round((s.sessions / maxSourceSessions) * 100);
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--t1)] font-medium">
                      {s.source} <span className="text-[var(--t3)]">({s.medium})</span>
                    </span>
                    <span className="font-semibold text-[var(--gold)]">{fmt(s.sessions)} زيارة</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-[var(--rim1)]">
                    <div className="h-1.5 rounded-full bg-[var(--gold)]" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Top Viewed Pages */}
      <div className="rounded-lg border border-[var(--rim1)] bg-[var(--surface)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg text-[var(--t1)] flex items-center gap-2">
            <FileText className="w-5 h-5 text-[var(--gold)]" />
            <span>الصفحات الأكثر زيارة</span>
          </h2>
          <span className="text-xs text-[var(--t2)]">آخر 30 يوم</span>
        </div>
        {topPages.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="لا توجد مشاهدات صفحات"
            hint="يتم تسجيل المشاهدات فور تفعيل البيكسل على الموقع."
          />
        ) : (
          <div className="space-y-3">
            {topPages.map((p, i) => {
              const pct = Math.round((p.views / maxPageViews) * 100);
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--t1)] font-mono truncate max-w-[70%]" dir="ltr">{p.path}</span>
                    <span className="font-semibold text-[var(--emerald)]">{fmt(p.views)} مشاهدة</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-[var(--rim1)]">
                    <div className="h-1.5 rounded-full bg-[var(--emerald)]" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">التقارير والتحليلات وسلوك العملاء</h1>

      <AnalyticsTabs
        initialTab={tab === 'carts' ? 'carts' : 'sales'}
        salesContent={salesContent}
        sourcesContent={sourcesContent}
      />
    </div>
  );
}
