import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { WarehouseLotsClient } from './WarehouseLotsClient';

export default async function WarehouseLotsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const arabic = locale === 'ar';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--t1)]">{arabic ? 'المخازن والتشغيلات' : 'Warehouses & lots'}</h1>
          <p className="mt-1 text-sm text-[var(--t3)]">{arabic ? 'استلام وتشغيل المخزون مع تتبع الصلاحية.' : 'Receive stock and track batches with expiry dates.'}</p>
        </div>
        <Link href={`/${locale}/inventory`} className="inline-flex items-center gap-2 text-sm font-medium text-[var(--t2)] hover:text-[var(--t1)]">
          <ArrowRight size={16} />
          {arabic ? 'الرصيد العام' : 'General inventory'}
        </Link>
      </div>
      <WarehouseLotsClient locale={locale} />
    </div>
  );
}
