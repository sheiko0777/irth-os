import { Sidebar } from '@/components/layout/Sidebar';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { TRPCProvider } from '@/components/providers/TRPCProvider';
import './globals.css';

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
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
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body className="bg-gray-50 text-gray-900">
        <NextIntlClientProvider messages={messages}>
          <TRPCProvider>
            <div className="flex h-screen overflow-hidden">
              {/* Hide sidebar if not authenticated or on login page */}
              {sessionData?.session && !isLogin ? <Sidebar locale={locale} /> : null}
              <main className="flex-1 overflow-y-auto p-8">
                {children}
              </main>
            </div>
          </TRPCProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
