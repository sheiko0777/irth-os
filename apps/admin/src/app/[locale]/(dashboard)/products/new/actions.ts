"use server";

import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";

export async function createProductAction(data: unknown) {
    try {
        const caller = await serverCaller();
        await caller.products.create(data as Parameters<typeof caller.products.create>[0]);
        return { success: true };
    } catch (e: unknown) {
        const t = await getTranslations("products");
        return { error: e instanceof Error ? e.message : t("errors.createProduct") };
    }
}
