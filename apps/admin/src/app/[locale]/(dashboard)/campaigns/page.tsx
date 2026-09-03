import { getTranslations } from 'next-intl/server';
import { serverCaller } from '@/server/caller';
import CampaignsClient, { type Campaign, type CampaignSummary } from './CampaignsClient';

export async function generateMetadata() {
  const t = await getTranslations('campaigns');
  return { title: t('metadata.title') };
}

export default async function CampaignsPage() {
  const t = await getTranslations('campaigns');

  try {
    const caller = await serverCaller();
    const [listRes, summaryRes] = await Promise.all([
      caller.campaigns.list({}),
      caller.campaigns.summary(),
    ]);

    const initialData = (listRes.data ?? []) as Campaign[];
    const summary = (summaryRes.data ?? { total: 0, sent: 0, inProgress: 0, totalDelivered: 0 }) as CampaignSummary;

    return (
      <div className="p-6">
        <CampaignsClient initialData={initialData} summary={summary} />
      </div>
    );
  } catch (error) {
    console.error('Failed to fetch campaigns:', error);
    return (
      <div className="p-8 text-center" style={{ color: 'var(--crimson)' }}>
        {t('errors.loadCampaigns')}
      </div>
    );
  }
}