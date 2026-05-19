"use server";

import { redirect } from "next/navigation";

export async function handleLoginFallback(locale: string) {
  // A fallback redirect if needed. Client handles most logic.
  redirect(`/${locale}/dashboard`);
}
