'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { ZonesTable } from './ZonesTable';
import { RatesTable } from './RatesTable';
import { CreateZoneModal } from './CreateZoneModal';
import { CreateRateModal } from './CreateRateModal';

export type ShippingZone = {
  id: string;
  orgId: string;
  name: string;
  countries: string[];
  isActive: boolean;
  createdAt: Date;
  rateCount: number;
};

export type ShippingRate = {
  id: string;
  zoneId: string;
  name: string;
  rateType: 'flat' | 'weight_based' | 'price_based' | 'free';
  price: number;
  minOrderValue: number | null;
  maxOrderValue: number | null;
  minWeight: number | null;
  maxWeight: number | null;
  estimatedDaysMin: number | null;
  estimatedDaysMax: number | null;
  isActive: boolean;
};

interface Props {
  zones: ShippingZone[];
}

// Composer only: each child owns its own queries and mutations. Rate-type
// labels and colours now come from lib/statusMaps via StatusBadge inside
// RatesTable, so this file no longer carries local RATE_TYPE_* maps.
export function ShippingClient({ zones }: Props) {
  const utils = trpc.useUtils();
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [showZoneModal, setShowZoneModal] = useState(false);
  const [showRateModal, setShowRateModal] = useState(false);

  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;

  return (
    <div className="font-cairo">
      <div className="flex gap-6">
        {/* Zones panel */}
        <div className="w-1/2">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-[var(--t1)]">مناطق الشحن</h2>
            <Button onClick={() => setShowZoneModal(true)} style={{ background: 'var(--gold)', color: 'var(--void)' }}>
              + منطقة جديدة
            </Button>
          </div>
          <ZonesTable
            zones={zones}
            selectedZoneId={selectedZoneId}
            onSelectZone={setSelectedZoneId}
          />
        </div>

        {/* Rates panel */}
        <div className="w-1/2">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-[var(--t1)]">
              {selectedZone ? 'أسعار: ' + selectedZone.name : 'أسعار الشحن'}
            </h2>
            <Button
              onClick={() => setShowRateModal(true)}
              disabled={!selectedZoneId}
              style={{ background: 'var(--gold)', color: 'var(--void)' }}
            >
              + سعر جديد
            </Button>
          </div>
          {selectedZoneId ? (
            <RatesTable zoneId={selectedZoneId} />
          ) : (
            <div className="rounded-md border border-[var(--rim1)] bg-[var(--surface)] text-center text-[var(--t2)] py-8">
              اختر منطقة لعرض أسعارها
            </div>
          )}
        </div>
      </div>

      <CreateZoneModal
        open={showZoneModal}
        onClose={() => setShowZoneModal(false)}
        onSuccess={() => {
          setShowZoneModal(false);
          void utils.shipping.zones.list.invalidate();
        }}
      />

      <CreateRateModal
        open={showRateModal}
        onClose={() => setShowRateModal(false)}
        zoneId={selectedZoneId}
        onSuccess={() => {
          setShowRateModal(false);
          if (selectedZoneId) void utils.shipping.rates.list.invalidate({ zoneId: selectedZoneId });
        }}
      />
    </div>
  );
}
