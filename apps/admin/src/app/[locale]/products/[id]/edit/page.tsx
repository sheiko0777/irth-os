import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { EditProductForm } from "./EditProductForm";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const t = await getTranslations("products");
    const caller = await serverCaller();

    const response = await caller.products.getById({ id });

    if (response.error || !response.data) {
        return <div>Product not found</div>;
    }

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">{t("edit")}</h1>
            <div className="max-w-3xl">
                <EditProductForm product={response.data.product} />
            </div>
        </div>
    );
}
