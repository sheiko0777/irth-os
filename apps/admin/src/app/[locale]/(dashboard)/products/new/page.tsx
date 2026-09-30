import { getTranslations } from "next-intl/server";
import { ProductForm } from "../ProductForm";
import { serverCaller } from "@/server/caller";
import { PageHeader } from "@/components/ui/PageHeader";
import { Box } from "lucide-react";

export default async function NewProductPage() {
    const t = await getTranslations("products");
    const caller = await serverCaller();
    const categoriesResponse = await caller.categories.list();

    return (
        <div className="space-y-6 max-w-2xl">
            <PageHeader eyebrow="المخزون والمنتجات" title={t("create")} icon={<Box />} />
            <ProductForm categories={categoriesResponse.data} />
        </div>
    );
}
