"use server";

import { serverCaller } from "@/server/caller";
import { revalidatePath } from "next/cache";

export async function saveSettingsAction(settings: { key: string; value: string }[]) {
  try {
    const caller = await serverCaller();
    const result = await caller.settings.setMany(settings);

    if (result.error) {
      return { success: false, error: "Failed to save settings" };
    }

    revalidatePath('/[locale]/(dashboard)/settings', 'page');
    return { success: true };
  } catch (error) {
    console.error("Error saving settings:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}
