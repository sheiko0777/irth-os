import { serverCaller } from '@/server/caller';
import CustomerSegmentsClient, { type CustomerSegment } from './CustomerSegmentsClient';

export const metadata = { title: 'شرائح العملاء | IRTH' };

export default async function CustomerSegmentsPage() {
  try {
    const caller = await serverCaller();
    const res = await caller.customerSegments.list({});
    const initialSegments = (res.data ?? []) as unknown as CustomerSegment[];

    return (
      <div dir="rtl">
        <CustomerSegmentsClient initialSegments={initialSegments} />
      </div>
    );
  } catch (error) {
    console.error('Failed to fetch customer segments:', error);
    return (
      <div dir="rtl" className="font-cairo p-8 text-center" style={{ color: 'var(--crimson)' }}>
        حدث خطأ في تحميل شرائح العملاء
      </div>
    );
  }
}
