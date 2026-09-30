import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { serverCaller } from "@/server/caller";
import { RolesManager } from "./RolesManager";
import { PageHeader } from "@/components/ui/PageHeader";
import { KeyRound } from "lucide-react";

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
      <PageHeader
        eyebrow="الإعدادات والرقابة"
        title={"الأدوار والصلاحيات"}
        description={"كل دور بيحدد الشاشات والعمليات المتاحة لمن يحمله. أدوار النظام ثابتة، وتقدر تنسخها وتعدّل النسخة."}
        icon={<KeyRound />}
      />
      <RolesManager />
    </div>
  );
}
