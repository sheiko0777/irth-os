'use client';

import { FormEvent, useState } from 'react';
import { Plus, PackagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { trpc } from '@/lib/trpc';

export function WarehouseLotsClient({ locale }: { locale: string }) {
  const arabic = locale === 'ar';
  const utils = trpc.useUtils();
  const warehouses = trpc.warehouses.list.useQuery();
  const variants = trpc.warehouses.variants.useQuery();
  const lots = trpc.warehouses.lots.useQuery({ includeUnavailable: true });
  const [warehouseName, setWarehouseName] = useState('');
  const [warehouseCode, setWarehouseCode] = useState('');
  const [lot, setLot] = useState({ warehouseId: '', variantId: '', lotNumber: '', expiresOn: '', quantity: '1' });

  const createWarehouse = trpc.warehouses.create.useMutation({
    onSuccess: () => {
      setWarehouseName('');
      setWarehouseCode('');
      utils.warehouses.list.invalidate();
      toast.success(arabic ? 'تم إنشاء المخزن' : 'Warehouse created');
    },
    onError: (error) => toast.error(error.message),
  });
  const receiveLot = trpc.warehouses.receiveLot.useMutation({
    onSuccess: () => {
      setLot((current) => ({ ...current, lotNumber: '', expiresOn: '', quantity: '1' }));
      utils.warehouses.lots.invalidate();
      toast.success(arabic ? 'تم استلام التشغيلة' : 'Lot received');
    },
    onError: (error) => toast.error(error.message),
  });

  const warehouseRows = warehouses.data?.data ?? [];
  const variantRows = variants.data?.data ?? [];
  const lotRows = lots.data?.data ?? [];

  function submitWarehouse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createWarehouse.mutate({ name: warehouseName, code: warehouseCode, isDefault: warehouseRows.length === 0 });
  }

  function submitLot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    receiveLot.mutate({
      warehouseId: lot.warehouseId,
      variantId: lot.variantId,
      lotNumber: lot.lotNumber,
      expiresOn: lot.expiresOn || null,
      quantity: Number(lot.quantity),
    });
  }

  const inputClass = 'h-9 w-full rounded-md border border-[var(--rim2)] bg-[var(--surface)] px-3 text-sm text-[var(--t1)] outline-none focus:border-[var(--gold)]';

  return (
    <div className="space-y-5">
      <section className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={submitWarehouse} className="border border-[var(--rim1)] bg-[var(--surface)] p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--t1)]"><Plus size={16} />{arabic ? 'مخزن جديد' : 'New warehouse'}</div>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto]">
            <input className={inputClass} value={warehouseName} onChange={(event) => setWarehouseName(event.target.value)} placeholder={arabic ? 'اسم المخزن' : 'Warehouse name'} required />
            <input className={inputClass} value={warehouseCode} onChange={(event) => setWarehouseCode(event.target.value.toUpperCase())} placeholder="MAIN" required />
            <Button type="submit" size="sm" disabled={createWarehouse.isPending}>{arabic ? 'إضافة' : 'Add'}</Button>
          </div>
        </form>
        <form onSubmit={submitLot} className="border border-[var(--rim1)] bg-[var(--surface)] p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--t1)]"><PackagePlus size={16} />{arabic ? 'استلام تشغيلة' : 'Receive lot'}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <select className={inputClass} value={lot.warehouseId} onChange={(event) => setLot({ ...lot, warehouseId: event.target.value })} required>
              <option value="">{arabic ? 'اختر المخزن' : 'Select warehouse'}</option>
              {warehouseRows.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} ({warehouse.code})</option>)}
            </select>
            <select className={inputClass} value={lot.variantId} onChange={(event) => setLot({ ...lot, variantId: event.target.value })} required>
              <option value="">{arabic ? 'اختر الصنف' : 'Select product'}</option>
              {variantRows.map((variant) => <option key={variant.id} value={variant.id}>{arabic && variant.productNameAr ? variant.productNameAr : variant.productName} - {variant.name}</option>)}
            </select>
            <input className={inputClass} value={lot.lotNumber} onChange={(event) => setLot({ ...lot, lotNumber: event.target.value })} placeholder={arabic ? 'رقم التشغيلة' : 'Lot number'} required />
            <input className={inputClass} type="date" value={lot.expiresOn} onChange={(event) => setLot({ ...lot, expiresOn: event.target.value })} />
            <input className={inputClass} type="number" min="1" value={lot.quantity} onChange={(event) => setLot({ ...lot, quantity: event.target.value })} required />
            <Button type="submit" size="sm" disabled={receiveLot.isPending || warehouseRows.length === 0 || variantRows.length === 0}>{arabic ? 'استلام' : 'Receive'}</Button>
          </div>
        </form>
      </section>

      <section className="overflow-hidden border border-[var(--rim1)] bg-[var(--surface)]">
        <Table>
          <TableHeader className="bg-[var(--rim1)]"><TableRow>
            <TableHead className="text-start">{arabic ? 'المخزن' : 'Warehouse'}</TableHead>
            <TableHead className="text-start">{arabic ? 'الصنف' : 'Product'}</TableHead>
            <TableHead className="text-start">{arabic ? 'التشغيلة' : 'Lot'}</TableHead>
            <TableHead className="text-start">{arabic ? 'الصلاحية' : 'Expiry'}</TableHead>
            <TableHead className="text-start">{arabic ? 'المتاح' : 'Available'}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {lotRows.length === 0 ? <TableRow><TableCell colSpan={5} className="py-12 text-center text-sm text-[var(--t3)]">{arabic ? 'لا توجد تشغيلات مسجلة بعد.' : 'No lots have been received yet.'}</TableCell></TableRow> : lotRows.map((row) => {
              const available = row.balance.quantity - row.balance.reservedQuantity;
              return <TableRow key={row.lot.id}>
                <TableCell>{row.warehouse.name}</TableCell>
                <TableCell>{arabic && row.variant.name ? row.variant.name : row.variant.name}</TableCell>
                <TableCell dir="ltr">{row.lot.lotNumber}</TableCell>
                <TableCell>{row.lot.expiresOn ? new Date(row.lot.expiresOn).toLocaleDateString(locale) : (arabic ? 'غير محددة' : 'Not set')}</TableCell>
                <TableCell className="font-medium tabular-nums">{available.toLocaleString(locale)}</TableCell>
              </TableRow>;
            })}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
