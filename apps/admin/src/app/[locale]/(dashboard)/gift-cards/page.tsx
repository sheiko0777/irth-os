import { EGP, zero } from '@irth/domain';
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

    const initialData: GiftCard[] = listRes.data ?? [];
    const summary: GiftCardSummary = summaryRes.data ?? {
      total: 0,
      active: 0,
      totalIssued: zero(EGP),
      activeBalance: zero(EGP),
    };

    return (
      <div className="p-6">
        <GiftCardsClient initialData={initialData} summary={summary} />
      </div>
    );
  } catch (error) {
    console.error('Failed to fetch gift cards:', error);
    return (
      <div className="p-8 text-center" style={{ color: 'var(--crimson)' }}>
        حدث خطأ في تحميل بطاقات الهدايا
      </div>
    );
  }
}
