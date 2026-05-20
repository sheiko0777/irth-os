"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProductAction } from "./actions";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const formSchema = z.object({
  id: z.string().uuid(),
  nameAr: z.string().min(1, "Name AR is required"),
  nameEn: z.string().min(1, "Name EN is required"),
  category: z.string().min(1, "Category is required"),
  description: z.string().optional(),
  isActive: z.boolean()
});

type FormValues = z.infer<typeof formSchema>;

export function EditProductForm({ product }: { product: FormValues }) {
    const t = useTranslations("products.form");
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            id: product.id,
            nameAr: product.nameAr,
            nameEn: product.nameEn,
            category: product.category,
            description: product.description || "",
            isActive: product.isActive
        }
    });

    const onSubmit = (data: FormValues) => {
        startTransition(async () => {
            const res = await updateProductAction(data);
            if (res?.error) {
                alert("Error updating product: " + res.error);
            } else {
                router.push("/ar/products");
                router.refresh();
            }
        });
    };

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
            <Card>
                <CardHeader>
                    <CardTitle>تعديل المنتج</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">الاسم (عربي)</label>
                            <Input {...register("nameAr")} />
                            {errors.nameAr && <span className="text-sm text-red-500">{errors.nameAr.message}</span>}
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">الاسم (انجليزي)</label>
                            <Input {...register("nameEn")} />
                            {errors.nameEn && <span className="text-sm text-red-500">{errors.nameEn.message}</span>}
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">القسم</label>
                        <Input {...register("category")} />
                        {errors.category && <span className="text-sm text-red-500">{errors.category.message}</span>}
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">{t("description")}</label>
                        <Input {...register("description")} />
                    </div>
                    <div className="flex items-center space-x-2 space-x-reverse">
                        <input type="checkbox" id="isActive" {...register("isActive")} className="w-4 h-4 rounded border-gray-300" />
                        <label htmlFor="isActive" className="text-sm font-medium leading-none">{t("isActive")}</label>
                    </div>
                </CardContent>
                <CardFooter className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => router.back()} disabled={isPending}>{t("cancel")}</Button>
                    <Button type="submit" disabled={isPending}>{isPending ? "..." : t("submit")}</Button>
                </CardFooter>
            </Card>
        </form>
    );
}
