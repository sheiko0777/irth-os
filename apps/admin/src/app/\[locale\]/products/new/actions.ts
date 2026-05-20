"use server";

import { serverCaller } from "@/server/caller";

export async function createProductAction(data: {
    nameAr: string;
    nameEn: string;
    category: string;
    description?: string;
    brand: "irth";
    variants: { sku: string; price: string | number; stock: number; }[];
}) {
    try {
        const caller = await serverCaller();
        await caller.products.create(data);
        return { success: true };
    } catch (e) {
        return { error: e instanceof Error ? e.message : "Failed to create product" };
    }
}
