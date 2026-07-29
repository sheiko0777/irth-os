import { serverCaller } from '@/server/caller';
import { ShippingClient, type ShippingZone } from './ShippingClient';

export const metadata = { title: 'مناطق الشحن | IRTH' };

export default async function ShippingPage() {
  const caller = await serverCaller();
  const zonesRes = await caller.shipping.zones.list({});

  if (zonesRes.error) {
    return (
      <div className="font-cairo p-8 text-[var(--crimson)]">
        حدث خطأ في تحميل مناطق الشحن
      </div>
    );
  }

  const zones = zonesRes.data as unknown as ShippingZone[];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--t1)] font-cairo">مناطق الشحن والأسعار</h1>
      </div>
      <ShippingClient zones={zones} />
    </div>
  );
}