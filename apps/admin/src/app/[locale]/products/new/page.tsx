import { getTranslations } from "next-intl/server";
import { ProductForm } from "../ProductForm";
import { serverCaller } from "@/server/caller";

export default async function NewProductPage() {
    const t = await getTranslations("products");
    const caller = await serverCaller();
    const categoriesResponse = await caller.categories.list();

    return (
        <div className="space-y-6 max-w-2xl">
            <h1 className="text-3xl font-bold tracking-tight">{t("create")}</h1>
            <ProductForm categories={categoriesResponse.data} />
        </div>
    );
}
