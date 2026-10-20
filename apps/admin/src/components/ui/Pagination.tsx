'use client';

import { ChevronRight, ChevronLeft } from 'lucide-react';
import { formatNumber } from '@irth/domain';
import { Button } from '@/components/ui/button';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

/**
 * RTL-aware pagination control. Digits via the shared formatNumber (Western).
 * In RTL, "previous" sits on the right (ChevronRight) and "next" on the left.
 */
export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div
      className="flex items-center justify-between gap-4 py-3 text-sm text-[var(--t2)]"
    >
      <span className="tabular-nums">
        عرض <bdi dir="ltr">{formatNumber(from)}–{formatNumber(to)}</bdi> من{' '}
        {formatNumber(total)}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronRight size={16} />
          السابق
        </Button>
        <span className="text-[var(--t1)] tabular-nums">
          صفحة {formatNumber(page)} من {formatNumber(totalPages)}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          التالي
          <ChevronLeft size={16} />
        </Button>
      </div>
    </div>
  );
}
