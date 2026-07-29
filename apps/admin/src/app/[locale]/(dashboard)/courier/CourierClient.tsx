'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export type CourierShipment = {
    id: string;
    orderId: string | null;
    trackingNumber: string | null;
    courier: string;
    courierStatus: string;
    codAmount: string | null;
    codCollected: boolean | null;
    codRemitted: boolean | null;
    createdAt: Date | null;
    remittanceId: string | null;
};

export type CourierRemittance = {
    id: string;
    courier: string;
    remittanceReference: string;
    amount: string;
    shipmentCount: number;
    status: string;
    expectedDate: Date | null;
    receivedDate: Date | null;
    notes: string | null;
    createdAt: Date | null;
};

type Summary = {
    totalShipments: number;
    pendingCod: number;
    remittedCod: number;
    activeRemittances: number;
};

import { StatusBadge } from '@/components/ui/StatusBadge';

interface Props {
    summary: Summary;
    initialShipments: CourierShipment[];
    initialRemittances: CourierRemittance[];
}

export default function CourierClient({ summary, initialShipments, initialRemittances }: Props) {
    const router = useRouter();
    const utils = trpc.useUtils();
    const [tab, setTab] = useState<'shipments' | 'remittances'>('shipments');
    const [courierFilter, setCourierFilter] = useState<string>('all');
    const [selectedShipmentIds, setSelectedShipmentIds] = useState<Set<string>>(new Set());
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [newRemCourier, setNewRemCourier] = useState('');
    const [newRemRef, setNewRemRef] = useState('');
    const [newRemAmount, setNewRemAmount] = useState('');
    const [newRemCount, setNewRemCount] = useState('');
    const [newRemExpectedDate, setNewRemExpectedDate] = useState('');

    const markRemittedMutation = trpc.courier.shipments.markRemitted.useMutation();
    const createRemittanceMutation = trpc.courier.remittances.create.useMutation();
    const reconcileMutation = trpc.courier.remittances.reconcile.useMutation();

    const handleInvalidate = () => {
        utils.courier.invalidate();
        router.refresh();
    };

    const filteredShipments = initialShipments.filter(
        (s) => courierFilter === 'all' || s.courier === courierFilter,
    );
    const couriers = Array.from(new Set(initialShipments.map((s) => s.courier)));

    const toggleShipmentSelection = (id: string) => {
        const next = new Set(selectedShipmentIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedShipmentIds(next);
    };

    const handleBulkRemit = async () => {
        if (selectedShipmentIds.size === 0) return;
        try {
            for (const sid of Array.from(selectedShipmentIds)) { await markRemittedMutation.mutateAsync({ shipmentId: sid, remittanceId: '' }); };
            toast.success(`تم تسجيل تسوية ${selectedShipmentIds.size} شحنة بنجاح`);
            setSelectedShipmentIds(new Set());
            handleInvalidate();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'حدث خطأ أثناء التسوية');
        }
    };

    const handleCreateRemittance = async (e: { preventDefault: () => void }) => {
        e.preventDefault();
        try {
            await createRemittanceMutation.mutateAsync({
                courier: newRemCourier,
                reference: newRemRef,
                amount: newRemAmount,
                shipmentCount: parseInt(newRemCount) || 0,
                expectedDate: newRemExpectedDate ? new Date(newRemExpectedDate) : undefined,
            });
            toast.success('تم إنشاء التسوية بنجاح');
            setIsDialogOpen(false);
            setNewRemCourier('');
            setNewRemRef('');
            setNewRemAmount('');
            setNewRemCount('');
            setNewRemExpectedDate('');
            handleInvalidate();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'حدث خطأ أثناء إنشاء التسوية');
        }
    };

    const handleReconcile = async (id: string) => {
        try {
            await reconcileMutation.mutateAsync({ remittanceId: id });
            toast.success('تمت المطابقة بنجاح');
            handleInvalidate();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'حدث خطأ أثناء المطابقة');
        }
    };

    return (
        <div className="space-y-6">
            {/* Summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-md p-6 flex flex-col justify-center items-center">
                    <p className="text-sm text-[var(--t2)] mb-2">إجمالي الشحنات</p>
                    <p className="text-3xl font-bold text-[var(--t1)]">{summary.totalShipments}</p>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-md p-6 flex flex-col justify-center items-center">
                    <p className="text-sm text-[var(--t2)] mb-2">تسويات معلقة (Pending COD)</p>
                    <p className="text-3xl font-bold text-[var(--gold)]">{summary.pendingCod} ج.م</p>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-md p-6 flex flex-col justify-center items-center">
                    <p className="text-sm text-[var(--t2)] mb-2">إجمالي المسدد (Remitted COD)</p>
                    <p className="text-3xl font-bold text-[var(--emerald)]">{summary.remittedCod} ج.م</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-4 border-b border-[var(--rim1)] pb-2">
                <button
                    onClick={() => setTab('shipments')}
                    className={`pb-2 px-4 font-bold ${tab === 'shipments' ? 'border-b-2 border-[var(--t1)] text-[var(--t1)]' : 'text-[var(--t2)]'}`}
                >
                    الشحنات
                </button>
                <button
                    onClick={() => setTab('remittances')}
                    className={`pb-2 px-4 font-bold ${tab === 'remittances' ? 'border-b-2 border-[var(--t1)] text-[var(--t1)]' : 'text-[var(--t2)]'}`}
                >
                    التسويات
                </button>
            </div>

            {/* Shipments tab */}
            {tab === 'shipments' && (
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <Select value={courierFilter} onValueChange={setCourierFilter}>
                            <SelectTrigger className="w-[200px] bg-[var(--surface)] text-[var(--t1)] border-[var(--rim1)]">
                                <SelectValue placeholder="تصفية حسب الشركة" />
                            </SelectTrigger>
                            <SelectContent className="bg-[var(--surface)] text-[var(--t1)] border-[var(--rim1)]">
                                <SelectItem value="all">الكل</SelectItem>
                                {couriers.map((c) => (
                                    <SelectItem key={c} value={c}>{c}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            onClick={handleBulkRemit}
                            disabled={selectedShipmentIds.size === 0 || markRemittedMutation.isPending}
                            className="bg-[var(--emerald)] hover:bg-[var(--emerald)]/90 text-white"
                        >
                            {markRemittedMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                            تسوية مجمعة ({selectedShipmentIds.size})
                        </Button>
                    </div>

                    <div className="rounded-md border border-[var(--rim1)] overflow-hidden bg-[var(--surface)]">
                        <Table>
                            <TableHeader className="bg-[var(--rim1)]">
                                <TableRow>
                                    <TableHead className="w-[50px]"></TableHead>
                                    <TableHead className="text-right">رقم الطلب</TableHead>
                                    <TableHead className="text-right">رقم التتبع</TableHead>
                                    <TableHead className="text-right">شركة الشحن</TableHead>
                                    <TableHead className="text-right">حالة الشحنة</TableHead>
                                    <TableHead className="text-right">قيمة COD</TableHead>
                                    <TableHead className="text-right">التحصيل والتسديد</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredShipments.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="text-center text-[var(--t2)] py-8">
                                            لا توجد شحنات
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredShipments.map((ship) => {
                                        const isEligible = ship.courierStatus === 'delivered' && ship.codRemitted === false;
                                        return (
                                            <TableRow key={ship.id} className="border-b border-[var(--rim1)]">
                                                <TableCell>
                                                    {isEligible && (
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedShipmentIds.has(ship.id)}
                                                            onChange={() => toggleShipmentSelection(ship.id)}
                                                            className="w-4 h-4 cursor-pointer"
                                                        />
                                                    )}
                                                </TableCell>
                                                <TableCell className="font-mono text-xs text-[var(--t2)]">
                                                    {ship.orderId ? ship.orderId.substring(0, 8) + '...' : '—'}
                                                </TableCell>
                                                <TableCell className="font-mono text-xs text-[var(--t2)]">
                                                    {ship.trackingNumber || '—'}
                                                </TableCell>
                                                <TableCell className="text-sm text-[var(--t1)] capitalize">{ship.courier}</TableCell>
                                                <TableCell>
                                                    <StatusBadge status={ship.courierStatus} domain="courierShipment" />
                                                </TableCell>
                                                <TableCell className="text-sm text-[var(--t1)]">
                                                    {ship.codAmount ?? '—'}
                                                </TableCell>
                                                <TableCell className="flex gap-2">
                                                    {ship.codCollected && (
                                                        <Badge className="bg-[var(--emerald)] text-white text-xs border-0">تم التحصيل</Badge>
                                                    )}
                                                    {ship.codRemitted && (
                                                        <Badge className="bg-[var(--emerald)] text-white text-xs border-0">مسدد</Badge>
                                                    )}
                                                    {!ship.codRemitted && ship.codCollected && (
                                                        <Badge className="bg-[var(--gold)] text-black text-xs border-0">غير مسدد</Badge>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            )}

            {/* Remittances tab */}
            {tab === 'remittances' && (
                <div className="space-y-4">
                    <div className="flex justify-end">
                        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                            <DialogTrigger asChild>
                                <Button className="bg-[var(--t1)] hover:bg-[var(--t2)] text-[var(--surface)]">
                                    + إنشاء تسوية
                                </Button>
                            </DialogTrigger>
                            <DialogContent
                                className="bg-[var(--surface)] text-[var(--t1)] border-[var(--rim1)]"
                            >
                                <DialogHeader>
                                    <DialogTitle>إنشاء تسوية جديدة</DialogTitle>
                                </DialogHeader>
                                <form onSubmit={handleCreateRemittance} className="space-y-4 mt-4">
                                    <div>
                                        <Label>شركة الشحن</Label>
                                        <Input
                                            value={newRemCourier}
                                            onChange={(e) => setNewRemCourier(e.target.value)}
                                            required
                                            className="bg-transparent border-[var(--rim1)]"
                                        />
                                    </div>
                                    <div>
                                        <Label>مرجع التسوية</Label>
                                        <Input
                                            value={newRemRef}
                                            onChange={(e) => setNewRemRef(e.target.value)}
                                            required
                                            className="bg-transparent border-[var(--rim1)]"
                                        />
                                    </div>
                                    <div>
                                        <Label>القيمة</Label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={newRemAmount}
                                            onChange={(e) => setNewRemAmount(e.target.value)}
                                            required
                                            className="bg-transparent border-[var(--rim1)]"
                                        />
                                    </div>
                                    <div>
                                        <Label>عدد الشحنات</Label>
                                        <Input
                                            type="number"
                                            value={newRemCount}
                                            onChange={(e) => setNewRemCount(e.target.value)}
                                            required
                                            className="bg-transparent border-[var(--rim1)]"
                                        />
                                    </div>
                                    <div>
                                        <Label>تاريخ متوقع (اختياري)</Label>
                                        <Input
                                            type="date"
                                            value={newRemExpectedDate}
                                            onChange={(e) => setNewRemExpectedDate(e.target.value)}
                                            className="bg-transparent border-[var(--rim1)]"
                                        />
                                    </div>
                                    <Button
                                        type="submit"
                                        disabled={createRemittanceMutation.isPending}
                                        className="w-full bg-[var(--emerald)] hover:bg-[var(--emerald)]/90 text-white"
                                    >
                                        {createRemittanceMutation.isPending ? 'جاري الحفظ...' : 'حفظ'}
                                    </Button>
                                </form>
                            </DialogContent>
                        </Dialog>
                    </div>

                    <div className="rounded-md border border-[var(--rim1)] overflow-hidden bg-[var(--surface)]">
                        <Table>
                            <TableHeader className="bg-[var(--rim1)]">
                                <TableRow>
                                    <TableHead className="text-right">المرجع</TableHead>
                                    <TableHead className="text-right">شركة الشحن</TableHead>
                                    <TableHead className="text-right">القيمة</TableHead>
                                    <TableHead className="text-right">عدد الشحنات</TableHead>
                                    <TableHead className="text-right">التاريخ المتوقع</TableHead>
                                    <TableHead className="text-right">الحالة</TableHead>
                                    <TableHead className="text-right">إجراءات</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {initialRemittances.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="text-center text-[var(--t2)] py-8">
                                            لا توجد تسويات
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    initialRemittances.map((rem) => (
                                        <TableRow key={rem.id} className="border-b border-[var(--rim1)]">
                                            <TableCell className="font-mono text-sm text-[var(--t2)]">
                                                {rem.remittanceReference}
                                            </TableCell>
                                            <TableCell className="text-sm text-[var(--t1)] capitalize">{rem.courier}</TableCell>
                                            <TableCell className="font-bold text-sm text-[var(--t1)]">{rem.amount}</TableCell>
                                            <TableCell className="text-sm text-[var(--t2)]">{rem.shipmentCount}</TableCell>
                                            <TableCell className="text-sm text-[var(--t2)]">
                                                {rem.expectedDate
                                                    ? new Date(rem.expectedDate).toLocaleDateString('ar-EG')
                                                    : '—'}
                                            </TableCell>
                                            <TableCell>
                                                <StatusBadge status={rem.status} domain="remittance" />
                                            </TableCell>
                                            <TableCell>
                                                {(rem.status === 'pending' || rem.status === 'received') && (
                                                    <Button
                                                        size="sm"
                                                        onClick={() => handleReconcile(rem.id)}
                                                        disabled={reconcileMutation.isPending}
                                                        className="bg-[var(--emerald)] hover:bg-[var(--emerald)]/90 text-white h-8"
                                                    >
                                                        مطابقة
                                                    </Button>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            )}
        </div>
    );
}
