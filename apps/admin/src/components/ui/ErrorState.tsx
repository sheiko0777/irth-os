'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

/** Unified error card with an optional retry action. */
export function ErrorState({
  title = 'حدث خطأ',
  message = 'تعذّر تحميل البيانات. حاول مرة أخرى.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-[var(--rim1)] bg-[var(--card-bg)] py-12 px-6 text-center"
    >
      <AlertTriangle size={32} className="text-[var(--crimson)]" />
      <h3 className="text-lg font-semibold text-[var(--t1)]">{title}</h3>
      <p className="text-sm text-[var(--t2)]">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
          إعادة المحاولة
        </Button>
      )}
    </div>
  );
}
