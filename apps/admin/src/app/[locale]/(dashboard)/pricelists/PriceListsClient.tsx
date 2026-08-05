'use client';

import { useState } from 'react';

import { trpc } from '@/lib/trpc';

import { useRouter } from 'next/navigation';

import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { List } from 'lucide-react';


export type PriceList = {
    id: string;
    orgId: string;
    name: string;
    description: string | null;
    currency: string;
    discountPercent: number | null;
    isDefault: boolean;
    customerGroupId: string | null;
    startDate: Date | null;
    endDate: Date | null;
    createdAt: Date;
    itemCount: number;
};

export default function PriceListsClient({ initialData }: { initialData: PriceList[] }) {
    const router = useRouter();
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isItemsModalOpen, setIsItemsModalOpen] = useState(false);
    const [selectedPricelistId, setSelectedPricelistId] = useState<string | null>(null);

    const [createForm, setCreateForm] = useState({
        name: '',
        description: '',
        currency: 'EGP',
        discountPercent: '' as string | number,
        startDate: '',
        endDate: '',
    });

    type TrpcRouter = {
        pricelists: {
            create: {
                useMutation: (args: unknown) => { mutate: (args: unknown) => void, isLoading: boolean };
            };
            delete: {
                useMutation: (args: unknown) => { mutate: (args: unknown) => void, isLoading: boolean };
            };
            getItems: {
                useQuery: (args: unknown, opts: unknown) => { data: unknown, isLoading: boolean };
            };
        };
    };

    const trpcClient = trpc as unknown as TrpcRouter;

    const createMutation = trpcClient.pricelists.create.useMutation({
        onSuccess: () => {
            toast.success('تم إنشاء قائمة الأسعار بنجاح');
            setIsCreateModalOpen(false);
            setCreateForm({
                name: '',
                description: '',
                currency: 'EGP',
                discountPercent: '',
                startDate: '',
                endDate: '',
            });
            router.refresh();
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء الإنشاء');
        },
    });

    const deleteMutation = trpcClient.pricelists.delete.useMutation({
        onSuccess: () => {
            toast.success('تم حذف قائمة الأسعار');
            router.refresh();
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء الحذف');
        },
    });

    const itemsQuery = trpcClient.pricelists.getItems.useQuery(
        { pricelistId: selectedPricelistId! },
        { enabled: !!selectedPricelistId && isItemsModalOpen }
    );

    const handleCreateSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        createMutation?.mutate({
            name: createForm.name,
            description: createForm.description || undefined,
            currency: createForm.currency,
            discountPercent: createForm.discountPercent ? Number(createForm.discountPercent) : undefined,
            startDate: createForm.startDate ? new Date(createForm.startDate) : undefined,
            endDate: createForm.endDate ? new Date(createForm.endDate) : undefined,
        });
    };


    return (
        <div className="p-6" style={{ backgroundColor: 'var(--surface)' }}>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold" style={{ color: 'var(--t1)' }}>قوائم الأسعار</h1>
                <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="px-4 py-2 rounded-md text-void"
                    style={{ backgroundColor: 'var(--emerald)' }}
                >
                    + قائمة أسعار جديدة
                </button>
            </div>

            <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--rim1)' }}>
                <table className="w-full text-right" style={{ color: 'var(--t2)' }}>
                    <thead className="bg-opacity-50" style={{ backgroundColor: 'var(--rim1)', color: 'var(--t1)' }}>
                        <tr>
                            <th className="p-3">الاسم</th>
                            <th className="p-3">العملة</th>
                            <th className="p-3">نسبة الخصم</th>
                            <th className="p-3">الافتراضي</th>
                            <th className="p-3">تاريخ البدء</th>
                            <th className="p-3">تاريخ الانتهاء</th>
                            <th className="p-3">عدد المنتجات</th>
                            <th className="p-3">الإجراءات</th>
                        </tr>
                    </thead>
                    <tbody>
                        {initialData.map((list) => (
                            <tr key={list.id} className="border-t" style={{ borderColor: 'var(--rim1)' }}>
                                <td className="p-3" style={{ color: 'var(--t1)' }}>{list.name}</td>
                                <td className="p-3">{list.currency}</td>
                                <td className="p-3">
                                    {list.discountPercent !== null && list.discountPercent !== undefined ? (
                                        <span className="px-2 py-1 rounded-md text-xs" style={{ backgroundColor: 'var(--emerald)', color: 'white' }}>
                                            {list.discountPercent}%
                                        </span>
                                    ) : '-'}
                                </td>
                                <td className="p-3">
                                    {list.isDefault && (
                                        <span className="px-2 py-1 rounded-md text-xs" style={{ backgroundColor: 'var(--gold)', color: 'black' }}>
                                            افتراضي
                                        </span>
                                    )}
                                </td>
                                <td className="p-3">{list.startDate ? new Date(list.startDate).toLocaleDateString('ar-EG') : '-'}</td>
                                <td className="p-3">{list.endDate ? new Date(list.endDate).toLocaleDateString('ar-EG') : '-'}</td>
                                <td className="p-3">{list.itemCount}</td>
                                <td className="p-3 flex gap-2">
                                    <button
                                        onClick={() => {
                                            setSelectedPricelistId(list.id);
                                            setIsItemsModalOpen(true);
                                        }}
                                        className="px-3 py-1 rounded-md text-sm text-void"
                                        style={{ backgroundColor: 'var(--t1)' }}
                                    >
                                        عرض المنتجات
                                    </button>
                                    <ConfirmDialog
                                        title="حذف قائمة الأسعار"
                                        description={`هل أنت متأكد من حذف قائمة الأسعار «${list.name}»؟`}
                                        confirmLabel="حذف"
                                        onConfirm={() => deleteMutation?.mutate({ id: list.id })}
                                    >
                                        <button
                                            className="px-3 py-1 rounded-md text-sm text-void"
                                            style={{ backgroundColor: 'var(--crimson)' }}
                                        >
                                            حذف
                                        </button>
                                    </ConfirmDialog>
                                </td>
                            </tr>
                        ))}
                        {initialData.length === 0 && (
                            <tr>
                                <td colSpan={8} className="p-0"><EmptyState icon={List} title="لا توجد قوائم أسعار" hint="قوائم الأسعار بتسمح بتسعير مختلف لكل شريحة عملاء." /></td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {isCreateModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="rounded-lg w-full max-w-md p-6" style={{ backgroundColor: 'var(--surface)', color: 'var(--t1)' }}>
                        <h2 className="text-xl font-bold mb-4">قائمة أسعار جديدة</h2>
                        <form onSubmit={handleCreateSubmit} className="space-y-4">
                            <div>
                                <label className="block mb-1">الاسم *</label>
                                <input
                                    type="text"
                                    required
                                    value={createForm.name}
                                    onChange={(e: { target: { value: string } }) => setCreateForm({ ...createForm, name: e.target.value })}
                                    className="w-full p-2 rounded-md border"
                                    style={{ borderColor: 'var(--rim1)', backgroundColor: 'transparent' }}
                                />
                            </div>
                            <div>
                                <label className="block mb-1">الوصف</label>
                                <textarea
                                    value={createForm.description}
                                    onChange={(e: { target: { value: string } }) => setCreateForm({ ...createForm, description: e.target.value })}
                                    className="w-full p-2 rounded-md border"
                                    style={{ borderColor: 'var(--rim1)', backgroundColor: 'transparent' }}
                                />
                            </div>
                            <div>
                                <label className="block mb-1">العملة</label>
                                <select
                                    value={createForm.currency}
                                    onChange={(e: { target: { value: string } }) => setCreateForm({ ...createForm, currency: e.target.value })}
                                    className="w-full p-2 rounded-md border"
                                    style={{ borderColor: 'var(--rim1)', backgroundColor: 'transparent' }}
                                >
                                    <option value="EGP">EGP</option>
                                    <option value="SAR">SAR</option>
                                    <option value="AED">AED</option>
                                    <option value="USD">USD</option>
                                </select>
                            </div>
                            <div>
                                <label className="block mb-1">نسبة الخصم (%)</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={createForm.discountPercent}
                                    onChange={(e: { target: { value: string } }) => setCreateForm({ ...createForm, discountPercent: e.target.value })}
                                    className="w-full p-2 rounded-md border"
                                    style={{ borderColor: 'var(--rim1)', backgroundColor: 'transparent' }}
                                />
                            </div>
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="block mb-1">تاريخ البدء</label>
                                    <input
                                        type="date"
                                        value={createForm.startDate}
                                        onChange={(e: { target: { value: string } }) => setCreateForm({ ...createForm, startDate: e.target.value })}
                                        className="w-full p-2 rounded-md border"
                                        style={{ borderColor: 'var(--rim1)', backgroundColor: 'transparent' }}
                                    />
                                </div>
                                <div className="flex-1">
                                    <label className="block mb-1">تاريخ الانتهاء</label>
                                    <input
                                        type="date"
                                        value={createForm.endDate}
                                        onChange={(e: { target: { value: string } }) => setCreateForm({ ...createForm, endDate: e.target.value })}
                                        className="w-full p-2 rounded-md border"
                                        style={{ borderColor: 'var(--rim1)', backgroundColor: 'transparent' }}
                                    />
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setIsCreateModalOpen(false)}
                                    className="px-4 py-2 rounded-md"
                                    style={{ backgroundColor: 'var(--rim1)', color: 'var(--t1)' }}
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="submit"
                                    disabled={createMutation?.isLoading}
                                    className="px-4 py-2 rounded-md text-void"
                                    style={{ backgroundColor: 'var(--emerald)' }}
                                >
                                    {createMutation?.isLoading ? 'جاري الحفظ...' : 'حفظ'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {isItemsModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="rounded-lg w-full max-w-4xl p-6 flex flex-col max-h-[90vh]" style={{ backgroundColor: 'var(--surface)', color: 'var(--t1)' }}>
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold">المنتجات</h2>
                            <button
                                onClick={() => {
                                    setIsItemsModalOpen(false);
                                    setSelectedPricelistId(null);
                                }}
                                className="text-xl"
                            >
                                &times;
                            </button>
                        </div>
                        
                        <div className="flex-1 overflow-auto rounded-lg border" style={{ borderColor: 'var(--rim1)' }}>
                            <table className="w-full text-right" style={{ color: 'var(--t2)' }}>
                                <thead className="bg-opacity-50 sticky top-0" style={{ backgroundColor: 'var(--rim1)', color: 'var(--t1)' }}>
                                    <tr>
                                        <th className="p-3">اسم المنتج</th>
                                        <th className="p-3">SKU</th>
                                        <th className="p-3">السعر الأساسي</th>
                                        <th className="p-3">السعر المخصص</th>
                                        <th className="p-3">نسبة الخصم الفعالة</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {itemsQuery?.isLoading ? (
                                        <tr>
                                            <td colSpan={5} className="p-6 text-center">جاري التحميل...</td>
                                        </tr>
                                    ) : itemsQuery?.data && (itemsQuery.data as unknown[]).length > 0 ? (
                                        (itemsQuery.data as {productName: string, sku: string, basePrice: number, customPrice: number | null, effectiveDiscountPercent: number | null}[]).map((item, idx) => (
                                            <tr key={idx} className="border-t" style={{ borderColor: 'var(--rim1)' }}>
                                                <td className="p-3" style={{ color: 'var(--t1)' }}>{item.productName}</td>
                                                <td className="p-3">{item.sku}</td>
                                                <td className="p-3">{item.basePrice}</td>
                                                <td className="p-3">{item.customPrice ?? '-'}</td>
                                                <td className="p-3">
                                                    {item.effectiveDiscountPercent !== null && item.effectiveDiscountPercent !== undefined 
                                                        ? `${item.effectiveDiscountPercent}%` 
                                                        : '-'}
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan={5} className="p-6 text-center">لا توجد منتجات في هذه القائمة</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}