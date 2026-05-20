import {NextIntlClientProvider} from 'next-intl';
import {getMessages} from 'next-intl/server';
import {notFound, redirect} from 'next/navigation';
import {routing} from '@/i18n/routing';
import type { Metadata } from 'next';
import { verifySession } from '@/lib/auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'IRTH OS',
  description: 'IRTH Group Operations OS',
};

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{locale: string}>;
}) {
  const {locale} = await params;

  if (!routing.locales.includes(locale as any)) {
    notFound();
  }

  // CVE-2025-29927 mitigation
  const session = await verifySession();

  const messages = await getMessages();

  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body>
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
