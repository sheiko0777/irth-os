import { getTranslations } from "next-intl/server";
import { CreateProductForm } from "./CreateProductForm";
import { verifySession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function NewProductPage({ params }: { params: { locale: string } }) {
    const { locale } = await params;
    const session = await verifySession();
    if (!session) redirect(`/${locale}/login`);

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
