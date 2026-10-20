import { CarbonShell } from "@/components/layout/CarbonShell";
import { ScreenGuard } from "@/components/layout/ScreenGuard";
import { ChatBot } from "@/components/chatbot/ChatBot";
import { CommandPalette } from "@/components/CommandPalette";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { serverCaller } from "@/server/caller";
import "@/styles/carbon.scss";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // An account on a temporary password (PR-1d) sets its own before anything
  // else; the server refuses every other procedure until then. A failed
  // lookup (no session, no membership) falls through to the existing
  // handling — middleware and the procedures themselves.
  let mustChangePassword = false;
  let isSupplier = false;
  let signedOut = false;
  try {
    const me = await (await serverCaller()).me.get();
    mustChangePassword = me.data.mustChangePassword;
    isSupplier = me.data.principalKind === 'supplier';
  } catch (error) {
    mustChangePassword = false;
    signedOut = error instanceof TRPCError && error.code === 'UNAUTHORIZED';
  }
  // No session: leave for /login HERE, before the shell renders. `/[locale]`
  // is a public route in middleware, and the page's own redirect runs inside
  // the loading.tsx Suspense boundary — after this layout has already streamed
  // the top bar ("Overview", search) — so a signed-out visitor saw the
  // dashboard chrome flash before the client-side hop to the login form.
  if (signedOut) redirect(`/${locale}/login`);
  if (mustChangePassword) redirect(`/${locale}/change-password`);
  // A supplier's account belongs to the supplier portal (PR-3), never to
  // this shell. UX only: the procedures behind it refuse them regardless.
  if (isSupplier) redirect(`/${locale}/portal`);

  return (
    <>
      <CarbonShell locale={locale}>
        <ScreenGuard locale={locale}>{children}</ScreenGuard>
      </CarbonShell>
      <ChatBot locale={locale} />
      <CommandPalette locale={locale} />
    </>
  );
}
