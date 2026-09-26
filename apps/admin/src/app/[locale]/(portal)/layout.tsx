import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { serverCaller } from "@/server/caller";
import { PortalHeader } from "./PortalHeader";

/**
 * بوابة المورد (PR-3): a separate, simple shell — no sidebar, no assistant,
 * nothing of the back office. Only supplier accounts belong here; anyone else
 * goes back to the dashboard. UX only: the portal procedures refuse anyone
 * who is not a supplier with exactly one supplier in scope.
 */
export default async function PortalLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  let target: string | null = null;
  let supplierName = "";
  try {
    const caller = await serverCaller();
    const me = await caller.me.get();
    if (me.data.mustChangePassword) target = `/${locale}/change-password`;
    else if (me.data.principalKind !== "supplier") target = `/${locale}`;
    else supplierName = (await caller.portal.me()).data.name;
  } catch {
    target = `/${locale}/login`;
  }
  if (target) redirect(target);

  return (
    <div className="min-h-dvh bg-[var(--canvas,var(--surface))]">
      <PortalHeader locale={locale} supplierName={supplierName} />
      <main id="portal-main" className="mx-auto max-w-4xl space-y-6 p-4">{children}</main>
    </div>
  );
}
