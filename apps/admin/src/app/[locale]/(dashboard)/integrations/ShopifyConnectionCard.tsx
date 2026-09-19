'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PermissionGate } from '@/components/PermissionGate';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { formatDate } from '@irth/domain';
import { Copy, Check, Code, ShoppingCart, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';

const CALLBACK_BANNER: Record<string, { tone: 'good' | 'bad'; message: string }> = {
  connected: { tone: 'good', message: 'تم ربط متجر Shopify بنجاح.' },
  invalid_callback: { tone: 'bad', message: 'فشل التحقق من طلب Shopify — حاول الربط مرة أخرى.' },
  expired_state: { tone: 'bad', message: 'انتهت صلاحية طلب الربط — حاول مرة أخرى.' },
};

const STATUS_LABEL: Record<string, string> = {
  active: 'متصل',
  uninstalled: 'تم إلغاء التثبيت من Shopify',
};

export function ShopifyConnectionCard({ callbackStatus }: { callbackStatus?: string }) {
  const [shopDomain, setShopDomain] = useState('');
  const [copied, setCopied] = useState(false);
  const [showPixelGuide, setShowPixelGuide] = useState(false);

  const { data: statusResponse, isLoading, refetch } = trpc.integrations.shopifyStatus.useQuery();
  const connect = trpc.integrations.shopifyConnect.useMutation({
    onSuccess: (result) => {
      if (result.data?.url) window.location.href = result.data.url;
    },
    onError: (err) => toast.error(err.message),
  });

  const connection = statusResponse?.data ?? null;
  const banner = callbackStatus ? CALLBACK_BANNER[callbackStatus] : undefined;

  const locationsQuery = trpc.integrations.shopifyLocations.useQuery(undefined, { enabled: !!connection });
  const pixelSnippetQuery = trpc.integrations.shopifyPixelSnippet.useQuery(undefined, { enabled: !!connection });

  const setLocation = trpc.integrations.shopifySetLocation.useMutation({
    onSuccess: () => { toast.success('تم تحديث موقع المخزون'); refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const handleCopyPixel = () => {
    const code = pixelSnippetQuery.data?.data?.snippet;
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success('تم نسخ كود بيكسل Shopify بنجاح!');
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <Card className="bg-[var(--obsidian)] border-[var(--rim1)]">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <CardTitle className="text-xl text-[var(--gold)]">تكامل Shopify والموقع</CardTitle>
          {connection && (
            <Badge
              variant="outline"
              className={
                connection.status === 'active'
                  ? 'text-[var(--emerald)] border-[var(--emerald)]/30 bg-[var(--emerald)]/10'
                  : 'text-[var(--crimson)] border-[var(--crimson)]/30 bg-[var(--crimson)]/10'
              }
            >
              {STATUS_LABEL[connection.status] ?? connection.status}
            </Badge>
          )}
        </div>
        {connection && (
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            تحديث الحالة
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {banner && (
          <div
            className={
              'rounded-md border px-3 py-2 text-sm ' +
              (banner.tone === 'good'
                ? 'border-[var(--emerald)]/30 bg-[var(--emerald)]/10 text-[var(--emerald)]'
                : 'border-[var(--crimson)]/30 bg-[var(--crimson)]/10 text-[var(--crimson)]')
            }
          >
            {banner.message}
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-[var(--t3)]">جارِ التحميل…</p>
        ) : connection ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm bg-[var(--surface)] p-4 rounded-lg border border-[var(--rim1)]">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[var(--t2)]">المتجر المرتبط:</span>
                  <span className="text-[var(--t1)] font-medium font-mono" dir="ltr">{connection.shopDomain}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[var(--t2)]">موقع المخزون:</span>
                  <PermissionGate resource="integrations" action="manage">
                    <Select
                      value={connection.inventoryLocationId ?? undefined}
                      disabled={locationsQuery.isLoading || setLocation.isPending}
                      onValueChange={(inventoryLocationId) => setLocation.mutate({ inventoryLocationId })}
                    >
                      <SelectTrigger className="max-w-xs h-8 text-xs" dir="ltr">
                        <SelectValue placeholder={locationsQuery.isLoading ? 'جارِ التحميل…' : 'اختر موقعًا'} />
                      </SelectTrigger>
                      <SelectContent>
                        {locationsQuery.data?.data?.map((location) => (
                          <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </PermissionGate>
                  {!connection.inventoryLocationId && (
                    <span className="text-[var(--amber)] text-xs">لم يُحدَّد بعد</span>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5 text-xs text-[var(--t2)]">
                {connection.lastWebhookAt && (
                  <div>آخر إشارة Webhook: <span className="text-[var(--t1)]">{formatDate(connection.lastWebhookAt, { withTime: true })}</span></div>
                )}
                {connection.installedAt && (
                  <div>تاريخ التثبيت: <span className="text-[var(--t1)]">{formatDate(connection.installedAt, { withTime: true })}</span></div>
                )}
                {connection.lastError && (
                  <div className="text-[var(--crimson)]">خطأ أخير: {connection.lastError}</div>
                )}
              </div>
            </div>

            {/* Shopify Custom Pixel Section */}
            <div className="p-4 rounded-lg border border-[var(--gold-br)] bg-[var(--gold-bg)]/20 flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-[var(--gold)]" />
                  <div>
                    <h3 className="font-semibold text-sm text-[var(--t1)]">تتبع سلوك العملاء وسلات الشراء (Shopify Web Pixel)</h3>
                    <p className="text-xs text-[var(--t2)]">رصد تحركات الزوار، المنتجات المشاهدة، السلات المتروكة، وبدء الدفع لحظياً</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-[var(--gold-br)] text-[var(--gold)] hover:bg-[var(--gold)]/10 gap-1.5"
                    onClick={handleCopyPixel}
                    disabled={!pixelSnippetQuery.data?.data?.snippet}
                  >
                    {copied ? <Check className="w-4 h-4 text-[var(--emerald)]" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'تم النسخ!' : 'نسخ كود البيكسل'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowPixelGuide(!showPixelGuide)}
                    className="gap-1 text-xs text-[var(--t2)]"
                  >
                    <span>طريقة التركيب</span>
                    {showPixelGuide ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>

              {showPixelGuide && (
                <div className="mt-2 pt-3 border-t border-[var(--rim1)] text-xs text-[var(--t2)] space-y-2">
                  <p className="font-medium text-[var(--t1)]">خطوات إضافة البيكسل في Shopify في 30 ثانية:</p>
                  <ol className="list-decimal list-inside space-y-1 ms-1 text-[var(--t2)]">
                    <li>ادخل إلى لوحة تحكم Shopify الخاصة بمتجرك ثم اضغط على <strong>Settings</strong> في الأسفل.</li>
                    <li>اختر <strong>Customer Events</strong> من القائمة الجانبية.</li>
                    <li>اضغط على زر <strong>Add custom pixel</strong> واكتب اسم البيكسل (مثال: <code className="text-[var(--gold)]">IRTH Analytics</code>).</li>
                    <li>الصق الكود المنسوخ بالكامل في خانة Code واضغط <strong>Save</strong> ثم اضغط <strong>Connect</strong>.</li>
                  </ol>
                  <div className="mt-2 flex items-center justify-between pt-2 border-t border-[var(--rim1)]">
                    <span className="text-[var(--emerald)]">مفتاح الاستقبال النشط: <code className="font-mono text-xs">{connection.pixelIngestionKey}</code></span>
                    <Link href="/analytics?tab=carts" className="text-[var(--gold)] hover:underline flex items-center gap-1">
                      <ShoppingCart className="w-3.5 h-3.5" />
                      <span>فتح شاشة مراقبة سلات الشراء ➔</span>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <PermissionGate resource="integrations" action="connect">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-[var(--t3)]">لا يوجد متجر Shopify مرتبط بهذه المنظمة بعد.</p>
              <div className="flex gap-2">
                <Input
                  placeholder="your-store.myshopify.com"
                  dir="ltr"
                  value={shopDomain}
                  onChange={(e) => setShopDomain(e.target.value)}
                  className="max-w-xs"
                />
                <Button
                  disabled={!shopDomain || connect.isPending}
                  onClick={() => connect.mutate({ shopDomain })}
                >
                  {connect.isPending ? 'جارِ التحويل…' : 'ربط المتجر'}
                </Button>
              </div>
            </div>
          </PermissionGate>
        )}
      </CardContent>
    </Card>
  );
}
