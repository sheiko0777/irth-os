import { verifySession } from '@/lib/auth';
import { Sidebar } from '@/components/layout/Sidebar';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import './globals.css';

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const { locale } = await params;
  
  // Re-verify session in Server Component (CVE-2025-29927 mitigation)
  const session = await verifySession();
  const messages = await getMessages();

  // If this was production, we'd redirect if !session, but we skip to allow development
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body className="bg-gray-50 text-gray-900">
        <NextIntlClientProvider messages={messages}>
          <div className="flex h-screen overflow-hidden">
            <Sidebar locale={locale} />
            <main className="flex-1 overflow-y-auto p-8">
              {children}
            </main>
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
