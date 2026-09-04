'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PermissionGate } from '@/components/PermissionGate';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

const CALLBACK_BANNER: Record<string, { tone: 'good' | 'bad'; message: string }> = {
  connected: { tone: 'good', message: 'تم ربط متجر Shopify بنجاح.' },
  invalid_callback: { tone: 'bad', message: 'فشل التحقق من طلب Shopify — حاول الربط مرة أخرى.' },
  expired_state: { tone: 'bad', message: 'انتهت صلاحية طلب الربط — حاول مرة أخرى.' },
};

const STATUS_LABEL: Record<string, string> = {
  active: 'متصل',
  uninstalled: 'تم إلغاء التثبيت من Shopify',
};

/**
 * The connect kickoff is a tRPC mutation returning an authorize URL, not a
 * plain `<a href>` to apps/api — see the comment on `shopifyConnect` in
 * server/routers/integrations.ts for why a direct cross-origin link would
 * 401 (apps/api has its own, separate Better Auth session admin never has).
 */
export function ShopifyConnectionCard({ callbackStatus }: { callbackStatus?: string }) {
  const [shopDomain, setShopDomain] = useState('');
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
  const setLocation = trpc.integrations.shopifySetLocation.useMutation({
    onSuccess: () => { toast.success('تم تحديث موقع المخزون'); refetch(); },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card className="bg-[var(--obsidian)] border-[var(--rim1)]">
      <CardHeader>
        <CardTitle className="text-xl text-[var(--gold)]">Shopify</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-[var(--t2)]">المتجر:</span>
              <span className="text-[var(--t1)] font-medium" dir="ltr">{connection.shopDomain}</span>
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
            </div>
            <div className="flex items-center gap-2 text-[var(--t3)]">
              <span>موقع المخزون:</span>
              <PermissionGate resource="integrations" action="manage">
                <Select
                  value={connection.inventoryLocationId ?? undefined}
                  disabled={locationsQuery.isLoading || setLocation.isPending}
                  onValueChange={(inventoryLocationId) => setLocation.mutate({ inventoryLocationId })}
                >
                  <SelectTrigger className="max-w-xs" dir="ltr">
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
                <span className="text-[var(--amber)]">لم يُحدَّد بعد</span>
              )}
            </div>
            {connection.lastWebhookAt && (
              <div className="text-[var(--t3)]">
                آخر webhook: {new Date(connection.lastWebhookAt).toLocaleString('ar-EG')}
              </div>
            )}
            {connection.lastError && (
              <div className="text-[var(--crimson)]">خطأ أخير: {connection.lastError}</div>
            )}
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

        {connection && (
          <Button variant="outline" size="sm" className="w-fit" onClick={() => refetch()}>
            تحديث الحالة
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
