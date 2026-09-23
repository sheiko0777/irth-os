import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { ProductsClient } from "./ProductsClient";
import { ErrorState } from "@/components/ui/ErrorState";

export default async function ProductsPage() {
    const t = await getTranslations("products");
    const caller = await serverCaller();

    const [productsResponse, categoriesResponse] = await Promise.all([
        caller.products.list({ page: 1, pageSize: 50 }),
        caller.categories.list()
    ]);

    if (productsResponse.error) {
        return <ErrorState message={t("errors.loadProducts")} />;
    }

    if (categoriesResponse.error) {
        return <ErrorState message={t("errors.loadCategories")} />;
    }

    return (
        <ProductsClient 
            products={productsResponse.data} 
            categories={categoriesResponse.data} 
        />
    );
}
