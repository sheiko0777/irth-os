import { getTranslations } from 'next-intl/server';
import { serverCaller } from '@/server/caller';
import { ShopifyConnectionCard } from './ShopifyConnectionCard';
import { OutboxEventsTable, type OutboxEvent } from './OutboxEventsTable';

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ shopify?: string }>;
}) {
  const { shopify } = await searchParams;
  const t = await getTranslations('integrations');
  const trpc = await serverCaller();
  const response = await trpc.integrations.outboxList({ showProcessed: false });
  const events = (response.data || []) as OutboxEvent[];

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-3xl font-bold text-[var(--gold)]">{t('title')}</h1>

      <ShopifyConnectionCard callbackStatus={shopify} />
      <OutboxEventsTable initialEvents={events} />
    </div>
  );
}
