import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { serverCaller } from "@/server/caller";
import { RolesManager } from "./RolesManager";

/**
 * الأدوار والصلاحيات (PR-1c). The server procedures are the real gate; this
 * page only refuses to render for someone who cannot read roles, so a direct
 * link shows "not found" instead of an empty shell.
 */
export default async function RolesPage() {
  const caller = await serverCaller();
  try {
    await caller.roles.list();
  } catch (err) {
    if (err instanceof TRPCError && err.code === "FORBIDDEN") notFound();
    throw err;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">الأدوار والصلاحيات</h1>
        <p className="mt-1 text-sm text-[var(--t3)]">
          كل دور بيحدد الشاشات والعمليات المتاحة لمن يحمله. أدوار النظام ثابتة، وتقدر تنسخها وتعدّل النسخة.
        </p>
      </div>
      <RolesManager />
    </div>
  );
}
