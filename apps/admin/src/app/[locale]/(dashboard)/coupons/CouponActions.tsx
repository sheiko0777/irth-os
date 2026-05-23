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
import { toast } from 'sonner';

export function CreateCouponDialog({ children }: { children: ReactNode }) {
    const [open, setOpen] = useState(false);
    const utils = trpc.useUtils();
    const createMutation = trpc.coupons.create.useMutation({
        onSuccess: () => {
            toast.success('تم إنشاء الكوبون بنجاح');
            utils.coupons.list.invalidate();
            setOpen(false);
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء إنشاء الكوبون');
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
            <DialogContent className="font-cairo sm:max-w-[425px]" dir="rtl">
                <DialogHeader>
                    <DialogTitle className="text-right">إضافة كوبون جديد</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="code" className="text-right block">كود الكوبون</Label>
                        <Input
                            id="code"
                            required
                            value={formData.code}
                            onChange={(e: { target: { value: string } }) => setFormData(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                            placeholder="مثال: SUMMER20"
                            dir="ltr"
                            className="text-left uppercase"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="type" className="text-right block">نوع الخصم</Label>
                        <Select
                            value={formData.type}
                            onValueChange={(val: 'percentage' | 'fixed' | 'free_shipping') => setFormData(p => ({ ...p, type: val }))}
                            dir="rtl"
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="اختر النوع" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="percentage">خصم نسبة مئوية</SelectItem>
                                <SelectItem value="fixed">خصم ثابت</SelectItem>
                                <SelectItem value="free_shipping">شحن مجاني</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="value" className="text-right block">القيمة</Label>
                        <Input
                            id="value"
                            type="number"
                            step="0.01"
                            required={formData.type !== 'free_shipping'}
                            value={formData.value}
                            onChange={(e: { target: { value: string } }) => setFormData(p => ({ ...p, value: e.target.value }))}
                            placeholder="القيمة"
                            dir="ltr"
                            className="text-left"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="minOrderAmount" className="text-right block">الحد الأدنى للطلب (اختياري)</Label>
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
                        <Label htmlFor="maxUses" className="text-right block">الحد الأقصى للاستخدامات (اختياري)</Label>
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
                        <Label htmlFor="expiresAt" className="text-right block">تاريخ الانتهاء (اختياري)</Label>
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
                        <Label htmlFor="description" className="text-right block">الوصف (اختياري)</Label>
                        <Textarea
                            id="description"
                            value={formData.description}
                            onChange={(e: { target: { value: string } }) => setFormData(p => ({ ...p, description: e.target.value }))}
                        />
                    </div>
                    <DialogFooter className="sm:justify-start">
                        <Button type="submit" disabled={createMutation.isPending} className="w-full sm:w-auto bg-[var(--emerald)] hover:bg-emerald-600">
                            {createMutation.isPending ? 'جاري الحفظ...' : 'حفظ'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export function ToggleCouponButton({ id, isActive }: { id: string, isActive: boolean }) {
    const utils = trpc.useUtils();
    const toggleMutation = trpc.coupons.toggleActive.useMutation({
        onSuccess: () => {
            toast.success('تم تغيير حالة الكوبون');
            utils.coupons.list.invalidate();
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : 'حدث خطأ');
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
            {toggleMutation.isPending ? '...' : isActive ? 'تعطيل' : 'تفعيل'}
        </Button>
    );
}

export function DeleteCouponButton({ id }: { id: string }) {
    const utils = trpc.useUtils();
    const deleteMutation = trpc.coupons.delete.useMutation({
        onSuccess: () => {
            toast.success('تم حذف الكوبون');
            utils.coupons.list.invalidate();
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : 'حدث خطأ');
        }
    });

    const handleDelete = () => {
        if (confirm('هل أنت متأكد من حذف هذا الكوبون؟')) {
            deleteMutation.mutate({ id });
        }
    };

    return (
        <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
        >
            حذف
        </Button>
    );
}
