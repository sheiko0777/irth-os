import { getTranslations } from "next-intl/server";
import { CreateProductForm } from "./CreateProductForm";

export default async function NewProductPage() {
    const t = await getTranslations("products");

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">{t("create")}</h1>
            <div className="max-w-3xl">
                <CreateProductForm />
            </div>
        </div>
    );
}
