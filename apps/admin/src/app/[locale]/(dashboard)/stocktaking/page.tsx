import { serverCaller } from '@/server/caller';
import { StocktakingClient, type StocktakingSession, type StocktakingSummary } from './StocktakingClient';

export const metadata = { title: 'جرد المخزون | IRTH' };

export default async function StocktakingPage() {
  const caller = await serverCaller();
  const [sessionsRes, summaryRes] = await Promise.all([
    caller.stocktaking.sessions.list({}),
    caller.stocktaking.summary(),
  ]);

  if (sessionsRes.error || summaryRes.error) {
    return (
      <div className="p-8 text-[var(--crimson)]">
        حدث خطأ في تحميل بيانات الجرد
      </div>
    );
  }

  const sessions = sessionsRes.data as unknown as StocktakingSession[];
  const summary = summaryRes.data as unknown as StocktakingSummary;

  return (
    <div className="p-6">
      <StocktakingClient sessions={sessions} summary={summary} />
    </div>
  );
}