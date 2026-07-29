'use client';

import { ChevronRight, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

/**
 * RTL-aware pagination control. Arabic numerals via toLocaleString('ar-EG').
 * In RTL, "previous" sits on the right (ChevronRight) and "next" on the left.
 */
export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div
      className="flex items-center justify-between gap-4 py-3 font-cairo text-sm text-[var(--t2)]"
    >
      <span>
        عرض {from.toLocaleString('ar-EG')}–{to.toLocaleString('ar-EG')} من{' '}
        {total.toLocaleString('ar-EG')}
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
        <span className="text-[var(--t1)]">
          صفحة {page.toLocaleString('ar-EG')} من {totalPages.toLocaleString('ar-EG')}
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
