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
  // We do not do a blanket redirect here because we want the /login page to be accessible,
  // but we enforce this check on all actual admin pages (orders, products, dashboard).
  const session = await verifySession();
  const messages = await getMessages();

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
