"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProductAction } from "./actions";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  brand: z.enum(["irth"]).default("irth"),
  variants: z.array(z.object({
    sku: z.string().min(1, "SKU is required"),
    price: z.string().min(1, "Price is required"),
    stock: z.coerce.number().int().min(0, "Stock must be 0 or more")
  }))
});

type FormValues = z.infer<typeof formSchema>;

export function CreateProductForm() {
    const t = useTranslations("products.form");
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const { register, control, handleSubmit, formState: { errors } } = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: "",
            description: "",
            brand: "irth",
            variants: [{ sku: "", price: "0", stock: 0 }]
        }
    });

    const { fields, append, remove } = useFieldArray({
        control,
        name: "variants"
    });

    const onSubmit = (data: FormValues) => {
        startTransition(async () => {
            const res = await createProductAction(data);
            if (res?.error) {
                alert("Error creating product: " + res.error);
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
                    <CardTitle>معلومات المنتج الأساسية</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">{t("name")}</label>
                        <Input {...register("name")} />
                        {errors.name && <span className="text-sm text-red-500">{errors.name.message}</span>}
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">{t("description")}</label>
                        <Input {...register("description")} />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">{t("brand")}</label>
                        <Input {...register("brand")} disabled />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>{t("variants")}</CardTitle>
                    <Button type="button" variant="outline" size="sm" onClick={() => append({ sku: "", price: "0", stock: 0 })}>
                        {t("addVariant")}
                    </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                    {fields.map((field, index) => (
                        <div key={field.id} className="flex items-end gap-4 border p-4 rounded-md">
                            <div className="flex-1 space-y-2">
                                <label className="text-xs">{t("sku")}</label>
                                <Input {...register(`variants.${index}.sku` as const)} />
                                {errors.variants?.[index]?.sku && <span className="text-xs text-red-500">{errors.variants[index]?.sku?.message}</span>}
                            </div>
                            <div className="flex-1 space-y-2">
                                <label className="text-xs">{t("price")}</label>
                                <Input type="number" step="0.01" {...register(`variants.${index}.price` as const)} />
                                {errors.variants?.[index]?.price && <span className="text-xs text-red-500">{errors.variants[index]?.price?.message}</span>}
                            </div>
                            <div className="flex-1 space-y-2">
                                <label className="text-xs">{t("stock")}</label>
                                <Input type="number" {...register(`variants.${index}.stock` as const)} />
                                {errors.variants?.[index]?.stock && <span className="text-xs text-red-500">{errors.variants[index]?.stock?.message}</span>}
                            </div>
                            <Button type="button" variant="destructive" size="icon" onClick={() => remove(index)}>
                                X
                            </Button>
                        </div>
                    ))}
                </CardContent>
                <CardFooter className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => router.back()} disabled={isPending}>{t("cancel")}</Button>
                    <Button type="submit" disabled={isPending}>{isPending ? "..." : t("submit")}</Button>
                </CardFooter>
            </Card>
        </form>
    );
}
