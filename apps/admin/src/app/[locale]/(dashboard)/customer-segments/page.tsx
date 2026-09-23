import { serverCaller } from '@/server/caller';
import CustomerSegmentsClient, { type CustomerSegment } from './CustomerSegmentsClient';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata() {
  const t = await getTranslations('customerSegments');
  return { title: t('metadata.title') };
}

export default async function CustomerSegmentsPage() {
  const t = await getTranslations('customerSegments');

  try {
    const caller = await serverCaller();
    const res = await caller.customerSegments.list({});
    const initialSegments = (res.data ?? []) as unknown as CustomerSegment[];

    return (
      <div>
        <CustomerSegmentsClient initialSegments={initialSegments} />
      </div>
    );
  } catch (error) {
    console.error('Failed to fetch customer segments:', error);
    return (
      <div className="p-8 text-center" style={{ color: 'var(--crimson)' }}>
        {t('errors.loadSegments')}
      </div>
    );
  }
}
