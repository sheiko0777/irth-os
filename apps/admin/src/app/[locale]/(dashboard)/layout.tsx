import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { ChatBot } from '@/components/chatbot/ChatBot';
import { CommandPalette } from '@/components/CommandPalette';
import { ReactNode } from 'react';

export default async function DashboardLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <div className="flex min-h-screen overflow-hidden bg-[var(--bg)]">
      <div className="hidden md:block"><Sidebar locale={locale} /></div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header locale={locale} />
        <main className="flex-1 overflow-y-auto px-4 pb-24 pt-5 sm:px-5 md:p-8">{children}</main>
      </div>
      <MobileBottomNav locale={locale} />
      <ChatBot locale={locale} />
      <CommandPalette locale={locale} />
    </div>
  );
}
