'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ui/ErrorState';

/**
 * Route-level boundary for every dashboard page.
 *
 * Before this existed, a router that threw (database down, permission
 * middleware, a bug) fell through to Next's bare default error page with no
 * way back. Here the shell stays mounted, the owner sees in their language that
 * the load failed — not that there is nothing — and can retry in place.
 *
 * `reset()` alone re-renders the client tree; `router.refresh()` is what
 * re-runs the server component that actually failed.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common.error');
  const router = useRouter();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title={t('title')}
      message={t('hint')}
      retryLabel={t('retry')}
      onRetry={() => {
        router.refresh();
        reset();
      }}
    />
  );
}
