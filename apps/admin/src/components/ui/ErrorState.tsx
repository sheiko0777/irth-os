'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  /** Localised label for the retry button; the Arabic default predates i18n. */
  retryLabel?: string;
}

/**
 * Unified error card with an optional retry action.
 *
 * role="alert" so a screen reader announces the failure instead of the page
 * silently going quiet — a failed load must never read as "nothing here".
 */
export function ErrorState({
  title = 'حدث خطأ',
  message = 'تعذّر تحميل البيانات. حاول مرة أخرى.',
  onRetry,
  retryLabel = 'إعادة المحاولة',
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      data-testid="error-state"
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-[var(--rim1)] bg-[var(--card-bg)] py-12 px-6 text-center"
    >
      <AlertTriangle size={32} aria-hidden className="text-[var(--crimson)]" />
      <h3 className="text-lg font-semibold text-[var(--t1)]">{title}</h3>
      <p className="max-w-prose text-sm text-[var(--t2)]">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2" data-testid="error-retry">
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
