'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Pagination } from './Pagination';

interface PaginationNavProps {
  page: number;
  pageSize: number;
  total: number;
}

export function PaginationNav({ page, pageSize, total }: PaginationNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(newPage));
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <Pagination
      page={page}
      pageSize={pageSize}
      total={total}
      onPageChange={handlePageChange}
    />
  );
}
