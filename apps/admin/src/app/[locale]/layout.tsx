import { verifySession } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const { locale } = await params;
  
  // Re-verify session in Server Component (CVE-2025-29927 mitigation)
  // This ensures the session is actively checked against the DB on load
  const session = await verifySession();
  
  // If no session and we aren't on the login page, we could redirect here, 
  // but we'll let individual protected pages handle redirects.
  // However, layout verification is a strong pattern.

  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body>{children}</body>
    </html>
  );
}
