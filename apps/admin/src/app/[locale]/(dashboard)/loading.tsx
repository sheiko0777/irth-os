import { getTranslations } from 'next-intl/server';

/**
 * Shown while a dashboard page's server component is still fetching, so a
 * slow query reads as "loading" instead of a frozen previous page.
 */
export default async function DashboardLoading() {
  const t = await getTranslations('common');

  return (
    <div role="status" aria-busy="true" data-testid="page-loading" className="space-y-4">
      <span className="sr-only">{t('loading')}</span>
      <div className="h-8 w-48 animate-pulse rounded-md bg-[var(--rim1)] motion-reduce:animate-none" />
      <div className="h-64 animate-pulse rounded-xl bg-[var(--rim1)] motion-reduce:animate-none" />
    </div>
  );
}
