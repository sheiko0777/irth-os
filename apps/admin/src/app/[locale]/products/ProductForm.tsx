"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
  categoryId: z.string().uuid().optional().or(z.literal("")),
  description: z.string().optional(),
  descriptionAr: z.string().optional(),
  price: z.union([z.number().min(0), z.string()]),
  currency: z.string(),
  stock: z.union([z.number().min(0), z.string()]),
  status: z.string(),
});

type FormValues = z.infer<typeof productSchema>;

import { useParams } from "next/navigation";

export function ProductForm({
  initialData,
  categories,
}: {
  initialData?: FormValues & { id?: string };
  categories?: { id: string; name: string }[];
}) {
  const t = useTranslations("products");
  const router = useRouter();
  const params = useParams();
  const locale = params.locale as string;

  const form = useForm<FormValues>({
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
      router.push(`/${locale}/products`);
      router.refresh();
    },
  });

  const updateMutation = trpc.products.update.useMutation({
    onSuccess: () => {
      router.push(`/${locale}/products`);
      router.refresh();
    },
  });

  const onSubmit = (data: FormValues) => {
    const payload = {
      ...data,
      categoryId: data.categoryId || undefined,
      price: Number(data.price),
      stock: Number(data.stock),
    };

    if (initialData?.id) {
      updateMutation.mutate({ id: initialData.id, ...payload });
    } else {
      createMutation.mutate(payload);
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
          onClick={() => router.push(`/${locale}/products`)}
        >
          {t("form.cancel")}
        </Button>
      </div>
    </form>
  );
}
