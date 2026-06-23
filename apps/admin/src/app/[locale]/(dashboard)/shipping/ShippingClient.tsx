'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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

const RATE_TYPE_LABELS: Record<ShippingRate['rateType'], string> = {
  flat: 'ثابت',
  weight_based: 'حسب الوزن',
  price_based: 'حسب السعر',
  free: 'مجاني',
};

const RATE_TYPE_COLOR: Record<ShippingRate['rateType'], string> = {
  flat: 'var(--t2)',
  weight_based: 'var(--gold)',
  price_based: 'var(--emerald)',
  free: 'var(--emerald)',
};

interface Props {
  zones: ShippingZone[];
}

export function ShippingClient({ zones: initialZones }: Props) {
  const utils = trpc.useUtils();

  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [showZoneModal, setShowZoneModal] = useState(false);
  const [showRateModal, setShowRateModal] = useState(false);

  // Zone form
  const [zoneName, setZoneName] = useState('');
  const [zoneCountries, setZoneCountries] = useState('');

  // Rate form
  const [rateName, setRateName] = useState('');
  const [rateType, setRateType] = useState<ShippingRate['rateType']>('flat');
  const [ratePrice, setRatePrice] = useState('');
  const [rateMinOrder, setRateMinOrder] = useState('');
  const [rateMaxOrder, setRateMaxOrder] = useState('');
  const [rateDaysMin, setRateDaysMin] = useState('');
  const [rateDaysMax, setRateDaysMax] = useState('');

  const createZoneMutation = trpc.shipping.zones.create.useMutation({
    onSuccess: () => { utils.shipping.zones.list.invalidate(); setShowZoneModal(false); setZoneName(''); setZoneCountries(''); },
  });

  const setActiveMutation = trpc.shipping.zones.setActive.useMutation({
    onSuccess: () => utils.shipping.zones.list.invalidate(),
  });

  const ratesQuery = trpc.shipping.rates.list.useQuery(
    { zoneId: selectedZoneId ?? '' },
    { enabled: !!selectedZoneId }
  );

  const createRateMutation = trpc.shipping.rates.create.useMutation({
    onSuccess: () => {
      ratesQuery.refetch();
      setShowRateModal(false);
      setRateName(''); setRateType('flat'); setRatePrice('');
      setRateMinOrder(''); setRateMaxOrder(''); setRateDaysMin(''); setRateDaysMax('');
    },
  });

  const deleteRateMutation = trpc.shipping.rates.delete.useMutation({
    onSuccess: () => {
      toast.success('تم حذف سعر الشحن');
      ratesQuery.refetch();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء الحذف');
    },
  });

  const selectedZone = initialZones.find(z => z.id === selectedZoneId) ?? null;

  const handleCreateZone = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const countries = zoneCountries.split(',').map(c => c.trim()).filter(Boolean);
    createZoneMutation.mutate({ name: zoneName, countries });
  };

  const handleCreateRate = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!selectedZoneId) return;
    createRateMutation.mutate({
      zoneId: selectedZoneId,
      name: rateName,
      rateType,
      price: rateType === 'free' ? 0 : parseFloat(ratePrice) || 0,
      minOrderValue: rateMinOrder ? parseFloat(rateMinOrder) : null,
      maxOrderValue: rateMaxOrder ? parseFloat(rateMaxOrder) : null,
      estimatedDaysMin: rateDaysMin ? parseInt(rateDaysMin) : null,
      estimatedDaysMax: rateDaysMax ? parseInt(rateDaysMax) : null,
    });
  };


  const showCountries = (countries: string[]) => {
    if (countries.length <= 3) return countries.join('، ');
    return countries.slice(0, 3).join('، ') + ' و' + (countries.length - 3) + ' أخرى';
  };

  const rates = (ratesQuery.data as unknown as ShippingRate[]) ?? [];

  return (
    <div className="font-cairo" dir="rtl">
      <div className="flex gap-6">
        {/* Zones panel */}
        <div className="w-1/2">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-[var(--t1)]">مناطق الشحن</h2>
            <Button onClick={() => setShowZoneModal(true)} style={{ background: 'var(--gold)', color: '#fff' }}>
              + منطقة جديدة
            </Button>
          </div>
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
                {initialZones.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-[var(--t2)] py-8">لا توجد مناطق شحن</TableCell>
                  </TableRow>
                ) : initialZones.map(zone => (
                  <TableRow
                    key={zone.id}
                    className="border-b border-[var(--rim1)] cursor-pointer"
                    style={{ background: zone.id === selectedZoneId ? 'color-mix(in srgb, var(--gold) 8%, transparent)' : undefined }}
                    onClick={() => setSelectedZoneId(zone.id)}
                  >
                    <TableCell className="font-medium text-[var(--t1)]">{zone.name}</TableCell>
                    <TableCell className="text-[var(--t2)] text-sm">{showCountries(zone.countries)}</TableCell>
                    <TableCell className="text-[var(--t2)]">{zone.rateCount}</TableCell>
                    <TableCell>
                      <button
                        onClick={(e: { stopPropagation: () => void }) => { e.stopPropagation(); setActiveMutation.mutate({ id: zone.id, isActive: !zone.isActive }); }}
                        className="px-2 py-0.5 rounded text-xs font-semibold"
                        style={{ color: zone.isActive ? 'var(--emerald)' : 'var(--t2)', border: '1px solid currentColor' }}
                      >
                        {zone.isActive ? 'نشط' : 'متوقف'}
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Rates panel */}
        <div className="w-1/2">
          {selectedZone ? (
            <>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-[var(--t1)]">أسعار: {selectedZone.name}</h2>
                <Button onClick={() => setShowRateModal(true)} style={{ background: 'var(--emerald)', color: '#fff' }}>
                  + إضافة سعر شحن
                </Button>
              </div>
              <div className="rounded-md border border-[var(--rim1)] bg-[var(--surface)]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">الاسم</TableHead>
                      <TableHead className="text-right">النوع</TableHead>
                      <TableHead className="text-right">السعر</TableHead>
                      <TableHead className="text-right">التوصيل</TableHead>
                      <TableHead className="text-right">حذف</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ratesQuery.isLoading ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-[var(--t2)] py-6">جاري التحميل...</TableCell></TableRow>
                    ) : rates.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-[var(--t2)] py-6">لا توجد أسعار</TableCell></TableRow>
                    ) : rates.map(rate => (
                      <TableRow key={rate.id} className="border-b border-[var(--rim1)]">
                        <TableCell className="font-medium text-[var(--t1)]">{rate.name}</TableCell>
                        <TableCell>
                          <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ color: RATE_TYPE_COLOR[rate.rateType] }}>
                            {RATE_TYPE_LABELS[rate.rateType]}
                          </span>
                        </TableCell>
                        <TableCell className="text-[var(--t1)]" dir="ltr">
                          {rate.rateType === 'free' ? '—' : rate.price}
                        </TableCell>
                        <TableCell className="text-[var(--t2)] text-sm">
                          {rate.estimatedDaysMin && rate.estimatedDaysMax
                            ? rate.estimatedDaysMin + '-' + rate.estimatedDaysMax + ' أيام'
                            : '—'}
                        </TableCell>
                        <TableCell>
                          <ConfirmDialog
                            title="حذف سعر الشحن"
                            description="هل أنت متأكد من حذف سعر الشحن هذا؟"
                            confirmLabel="حذف"
                            pending={deleteRateMutation.isPending}
                            onConfirm={() => deleteRateMutation.mutate({ id: rate.id })}
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={deleteRateMutation.isPending}
                              style={{ color: 'var(--crimson)' }}
                            >
                              حذف
                            </Button>
                          </ConfirmDialog>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-[var(--t2)] rounded-xl border border-[var(--rim1)] bg-[var(--surface)] p-12">
              اختر منطقة لعرض أسعارها
            </div>
          )}
        </div>
      </div>

      {/* Zone modal */}
      {showZoneModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={(e: { target: unknown; currentTarget: unknown }) => { if (e.target === e.currentTarget) setShowZoneModal(false); }}>
          <div className="bg-[var(--surface)] p-6 rounded-xl shadow-xl w-full max-w-md" dir="rtl">
            <h3 className="text-lg font-bold text-[var(--t1)] mb-4">منطقة شحن جديدة</h3>
            <form onSubmit={handleCreateZone} className="space-y-4">
              <div>
                <label className="block text-sm text-[var(--t2)] mb-1">اسم المنطقة</label>
                <input required value={zoneName} onChange={(e: { target: { value: string } }) => setZoneName(e.target.value)}
                  className="w-full p-2 border rounded border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]" />
              </div>
              <div>
                <label className="block text-sm text-[var(--t2)] mb-1">الدول (مفصولة بفاصلة)</label>
                <textarea value={zoneCountries} onChange={(e: { target: { value: string } }) => setZoneCountries(e.target.value)}
                  rows={3} className="w-full p-2 border rounded border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]" />
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setShowZoneModal(false)}>إلغاء</Button>
                <Button type="submit" disabled={createZoneMutation.isPending} style={{ background: 'var(--gold)', color: '#fff' }}>
                  {createZoneMutation.isPending ? '...' : 'إنشاء'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rate modal */}
      {showRateModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={(e: { target: unknown; currentTarget: unknown }) => { if (e.target === e.currentTarget) setShowRateModal(false); }}>
          <div className="bg-[var(--surface)] p-6 rounded-xl shadow-xl w-full max-w-md" dir="rtl">
            <h3 className="text-lg font-bold text-[var(--t1)] mb-4">إضافة سعر شحن</h3>
            <form onSubmit={handleCreateRate} className="space-y-3">
              <div>
                <label className="block text-sm text-[var(--t2)] mb-1">الاسم</label>
                <input required value={rateName} onChange={(e: { target: { value: string } }) => setRateName(e.target.value)}
                  className="w-full p-2 border rounded border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]" />
              </div>
              <div>
                <label className="block text-sm text-[var(--t2)] mb-1">النوع</label>
                <select value={rateType} onChange={(e: { target: { value: string } }) => setRateType(e.target.value as ShippingRate['rateType'])}
                  className="w-full p-2 border rounded border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]">
                  <option value="flat">ثابت</option>
                  <option value="weight_based">حسب الوزن</option>
                  <option value="price_based">حسب السعر</option>
                  <option value="free">مجاني</option>
                </select>
              </div>
              {rateType !== 'free' && (
                <div>
                  <label className="block text-sm text-[var(--t2)] mb-1">السعر</label>
                  <input type="number" min="0" step="0.01" value={ratePrice} onChange={(e: { target: { value: string } }) => setRatePrice(e.target.value)}
                    className="w-full p-2 border rounded border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]" dir="ltr" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm text-[var(--t2)] mb-1">أدنى طلب</label>
                  <input type="number" min="0" value={rateMinOrder} onChange={(e: { target: { value: string } }) => setRateMinOrder(e.target.value)}
                    className="w-full p-2 border rounded border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]" dir="ltr" />
                </div>
                <div>
                  <label className="block text-sm text-[var(--t2)] mb-1">أقصى طلب</label>
                  <input type="number" min="0" value={rateMaxOrder} onChange={(e: { target: { value: string } }) => setRateMaxOrder(e.target.value)}
                    className="w-full p-2 border rounded border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]" dir="ltr" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm text-[var(--t2)] mb-1">أيام توصيل (من)</label>
                  <input type="number" min="0" value={rateDaysMin} onChange={(e: { target: { value: string } }) => setRateDaysMin(e.target.value)}
                    className="w-full p-2 border rounded border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]" dir="ltr" />
                </div>
                <div>
                  <label className="block text-sm text-[var(--t2)] mb-1">أيام توصيل (إلى)</label>
                  <input type="number" min="0" value={rateDaysMax} onChange={(e: { target: { value: string } }) => setRateDaysMax(e.target.value)}
                    className="w-full p-2 border rounded border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]" dir="ltr" />
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button type="button" variant="outline" onClick={() => setShowRateModal(false)}>إلغاء</Button>
                <Button type="submit" disabled={createRateMutation.isPending} style={{ background: 'var(--emerald)', color: '#fff' }}>
                  {createRateMutation.isPending ? '...' : 'إضافة'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}