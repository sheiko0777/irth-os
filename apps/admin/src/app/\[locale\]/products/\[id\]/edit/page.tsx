import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { EditProductForm } from "./EditProductForm";
import { verifySession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function EditProductPage({ params }: { params: { id: string, locale: string } }) {
    const { id, locale } = await params;
    const session = await verifySession();
    if (!session) redirect(`/${locale}/login`);

    const t = await getTranslations("products");
    const caller = await serverCaller();

    let response;
    try {
        response = await caller.products.getById({ id });
    } catch (e) {
        return <div>Product not found</div>;
    }

    if (response?.error || !response?.data) {
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
