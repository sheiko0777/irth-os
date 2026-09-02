import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { ChatBot } from '@/components/chatbot/ChatBot';
import { CommandPalette } from '@/components/CommandPalette';
import { ReactNode } from 'react';

export default async function DashboardLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar locale={locale} />
      {/* `me-16` reserves room for the always-visible collapsed rail below
          `lg` (Sidebar is `fixed` there, out of flow) -- at `lg`+ Sidebar is
          `static` and flexbox already reserves its space, so the gutter
          would double-count and is turned off. When the rail expands it
          overlays past this gutter with its own scrim rather than pushing
          further, so no JS state needs to reach this layout. */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden me-16 lg:me-0">
        <Header locale={locale} />
        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          {children}
        </main>
      </div>
      <ChatBot locale={locale} />
      <CommandPalette locale={locale} />
    </div>
  );
}
