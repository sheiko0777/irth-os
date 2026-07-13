import { serverCaller } from '@/server/caller';
import GiftCardsClient, { type GiftCard, type GiftCardSummary } from './GiftCardsClient';

export const metadata = { title: 'بطاقات الهدايا | IRTH' };

export default async function GiftCardsPage() {
  try {
    const caller = await serverCaller();
    const [listRes, summaryRes] = await Promise.all([
      caller.giftCards.list({}),
      caller.giftCards.summary(),
    ]);

    const initialData = (listRes.data ?? []) as GiftCard[];
    const summary = (summaryRes.data ?? { total: 0, active: 0, totalIssued: 0, activeBalance: 0 }) as GiftCardSummary;

    return (
      <div dir="rtl" className="p-6">
        <GiftCardsClient initialData={initialData} summary={summary} />
      </div>
    );
  } catch (error) {
    console.error('Failed to fetch gift cards:', error);
    return (
      <div dir="rtl" className="font-cairo p-8 text-center" style={{ color: 'var(--crimson)' }}>
        حدث خطأ في تحميل بطاقات الهدايا
      </div>
    );
  }
}
