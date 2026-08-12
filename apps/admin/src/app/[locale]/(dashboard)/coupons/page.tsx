import { formatMoney, fromMinor } from "@irth/domain";
import { serverCaller } from '@/server/caller';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CreateCouponDialog, ToggleCouponButton, DeleteCouponButton } from './CouponActions';
import { CouponValidator } from './CouponValidator';
import { format } from 'date-fns';

// Next 15 hands `searchParams` to pages as a Promise. Typing it as a plain
// object compiles under `tsc` — the generated route types live outside the
// tsconfig include — but fails `next build`, so it only surfaced at deploy.
export default async function CouponsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
    const page = Number((await searchParams).page) || 1;
    const pageSize = 20;

    const caller = await serverCaller();
    const data = await caller.coupons.list({ page, pageSize });

    const totalActive = data.items.filter((c) => c.isActive).length;
    const totalUses = data.items.reduce((acc: number, c) => acc + (c.usedCount ?? 0), 0);

    const typeLabels: Record<string, string> = {
        'percentage': 'خصم نسبة مئوية',
        'fixed': 'خصم ثابت',
        'free_shipping': 'شحن مجاني',
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-[var(--t1)]">الكوبونات والخصومات</h1>
                <CreateCouponDialog>
                    <Button className="bg-[var(--emerald)] hover:bg-emerald/80 text-void">إضافة كوبون جديد</Button>
                </CreateCouponDialog>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="bg-[var(--surface)] border-[var(--rim1)]">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-[var(--t2)]">الكوبونات النشطة</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-[var(--t1)]">{totalActive}</div>
                    </CardContent>
                </Card>
                <Card className="bg-[var(--surface)] border-[var(--rim1)]">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-[var(--t2)]">إجمالي الاستخدامات</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-[var(--t1)]">{totalUses}</div>
                    </CardContent>
                </Card>
            </div>

            <CouponValidator />

            <div className="bg-[var(--surface)] rounded-md border border-[var(--rim1)] overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-right">
                        <thead className="bg-raised border-b border-[var(--rim1)]">
                            <tr>
                                <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">الكود</th>
                                <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">النوع</th>
                                <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">القيمة</th>
                                <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">الاستخدامات</th>
                                <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">الحد</th>
                                <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">الانتهاء</th>
                                <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">الحالة</th>
                                <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">إجراءات</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--rim1)]">
                            {data.items.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="p-0"><EmptyState title="لا توجد كوبونات" hint="الكوبون بيدّي خصم بنسبة أو مبلغ ثابت، وممكن تحدّد له مدة وحد أقصى للاستخدام." /></td>
                                </tr>
                            ) : (
                                data.items.map((coupon) => (
                                    <tr key={coupon.id} className="hover:bg-raised/50">
                                        <td className="px-4 py-3 text-sm font-medium font-mono text-[var(--t1)]" dir="ltr">{coupon.code}</td>
                                        <td className="px-4 py-3 text-sm text-[var(--t2)]">{typeLabels[coupon.type]}</td>
                                        <td className="px-4 py-3 text-sm text-[var(--t2)]" dir="ltr">
                                            {coupon.type === 'percentage'
                                                ? (coupon.percentBp === null ? '-' : `${coupon.percentBp / 100}%`)
                                                : coupon.type === 'free_shipping'
                                                  ? '-'
                                                  : (coupon.amountMinor === null ? '-' : formatMoney(fromMinor(coupon.amountMinor)))}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-[var(--t2)]">
                                            {coupon.usedCount} {coupon.maxUses ? `/ ${coupon.maxUses}` : ''}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-[var(--t2)]" dir="ltr">
                                            {coupon.minOrderAmountMinor === null ? '-' : formatMoney(fromMinor(coupon.minOrderAmountMinor))}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-[var(--t2)]" dir="ltr">
                                            {coupon.expiresAt ? format(new Date(coupon.expiresAt), 'yyyy-MM-dd') : '-'}
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${coupon.isActive ? 'bg-emerald/15 text-emerald' : 'bg-crimson/15 text-crimson'}`}>
                                                {coupon.isActive ? 'نشط' : 'معطل'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            <div className="flex gap-2 justify-end">
                                                <ToggleCouponButton id={coupon.id} isActive={coupon.isActive} />
                                                <DeleteCouponButton id={coupon.id} />
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
