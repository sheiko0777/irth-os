'use client';
import { formatMoney } from "@irth/domain";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function CouponValidator() {
    const t = useTranslations('coupons');
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
                <CardTitle className="text-xl text-[var(--t1)]">{t('validator.title')}</CardTitle>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleValidate} className="flex flex-col md:flex-row gap-4 items-end">
                    <div className="space-y-2 flex-1 w-full">
                        <Label htmlFor="test-code" className="text-start block">{t('table.code')}</Label>
                        <Input
                            id="test-code"
                            value={code}
                            onChange={(e: { target: { value: string } }) => setCode(e.target.value.toUpperCase())}
                            placeholder={t('validator.codePlaceholder')}
                            dir="ltr"
                            className="text-left uppercase"
                        />
                    </div>
                    <div className="space-y-2 flex-1 w-full">
                        <Label htmlFor="test-amount" className="text-start block">{t('validator.orderAmount')}</Label>
                        <Input
                            id="test-amount"
                            type="number"
                            step="0.01"
                            value={orderAmount}
                            onChange={(e: { target: { value: string } }) => setOrderAmount(e.target.value)}
                            placeholder={t('validator.orderAmountPlaceholder')}
                            dir="ltr"
                            className="text-left"
                        />
                    </div>
                    <Button type="submit" disabled={isFetching || !code || !orderAmount} className="w-full md:w-auto bg-[var(--emerald)] hover:bg-emerald/80">
                        {isFetching ? t('validator.checking') : t('validator.submit')}
                    </Button>
                </form>

                <div className="mt-6">
                    {isError && (
                        <div className="p-4 rounded-md bg-crimson/10 text-[var(--crimson)] border border-crimson/30">
                            {t('validator.errors.withMessage', { message: error.message })}
                        </div>
                    )}
                    {data && (
                        <div className={`p-4 rounded-md border ${data.valid ? 'bg-emerald/10 border-emerald/30 text-emerald' : 'bg-crimson/10 border-crimson/30 text-[var(--crimson)]'}`}>
                            {data.valid ? (
                                <div className="space-y-1">
                                    <p className="font-bold">{t('validator.result.valid')}</p>
                                    {/* discount is the resolved AMOUNT in both cases now — for a
                                        percentage coupon the server already applied the rate — so the
                                        old '%' suffix labelled a money value as a percentage. */}
                                    <p>{t('validator.result.discountValue', { amount: formatMoney(data.discount) })}</p>
                                    <p>{t('validator.result.discountType', {
                                        type: data.discountType === 'percentage'
                                            ? t('validator.discountTypes.percentage')
                                            : data.discountType === 'fixed'
                                                ? t('types.fixed')
                                                : t('types.freeShipping')
                                    })}</p>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    <p className="font-bold">{t('validator.result.invalid')}</p>
                                    <p>{t('validator.result.reason', {
                                        reason: data.error === 'invalid_code' ? t('validator.invalidReasons.invalidCode') :
                                            data.error === 'inactive' ? t('validator.invalidReasons.inactive') :
                                            data.error === 'expired' ? t('validator.invalidReasons.expired') :
                                            data.error === 'max_uses_reached' ? t('validator.invalidReasons.maxUsesReached') :
                                            data.error === 'min_amount_not_met' ? t('validator.invalidReasons.minAmountNotMet') :
                                            t('validator.invalidReasons.unknown')
                                    })}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}