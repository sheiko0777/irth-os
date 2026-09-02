import { getTranslations } from 'next-intl/server';
import { IntelligenceClient, type IntelligenceCopy } from './IntelligenceClient';

export default async function IntelligencePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('intelligence');

  const copy: IntelligenceCopy = {
    title: t('title'),
    subtitle: t('subtitle'),
    placeholder: t('placeholder'),
    send: t('send'),
    thinking: t('thinking'),
    error: t('error'),
    emptyTitle: t('emptyTitle'),
    emptyHint: t('emptyHint'),
    examples: [t('examples.inventory'), t('examples.orders'), t('examples.sales')],
    labels: {
      sku: t('labels.sku'),
      status: t('labels.status'),
      total: t('labels.total'),
      quantity: t('labels.quantity'),
      reorderPoint: t('labels.reorderPoint'),
      state: t('labels.state'),
      out: t('labels.out'),
      low: t('labels.low'),
      ok: t('labels.ok'),
    },
  };

  return <IntelligenceClient locale={locale === 'en' ? 'en' : 'ar'} copy={copy} />;
}
