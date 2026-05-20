"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

const productSchema = z.object({
  name: z.string().min(1, "Name is required"),
  nameAr: z.string().optional(),
  sku: z.string().min(1, "SKU is required"),
  categoryId: z.string().uuid().optional(),
  description: z.string().optional(),
  descriptionAr: z.string().optional(),
  price: z.preprocess((val) => Number(val), z.number().min(0)),
  currency: z.string().default("USD"),
  stock: z.preprocess((val) => Number(val), z.number().int().min(0)),
  status: z.string().default("active"),
});

export function ProductForm({
  initialData,
  categories,
}: {
  initialData?: z.infer<typeof productSchema> & { id?: string };
  categories?: { id: string; name: string }[];
}) {
  const t = useTranslations("products");
  const router = useRouter();

  const form = useForm({
    resolver: zodResolver(productSchema),
    defaultValues: initialData || {
      name: "",
      nameAr: "",
      sku: "",
      categoryId: undefined,
      description: "",
      descriptionAr: "",
      price: 0,
      currency: "USD",
      stock: 0,
      status: "active",
    },
  });

  const createMutation = trpc.products.create.useMutation({
    onSuccess: () => {
      router.push("/ar/products");
      router.refresh();
    },
  });

  const updateMutation = trpc.products.update.useMutation({
    onSuccess: () => {
      router.push("/ar/products");
      router.refresh();
    },
  });

  const onSubmit = (data: z.infer<typeof productSchema>) => {
    if (initialData?.id) {
      updateMutation.mutate({ id: initialData.id, ...data });
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{t("form.name")}</Label>
          <Input {...form.register("name")} />
        </div>
        <div className="space-y-2">
          <Label>{t("form.nameAr")}</Label>
          <Input {...form.register("nameAr")} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{t("form.sku")}</Label>
          <Input {...form.register("sku")} />
        </div>
        <div className="space-y-2">
          <Label>{t("form.categoryId")}</Label>
          <Select
            value={form.watch("categoryId")}
            onValueChange={(val) => form.setValue("categoryId", val)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select Category" />
            </SelectTrigger>
            <SelectContent>
              {categories?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>{t("form.price")}</Label>
          <Input type="number" step="0.01" {...form.register("price")} />
        </div>
        <div className="space-y-2">
          <Label>{t("form.currency")}</Label>
          <Input {...form.register("currency")} />
        </div>
        <div className="space-y-2">
          <Label>{t("form.stock")}</Label>
          <Input type="number" {...form.register("stock")} />
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t("form.status")}</Label>
        <Select
          value={form.watch("status")}
          onValueChange={(val) => form.setValue("status", val)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">{t("status.active")}</SelectItem>
            <SelectItem value="draft">{t("status.draft")}</SelectItem>
            <SelectItem value="archived">{t("status.archived")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>{t("form.description")}</Label>
        <Textarea {...form.register("description")} />
      </div>

      <div className="space-y-2">
        <Label>{t("form.descriptionAr")}</Label>
        <Textarea {...form.register("descriptionAr")} />
      </div>

      <div className="flex gap-4">
        <Button
          type="submit"
          disabled={createMutation.isPending || updateMutation.isPending}
        >
          {t("form.submit")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/ar/products")}
        >
          {t("form.cancel")}
        </Button>
      </div>
    </form>
  );
}
