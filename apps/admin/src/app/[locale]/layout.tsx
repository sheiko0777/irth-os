import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { IBM_Plex_Sans_Arabic, Cairo } from 'next/font/google';
import { ReactNode } from 'react';
import './globals.css';

const ibmPlexSansArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-sans-arabic',
  display: 'swap',
});

const cairo = Cairo({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-cairo',
  display: 'swap',
});

export default async function LocaleLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  
  // Re-verify session in Server Component (CVE-2025-29927 mitigation)
  const headersList = await headers();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  
  let sessionData = null;
  try {
      const sessionRes = await fetch(`${appUrl}/api/auth/get-session`, {
          headers: {
              cookie: headersList.get("cookie") || "",
              "x-forwarded-host": headersList.get("x-forwarded-host") || headersList.get("host") || "",
          },
      });
      if (sessionRes.ok) {
          sessionData = await sessionRes.json();
      }
  } catch (e) {
      console.error("Failed to check session in layout", e);
  }

  const messages = await getMessages();

  // Exclude login page from redirecting
  const pathname = headersList.get("x-invoke-path") || "";
  const isLogin = pathname.includes("/login");

  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className={`${ibmPlexSansArabic.variable} ${cairo.variable}`}>
      <body className="bg-[var(--ink)] text-[var(--t2)] font-sans antialiased">
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
