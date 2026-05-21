"use server";

import { serverCaller } from "@/server/caller";

export async function createProductAction(data: unknown) {
  try {
    const caller = await serverCaller();
    await caller.products.create(
      data as Parameters<typeof caller.products.create>[0],
    );
    return { success: true };
  } catch (e: unknown) {
    return {
      error: e instanceof Error ? e.message : "Failed to create product",
    };
  }
}
