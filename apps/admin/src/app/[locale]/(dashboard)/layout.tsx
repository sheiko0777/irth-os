import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { ChatBot } from '@/components/chatbot/ChatBot';
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
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header locale={locale} />
        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          {children}
        </main>
      </div>
      <ChatBot locale={locale} />
    </div>
  );
}
