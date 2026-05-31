import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { PermissionGate } from "@/components/PermissionGate";
import { CategoriesClient } from "./CategoriesClient";

export default async function CategoriesPage() {
    const t = await getTranslations("categories");
    const caller = await serverCaller();

    const categoriesResponse = await caller.categories.list();

    if (categoriesResponse.error) {
        return <div>Error loading categories</div>;
    }

    const { data: categories } = categoriesResponse;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-3xl font-bold tracking-tight font-cairo">{t("title")}</h1>
            </div>
            
            <PermissionGate resource="categories" action="read">
                {/* @ts-expect-error Data structure matches */}
                <CategoriesClient categories={categories} />
            </PermissionGate>
        </div>
    );
}
