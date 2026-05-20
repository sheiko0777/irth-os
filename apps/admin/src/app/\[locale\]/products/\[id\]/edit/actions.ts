"use server";

import { serverCaller } from "@/server/caller";
import { revalidatePath } from "next/cache";

export async function updateProductAction(data: {
    id: string;
    nameAr: string;
    nameEn: string;
    category: string;
    description?: string;
    isActive: boolean;
}) {
    try {
        const caller = await serverCaller();
        await caller.products.update(data);
        revalidatePath(`/ar/products/${data.id}/edit`);
        revalidatePath(`/ar/products`);
        return { success: true };
    } catch (e) {
        return { error: e instanceof Error ? e.message : "Failed to update product" };
    }
}
