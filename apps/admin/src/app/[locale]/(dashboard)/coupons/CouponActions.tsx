'use client';

import { useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import { trpc } from '@/lib/trpc';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

export function CreateCouponDialog({ children }: { children: ReactNode }) {
    const t = useTranslations('coupons');
    const [open, setOpen] = useState(false);
    const utils = trpc.useUtils();
    const createMutation = trpc.coupons.create.useMutation({
        onSuccess: () => {
            toast.success(t('toasts.created'));
            utils.coupons.list.invalidate();
            setOpen(false);
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : t('errors.createCoupon'));
        }
    });

    const [formData, setFormData] = useState({
        code: '',
        type: 'percentage' as 'percentage' | 'fixed' | 'free_shipping',
        value: '',
        minOrderAmount: '',
        maxUses: '',
        expiresAt: '',
        description: '',
    });

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        createMutation.mutate({
            code: formData.code.toUpperCase(),
            type: formData.type,
            value: Number(formData.value) || 0,
            minOrderAmount: formData.minOrderAmount ? Number(formData.minOrderAmount) : undefined,
            maxUses: formData.maxUses ? Number(formData.maxUses) : undefined,
            expiresAt: formData.expiresAt ? new Date(formData.expiresAt) : undefined,
            description: formData.description || undefined,
        });
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {children}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="text-start">{t('createDialog.title')}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="code" className="text-start block">{t('form.code')}</Label>
                        <Input
                            id="code"
                            required
                            value={formData.code}
                            onChange={(e: { target: { value: string } }) => setFormData(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                            placeholder={t('form.codePlaceholder')}
                            dir="ltr"
                            className="text-left uppercase"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="type" className="text-start block">{t('form.type')}</Label>
                        <Select
                            value={formData.type}
                            onValueChange={(val: 'percentage' | 'fixed' | 'free_shipping') => setFormData(p => ({ ...p, type: val }))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('form.typePlaceholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="percentage">{t('types.percentage')}</SelectItem>
                                <SelectItem value="fixed">{t('types.fixed')}</SelectItem>
                                <SelectItem value="free_shipping">{t('types.freeShipping')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="value" className="text-start block">{t('form.value')}</Label>
                        <Input
                            id="value"
                            type="number"
                            step="0.01"
                            required={formData.type !== 'free_shipping'}
                            value={formData.value}
                            onChange={(e: { target: { value: string } }) => setFormData(p => ({ ...p, value: e.target.value }))}
                            placeholder={t('form.value')}
                            dir="ltr"
                            className="text-left"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="minOrderAmount" className="text-start block">{t('form.minOrderAmount')}</Label>
                        <Input
                            id="minOrderAmount"
                            type="number"
                            step="0.01"
                            value={formData.minOrderAmount}
                            onChange={(e: { target: { value: string } }) => setFormData(p => ({ ...p, minOrderAmount: e.target.value }))}
                            dir="ltr"
                            className="text-left"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="maxUses" className="text-start block">{t('form.maxUses')}</Label>
                        <Input
                            id="maxUses"
                            type="number"
                            value={formData.maxUses}
                            onChange={(e: { target: { value: string } }) => setFormData(p => ({ ...p, maxUses: e.target.value }))}
                            dir="ltr"
                            className="text-left"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="expiresAt" className="text-start block">{t('form.expiresAt')}</Label>
                        <Input
                            id="expiresAt"
                            type="date"
                            value={formData.expiresAt}
                            onChange={(e: { target: { value: string } }) => setFormData(p => ({ ...p, expiresAt: e.target.value }))}
                            dir="ltr"
                            className="text-left"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="description" className="text-start block">{t('form.description')}</Label>
                        <Textarea
                            id="description"
                            value={formData.description}
                            onChange={(e: { target: { value: string } }) => setFormData(p => ({ ...p, description: e.target.value }))}
                        />
                    </div>
                    <DialogFooter className="sm:justify-start">
                        <Button type="submit" disabled={createMutation.isPending} className="w-full sm:w-auto bg-[var(--emerald)] hover:bg-emerald/80">
                            {createMutation.isPending ? t('actions.saving') : t('actions.save')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export function ToggleCouponButton({ id, isActive }: { id: string, isActive: boolean }) {
    const t = useTranslations('coupons');
    const utils = trpc.useUtils();
    const toggleMutation = trpc.coupons.toggleActive.useMutation({
        onSuccess: () => {
            toast.success(t('toasts.statusChanged'));
            utils.coupons.list.invalidate();
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : t('errors.generic'));
        }
    });

    return (
        <Button
            variant="outline"
            size="sm"
            onClick={() => toggleMutation.mutate({ id })}
            disabled={toggleMutation.isPending}
            className={isActive ? 'text-[var(--crimson)] hover:text-[var(--crimson)]' : 'text-[var(--emerald)] hover:text-[var(--emerald)]'}
        >
            {toggleMutation.isPending ? t('actions.pending') : isActive ? t('actions.disable') : t('actions.enable')}
        </Button>
    );
}

export function DeleteCouponButton({ id }: { id: string }) {
    const t = useTranslations('coupons');
    const utils = trpc.useUtils();
    const deleteMutation = trpc.coupons.delete.useMutation({
        onSuccess: () => {
            toast.success(t('toasts.deleted'));
            utils.coupons.list.invalidate();
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : t('errors.generic'));
        }
    });

    return (
        <ConfirmDialog
            title={t('confirm.deleteTitle')}
            description={t('confirm.deleteDescription')}
            confirmLabel={t('actions.delete')}
            pending={deleteMutation.isPending}
            onConfirm={() => deleteMutation.mutate({ id })}
        >
            <Button
                variant="destructive"
                size="sm"
                disabled={deleteMutation.isPending}
            >
                {t('actions.delete')}
            </Button>
        </ConfirmDialog>
    );
}