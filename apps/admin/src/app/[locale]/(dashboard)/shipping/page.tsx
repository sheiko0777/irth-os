import { serverCaller } from '@/server/caller';
import { ShippingClient, type ShippingZone } from './ShippingClient';
import { PageHeader } from "@/components/ui/PageHeader";
import { MapPin } from "lucide-react";

export const metadata = { title: 'مناطق الشحن | IRTH' };

export default async function ShippingPage() {
  const caller = await serverCaller();
  const zonesRes = await caller.shipping.zones.list({});

  if (zonesRes.error) {
    return (
      <div className="p-8 text-[var(--crimson)]">
        حدث خطأ في تحميل مناطق الشحن
      </div>
    );
  }

  const zones = zonesRes.data as unknown as ShippingZone[];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="العمليات"
        title={"مناطق الشحن والأسعار"}
        icon={<MapPin />}
      />
      <ShippingClient zones={zones} />
    </div>
  );
}