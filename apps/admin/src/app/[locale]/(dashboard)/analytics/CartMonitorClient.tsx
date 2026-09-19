'use client';

import { useState, useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatBox } from '@/components/ui/StatBox';
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ShoppingCart,
  TrendingDown,
  Clock,
  ExternalLink,
  MessageCircle,
  RefreshCw,
  Search,
  Eye,
  AlertTriangle,
  User,
  Sparkles,
  ShoppingBag,
  ArrowDownRight,
  Filter,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ar } from 'date-fns/locale';

function fmt(n: number) {
  return n.toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtCurrency(n: number, currency: string = 'ج.م') {
  return `${fmt(n)} ${currency === 'EGP' ? 'ج.م' : currency}`;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  abandoned: { label: 'متروكة', className: 'bg-[var(--crimson)]/20 text-[var(--crimson)] border-[var(--crimson)]/30' },
  active: { label: 'نشطة الآن', className: 'bg-[var(--amber)]/20 text-[var(--amber)] border-[var(--amber)]/30' },
  converted: { label: 'تم الشراء', className: 'bg-[var(--emerald)]/20 text-[var(--emerald)] border-[var(--emerald)]/30' },
};

export function CartMonitorClient() {
  const [days, setDays] = useState<number>(7);
  const [statusFilter, setStatusFilter] = useState<'all' | 'abandoned' | 'active' | 'converted'>('all');
  const [search, setSearch] = useState('');
  const [selectedCart, setSelectedCart] = useState<any | null>(null);

  const cartQuery = trpc.analytics.cartMonitor.useQuery({ days, status: statusFilter, limit: 100 });
  const funnelQuery = trpc.analytics.customerFunnel.useQuery({ days });
  const activityQuery = trpc.analytics.customerActivityStream.useQuery({ limit: 30 });
  const abandonedProductsQuery = trpc.analytics.abandonedProducts.useQuery({ days, limit: 5 });

  const kpis = cartQuery.data?.data?.kpis;
  const rawCarts = cartQuery.data?.data?.carts ?? [];

  // Client-side search filter
  const carts = useMemo(() => {
    if (!search.trim()) return rawCarts;
    const q = search.toLowerCase();
    return rawCarts.filter((c: any) =>
      (c.customerName && c.customerName.toLowerCase().includes(q)) ||
      (c.customerEmail && c.customerEmail.toLowerCase().includes(q)) ||
      (c.customerPhone && c.customerPhone.includes(q)) ||
      (c.lineItems && c.lineItems.some((it: any) => it.title.toLowerCase().includes(q)))
    );
  }, [rawCarts, search]);

  const funnelData = funnelQuery.data?.data?.funnel ?? [];

  const handleWhatsApp = (cart: any) => {
    const rawPhone = cart.customerPhone || '';
    const cleanPhone = rawPhone.replace(/\D/g, '');
    const firstItem = cart.lineItems?.[0]?.title || 'المنتجات المميزة';
    const itemsCount = cart.itemsCount || 1;
    const link = cart.abandonedCheckoutUrl || '';

    const text = encodeURIComponent(
      `مرحباً ${cart.customerName || 'عزيزنا العميل'}! 👋\n` +
      `لاحظنا إنك كنت بتتسوق على متجر إرث وسبت (${itemsCount > 1 ? `${firstItem} ومنتجات تانية` : firstItem}) في سلة الشراء.\n` +
      (link ? `تقدر تكمل طلبك في أي وقت من هنا: ${link}\n` : '') +
      `لو واجهتك أي مشكلة أثناء الدفع أو محتاج مساعدة، فريقنا في خدمتك دائماً! ❤️`
    );

    window.open(`https://wa.me/${cleanPhone}?text=${text}`, '_blank');
  };

  return (
    <div className="space-y-6">
      {/* Top Controls & Time Range */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[var(--t1)]">مراقبة سلات الشراء وسلوك العملاء</h2>
          <p className="text-xs text-[var(--t2)]">متابعة لحظية للسلات النشطة، المتروكة، ومحاولات الاسترداد المباشر</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-[var(--rim1)] bg-[var(--surface)] p-1 text-xs">
            {[1, 7, 14, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`px-2.5 py-1 rounded transition-colors ${
                  days === d
                    ? 'bg-[var(--gold)] text-black font-semibold'
                    : 'text-[var(--t2)] hover:text-[var(--t1)]'
                }`}
              >
                {d === 1 ? 'اليوم' : `${d} يوم`}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              cartQuery.refetch();
              funnelQuery.refetch();
              activityQuery.refetch();
            }}
            className="gap-1 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${cartQuery.isFetching ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatBox
          label="إجمالي سلات الشراء"
          value={fmt(kpis?.totalCarts ?? 0)}
          trailing={<span className="text-xs text-[var(--t3)]">خلال الفترة</span>}
        />
        <StatBox
          label="السلات المتروكة"
          value={fmt(kpis?.abandonedCount ?? 0)}
          valueClassName="text-[var(--crimson)]"
          trailing={
            kpis?.abandonmentRate !== undefined ? (
              <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-[var(--crimson)]/20 text-[var(--crimson)]">
                {kpis.abandonmentRate}% ارتداد
              </span>
            ) : null
          }
        />
        <StatBox
          label="قيمة السلات المتروكة"
          value={fmtCurrency(kpis?.abandonedValue ?? 0)}
          valueClassName="text-[var(--crimson)] font-bold"
          trailing={<span className="text-xs text-[var(--t3)]">مبيعات محتملة</span>}
        />
        <StatBox
          label="سلات تم شراؤها"
          value={fmt(kpis?.convertedCount ?? 0)}
          valueClassName="text-[var(--emerald)]"
          trailing={
            <span className="text-xs text-[var(--emerald)] font-semibold">
              {fmtCurrency(kpis?.convertedValue ?? 0)}
            </span>
          }
        />
      </div>

      {/* Conversion Funnel Section */}
      <Card className="bg-[var(--obsidian)] border-[var(--rim1)]">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base text-[var(--gold)] flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              <span>قمع تحويل العملاء (Storefront Conversion Funnel)</span>
            </CardTitle>
            <span className="text-xs text-[var(--t2)]">
              معدل التحويل العام: <strong className="text-[var(--emerald)]">{funnelQuery.data?.data?.conversionRate ?? 0}%</strong>
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {funnelData.map((step: any, idx: number) => (
              <div key={step.stage} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--t1)] font-medium flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-[var(--surface)] text-[var(--t2)] flex items-center justify-center text-[10px]">
                      {idx + 1}
                    </span>
                    {step.label}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-[var(--t2)]">{fmt(step.count)}</span>
                    <span className="font-semibold text-[var(--gold)] w-10 text-left">{step.rate}%</span>
                  </div>
                </div>
                <div className="w-full h-2 rounded-full bg-[var(--rim1)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.max(step.rate, 2)}%`,
                      backgroundColor: idx === 4 ? 'var(--emerald)' : idx === 3 ? 'var(--gold)' : 'var(--gold-br)',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Main Carts Table with Filter and Search */}
      <Card className="bg-[var(--obsidian)] border-[var(--rim1)]">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <CardTitle className="text-base text-[var(--gold)] flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" />
              <span>قائمة سلات الشراء اللحظية والمتروكة</span>
            </CardTitle>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              {/* Status Tabs */}
              <div className="flex rounded-md border border-[var(--rim1)] bg-[var(--surface)] p-0.5 text-xs">
                {(['all', 'abandoned', 'active', 'converted'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`px-2 py-1 rounded transition-colors ${
                      statusFilter === st
                        ? 'bg-[var(--gold)] text-black font-semibold'
                        : 'text-[var(--t2)] hover:text-[var(--t1)]'
                    }`}
                  >
                    {st === 'all' ? 'الكل' : STATUS_CONFIG[st].label}
                  </button>
                ))}
              </div>

              {/* Search input */}
              <div className="relative flex-1 sm:w-56">
                <Search className="w-3.5 h-3.5 absolute start-2.5 top-2.5 text-[var(--t3)]" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="بحث باسم العميل، الهاتف، المنتج..."
                  className="ps-8 h-8 text-xs bg-[var(--surface)] border-[var(--rim1)]"
                />
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-[var(--rim1)] hover:bg-transparent text-xs">
                  <TableHead className="text-start">العميل</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  <TableHead className="text-start">محتويات السلة</TableHead>
                  <TableHead className="text-start">القيمة</TableHead>
                  <TableHead className="text-start">آخر نشاط</TableHead>
                  <TableHead className="text-start">إجراءات الاسترداد</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {carts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-[var(--t3)]">
                      <EmptyState
                        icon={ShoppingCart}
                        title="لا توجد سلات شراء مطابقة"
                        hint="تأكد من اختيار مدى زمني أوسع أو ضبط فلتر الحالة."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  carts.map((cart: any) => {
                    const statusConf = STATUS_CONFIG[cart.status] ?? STATUS_CONFIG.active;
                    const hasPhone = Boolean(cart.customerPhone);
                    const hasRecoveryUrl = Boolean(cart.abandonedCheckoutUrl);

                    return (
                      <TableRow key={cart.id} className="border-b-[var(--rim1)] hover:bg-[var(--surface)]/50 text-xs">
                        {/* Customer */}
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-[var(--surface)] border border-[var(--rim1)] flex items-center justify-center text-[var(--t2)] shrink-0">
                              <User className="w-3.5 h-3.5" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-[var(--t1)] truncate">
                                {cart.customerName || 'زائر غير مسجل'}
                              </p>
                              <p className="text-[11px] text-[var(--t3)] truncate" dir="ltr">
                                {cart.customerPhone || cart.customerEmail || cart.id.slice(0, 12)}
                              </p>
                            </div>
                          </div>
                        </TableCell>

                        {/* Status */}
                        <TableCell>
                          <Badge variant="outline" className={`text-[11px] ${statusConf.className}`}>
                            {statusConf.label}
                          </Badge>
                        </TableCell>

                        {/* Line items preview */}
                        <TableCell>
                          <div className="max-w-xs">
                            <span className="font-medium text-[var(--t1)]">
                              {cart.lineItems?.[0]?.title || 'منتجات سلة'}
                            </span>
                            {cart.itemsCount > 1 && (
                              <span className="text-[var(--t3)] ms-1">
                                (+{cart.itemsCount - 1} أخرى)
                              </span>
                            )}
                            <div className="text-[10px] text-[var(--t3)]">
                              إجمالي {cart.itemsCount} وحدة
                            </div>
                          </div>
                        </TableCell>

                        {/* Total Value */}
                        <TableCell className="font-bold text-[var(--gold)]">
                          {fmtCurrency(cart.totalPrice, cart.currency)}
                        </TableCell>

                        {/* Last active time */}
                        <TableCell className="text-[var(--t3)]">
                          {formatDistanceToNow(new Date(cart.lastActiveAt), { addSuffix: true, locale: ar })}
                        </TableCell>

                        {/* Recovery Actions */}
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {hasPhone && cart.status === 'abandoned' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleWhatsApp(cart)}
                                className="h-7 px-2 text-[11px] border-[var(--emerald)]/40 text-[var(--emerald)] hover:bg-[var(--emerald)]/10 gap-1"
                              >
                                <MessageCircle className="w-3 h-3" />
                                <span>واتساب</span>
                              </Button>
                            )}

                            {hasRecoveryUrl && (
                              <a
                                href={cart.abandonedCheckoutUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center justify-center h-7 px-2 text-[11px] rounded-md border border-[var(--rim1)] text-[var(--t2)] hover:text-[var(--gold)] hover:bg-[var(--surface)] gap-1"
                              >
                                <ExternalLink className="w-3 h-3" />
                                <span>رابط السلة</span>
                              </a>
                            )}

                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setSelectedCart(cart)}
                              className="h-7 px-1.5 text-[var(--t2)] hover:text-[var(--t1)]"
                              title="عرض التفاصيل"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Bottom Grid: Most Abandoned Products & Realtime Activity Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Abandoned Products */}
        <Card className="bg-[var(--obsidian)] border-[var(--rim1)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-[var(--gold)] flex items-center gap-2">
              <ShoppingBag className="w-4 h-4" />
              <span>أكثر المنتجات المتروكة في السلات دون شراء</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {abandonedProductsQuery.data?.data?.length === 0 ? (
              <p className="text-xs text-[var(--t3)] py-4 text-center">لا توجد منتجات متروكة مسجلة في هذه الفترة</p>
            ) : (
              abandonedProductsQuery.data?.data?.map((p: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between text-xs p-2 rounded-md bg-[var(--surface)] border border-[var(--rim1)]">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[var(--t1)] truncate">{p.title}</p>
                    <p className="text-[11px] text-[var(--crimson)]">تُركت {fmt(p.abandonCount)} مرة في السلة</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-semibold text-[var(--gold)]">{fmtCurrency(p.estimatedValue)}</span>
                    <p className="text-[10px] text-[var(--t3)]">قيمة مفقودة</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Realtime Customer Event Stream */}
        <Card className="bg-[var(--obsidian)] border-[var(--rim1)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-[var(--gold)] flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span>البث المباشر لأحدث حركات العملاء على الموقع</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-80 overflow-y-auto">
            {activityQuery.data?.data?.length === 0 ? (
              <p className="text-xs text-[var(--t3)] py-4 text-center">في انتظار استقبال أول إشارة تتبع من المتجر</p>
            ) : (
              activityQuery.data?.data?.map((ev: any) => {
                const isCart = ev.eventName.includes('cart');
                const isCheckout = ev.eventName.includes('checkout');
                const isView = ev.eventName.includes('viewed');

                return (
                  <div key={ev.id} className="flex items-center justify-between text-xs p-2 rounded border border-[var(--rim1)]/60 bg-[var(--surface)]/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${
                        isCheckout ? 'bg-[var(--emerald)]' : isCart ? 'bg-[var(--gold)]' : 'bg-[var(--rim2)]'
                      }`} />
                      <div className="min-w-0">
                        <span className="font-medium text-[var(--t1)]">
                          {ev.eventName === 'page_viewed' ? 'تصفح صفحة' :
                           ev.eventName === 'product_viewed' ? `عرض منتج ${ev.title ? `: ${ev.title}` : ''}` :
                           ev.eventName === 'product_added_to_cart' ? `أضاف للسلة: ${ev.title || ''}` :
                           ev.eventName === 'cart_viewed' ? 'فتح سلة الشراء' :
                           ev.eventName === 'checkout_started' ? 'بدأ إتمام الطلب' :
                           ev.eventName === 'checkout_completed' ? 'أتم الشراء بنجاح 🎉' : ev.eventName}
                        </span>
                        <p className="text-[10px] text-[var(--t3)] truncate">
                          {ev.customerName || ev.customerEmail || 'زائر'} • {ev.source}
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] text-[var(--t3)] shrink-0">
                      {formatDistanceToNow(new Date(ev.occurredAt), { addSuffix: true, locale: ar })}
                    </span>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cart Details Modal */}
      {selectedCart && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[var(--obsidian)] border border-[var(--rim1)] rounded-lg max-w-lg w-full p-5 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--rim1)]">
              <h3 className="font-bold text-sm text-[var(--gold)]">تفاصيل سلة الشراء</h3>
              <Button size="sm" variant="ghost" onClick={() => setSelectedCart(null)} className="h-6 w-6 p-0 text-base">
                ×
              </Button>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-[var(--t2)]">العميل:</span>
                <span className="font-semibold text-[var(--t1)]">{selectedCart.customerName || 'غير مسجل'}</span>
              </div>
              {selectedCart.customerPhone && (
                <div className="flex justify-between">
                  <span className="text-[var(--t2)]">الهاتف:</span>
                  <span className="text-[var(--t1)] font-mono" dir="ltr">{selectedCart.customerPhone}</span>
                </div>
              )}
              {selectedCart.customerEmail && (
                <div className="flex justify-between">
                  <span className="text-[var(--t2)]">البريد الإلكتروني:</span>
                  <span className="text-[var(--t1)]" dir="ltr">{selectedCart.customerEmail}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[var(--t2)]">الحالة:</span>
                <Badge variant="outline" className={STATUS_CONFIG[selectedCart.status]?.className}>
                  {STATUS_CONFIG[selectedCart.status]?.label}
                </Badge>
              </div>
            </div>

            <div className="pt-2 border-t border-[var(--rim1)] space-y-2">
              <p className="font-semibold text-[var(--t1)]">المنتجات في السلة:</p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {selectedCart.lineItems?.map((item: any, i: number) => (
                  <div key={i} className="flex justify-between p-2 rounded bg-[var(--surface)] border border-[var(--rim1)]">
                    <span className="text-[var(--t1)]">{item.title} × {item.quantity}</span>
                    <span className="font-semibold text-[var(--gold)]">{fmtCurrency(item.price * item.quantity)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2 border-t border-[var(--rim1)] flex items-center justify-between font-bold text-sm">
              <span>إجمالي السلة:</span>
              <span className="text-[var(--gold)]">{fmtCurrency(selectedCart.totalPrice, selectedCart.currency)}</span>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              {selectedCart.customerPhone && selectedCart.status === 'abandoned' && (
                <Button size="sm" onClick={() => handleWhatsApp(selectedCart)} className="bg-[var(--emerald)] hover:bg-[var(--emerald)]/90 text-void gap-1">
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>تواصل عبر واتساب</span>
                </Button>
              )}
              {selectedCart.abandonedCheckoutUrl && (
                <a
                  href={selectedCart.abandonedCheckoutUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-[var(--rim1)] text-[var(--t1)] hover:bg-[var(--surface)]"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>فتح السلة في شوبيفاي</span>
                </a>
              )}
              <Button size="sm" variant="outline" onClick={() => setSelectedCart(null)}>
                إغلاق
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
