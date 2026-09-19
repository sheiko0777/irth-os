import { CarbonShell } from '@/components/layout/CarbonShell';
import { ChatBot } from '@/components/chatbot/ChatBot';
import { CommandPalette } from '@/components/CommandPalette';
import type { ReactNode } from 'react';
import '@/styles/carbon.scss';

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <>
      <CarbonShell locale={locale}>{children}</CarbonShell>
      <ChatBot locale={locale} />
      <CommandPalette locale={locale} />
    </>
  );
}
