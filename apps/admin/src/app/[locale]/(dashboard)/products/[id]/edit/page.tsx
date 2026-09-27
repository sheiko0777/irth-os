import { getTranslations } from "next-intl/server";
import { ProductForm } from "../../ProductForm";
import { serverCaller } from "@/server/caller";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Box } from "lucide-react";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
    const resolvedParams = await params;
    const t = await getTranslations("products");
    const caller = await serverCaller();
    
    try {
        const productResponse = await caller.products.getById({ id: resolvedParams.id });
        const categoriesResponse = await caller.categories.list();
        
        return (
            <div className="space-y-6 max-w-2xl">
                <PageHeader eyebrow="المخزون والمنتجات" title={t("edit")} icon={<Box />} />
                <ProductForm initialData={productResponse.data.product as never} categories={categoriesResponse.data} />
            </div>
        );
    } catch (e) {
        notFound();
    }
}
