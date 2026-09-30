import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { PermissionGate } from "@/components/PermissionGate";
import { CategoriesClient } from "./CategoriesClient";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { FolderOpen } from "lucide-react";

export default async function CategoriesPage() {
    const t = await getTranslations("categories");
    const caller = await serverCaller();

    const categoriesResponse = await caller.categories.list();

    if (categoriesResponse.error) {
        return <ErrorState message={t("errors.loadCategories")} />;
    }

    const { data: categories } = categoriesResponse;

    return (
        <div className="space-y-6">
            <PageHeader
              eyebrow="المخزون والمنتجات"
              title={t("title")}
              icon={<FolderOpen />}
            />
            
            <PermissionGate resource="categories" action="view">
                <CategoriesClient categories={categories} />
            </PermissionGate>
        </div>
    );
}
