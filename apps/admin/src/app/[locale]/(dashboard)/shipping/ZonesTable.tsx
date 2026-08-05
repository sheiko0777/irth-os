'use client';

import { trpc } from '@/lib/trpc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ShippingZone } from './ShippingClient';

interface Props {
  zones: ShippingZone[];
  selectedZoneId: string | null;
  onSelectZone: (id: string) => void;
}

export function ZonesTable({ zones, selectedZoneId, onSelectZone }: Props) {
  const utils = trpc.useUtils();

  const setActiveMutation = trpc.shipping.zones.setActive.useMutation({
    onSuccess: () => utils.shipping.zones.list.invalidate(),
  });

  const showCountries = (countries: string[]) => {
    if (countries.length <= 3) return countries.join('، ');
    return countries.slice(0, 3).join('، ') + ' و' + (countries.length - 3) + ' أخرى';
  };

  return (
    <div className="rounded-md border border-[var(--rim1)] bg-[var(--surface)]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-right">الاسم</TableHead>
            <TableHead className="text-right">الدول</TableHead>
            <TableHead className="text-right">الأسعار</TableHead>
            <TableHead className="text-right">نشط</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {zones.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-[var(--t2)] py-8">
                لا توجد مناطق شحن
              </TableCell>
            </TableRow>
          ) : (
            zones.map((zone) => (
              <TableRow
                key={zone.id}
                className="border-b border-[var(--rim1)] cursor-pointer"
                style={{
                  background: zone.id === selectedZoneId ? 'color-mix(in srgb, var(--gold) 8%, transparent)' : undefined,
                }}
                onClick={() => onSelectZone(zone.id)}
              >
                <TableCell className="font-medium text-[var(--t1)]">{zone.name}</TableCell>
                <TableCell className="text-[var(--t2)] text-sm">{showCountries(zone.countries)}</TableCell>
                <TableCell className="text-[var(--t2)]">{zone.rateCount}</TableCell>
                <TableCell>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveMutation.mutate({ id: zone.id, isActive: !zone.isActive });
                    }}
                    className="px-2 py-0.5 rounded-full text-xs font-semibold"
                    style={{
                      color: zone.isActive ? 'var(--emerald)' : 'var(--t2)',
                      border: '1px solid currentColor',
                    }}
                  >
                    {zone.isActive ? 'نشط' : 'متوقف'}
                  </button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
