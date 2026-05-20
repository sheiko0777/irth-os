import { getTranslations } from "next-intl/server";
import { ProductForm } from "../../ProductForm";
import { serverCaller } from "@/server/caller";
import { notFound } from "next/navigation";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;
  const t = await getTranslations("products");
  const caller = await serverCaller();

  try {
    const productResponse = await caller.products.getById({
      id: resolvedParams.id,
    });
    const categoriesResponse = await caller.categories.list();

    return (
      <div className="space-y-6 max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">{t("edit")}</h1>
        <ProductForm
          initialData={productResponse.data.product as any}
          categories={categoriesResponse.data}
        />
      </div>
    );
  } catch (e) {
    notFound();
  }
}
