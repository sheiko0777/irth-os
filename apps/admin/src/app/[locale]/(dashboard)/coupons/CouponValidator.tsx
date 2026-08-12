'use client';
import { formatMoney } from "@irth/domain";

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function CouponValidator() {
    const [code, setCode] = useState('');
    const [orderAmount, setOrderAmount] = useState('');

    const { data, refetch, isFetching, isError, error } = trpc.coupons.validate.useQuery(
        { code: code.toUpperCase(), orderAmount: Number(orderAmount) || 0 },
        { enabled: false }
    );

    const handleValidate = (e: React.FormEvent) => {
        e.preventDefault();
        if (code && orderAmount) {
            refetch();
        }
    };

    return (
        <Card className="w-full">
            <CardHeader>
                <CardTitle className="text-xl text-[var(--t1)]">اختبار الكوبون</CardTitle>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleValidate} className="flex flex-col md:flex-row gap-4 items-end">
                    <div className="space-y-2 flex-1 w-full">
                        <Label htmlFor="test-code" className="text-right block">الكود</Label>
                        <Input
                            id="test-code"
                            value={code}
                            onChange={(e: { target: { value: string } }) => setCode(e.target.value.toUpperCase())}
                            placeholder="الكود المراد اختباره"
                            dir="ltr"
                            className="text-left uppercase"
                        />
                    </div>
                    <div className="space-y-2 flex-1 w-full">
                        <Label htmlFor="test-amount" className="text-right block">قيمة الطلب</Label>
                        <Input
                            id="test-amount"
                            type="number"
                            step="0.01"
                            value={orderAmount}
                            onChange={(e: { target: { value: string } }) => setOrderAmount(e.target.value)}
                            placeholder="قيمة الطلب الإجمالية"
                            dir="ltr"
                            className="text-left"
                        />
                    </div>
                    <Button type="submit" disabled={isFetching || !code || !orderAmount} className="w-full md:w-auto bg-[var(--emerald)] hover:bg-emerald/80">
                        {isFetching ? 'جاري التحقق...' : 'التحقق من الكوبون'}
                    </Button>
                </form>

                <div className="mt-6">
                    {isError && (
                        <div className="p-4 rounded-md bg-crimson/10 text-[var(--crimson)] border border-crimson/30">
                            حدث خطأ أثناء التحقق: {error.message}
                        </div>
                    )}
                    {data && (
                        <div className={`p-4 rounded-md border ${data.valid ? 'bg-emerald/10 border-emerald/30 text-emerald' : 'bg-crimson/10 border-crimson/30 text-[var(--crimson)]'}`}>
                            {data.valid ? (
                                <div className="space-y-1">
                                    <p className="font-bold">الكوبون صالح!</p>
                                    {/* discount is the resolved AMOUNT in both cases now — for a
                                        percentage coupon the server already applied the rate — so the
                                        old '%' suffix labelled a money value as a percentage. */}
                                    <p>قيمة الخصم: {formatMoney(data.discount)}</p>
                                    <p>نوع الخصم: {data.discountType === 'percentage' ? 'نسبة مئوية' : data.discountType === 'fixed' ? 'خصم ثابت' : 'شحن مجاني'}</p>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    <p className="font-bold">الكوبون غير صالح</p>
                                    <p>السبب: {
                                        data.error === 'invalid_code' ? 'الكود غير صحيح' :
                                        data.error === 'inactive' ? 'الكوبون غير مفعل' :
                                        data.error === 'expired' ? 'الكوبون منتهي الصلاحية' :
                                        data.error === 'max_uses_reached' ? 'تم الوصول للحد الأقصى للاستخدام' :
                                        data.error === 'min_amount_not_met' ? 'لم يتم الوصول للحد الأدنى للطلب' :
                                        'خطأ غير معروف'
                                    }</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
