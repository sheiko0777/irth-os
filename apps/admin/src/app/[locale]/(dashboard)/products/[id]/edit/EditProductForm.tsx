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

const createFormSchema = (t: ReturnType<typeof useTranslations<"products">>) => z.object({
  id: z.string().uuid(),
  name: z.string().min(1, t("validation.nameRequired")),
  description: z.string().optional(),
  isActive: z.boolean()
});

type FormValues = z.infer<ReturnType<typeof createFormSchema>>;

type FormDefaultValues = z.input<ReturnType<typeof createFormSchema>>;

interface Product { id: string; name: string; description?: string | null; isActive: boolean; }

export function EditProductForm({ product }: { product: Product }) {
    const t = useTranslations("products");
    const formSchema = createFormSchema(t);
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            id: product.id,
            name: product.name,
            description: product.description || "",
            isActive: product.isActive
        }
    });

    const onSubmit = (data: FormDefaultValues) => {
        startTransition(async () => {
            const res = await updateProductAction(data);
            if (res?.error) {
                alert(t("errors.updateProductWithMessage", { error: res.error }));
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
                    <CardTitle>{t("edit")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">{t("form.name")}</label>
                        <Input {...register("name")} />
                        {errors.name && <span className="text-sm text-crimson">{errors.name.message}</span>}
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">{t("form.description")}</label>
                        <Input {...register("description")} />
                    </div>
                    <div className="flex items-center space-x-2">
                        <input type="checkbox" id="isActive" {...register("isActive")} className="w-4 h-4 rounded-md border-rim1" />
                        <label htmlFor="isActive" className="text-sm font-medium leading-none">{t("form.isActive")}</label>
                    </div>
                </CardContent>
                <CardFooter className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => router.back()} disabled={isPending}>{t("form.cancel")}</Button>
                    <Button type="submit" disabled={isPending}>{isPending ? t("form.saving") : t("form.submit")}</Button>
                </CardFooter>
            </Card>
        </form>
    );
}
