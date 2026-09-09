import { eq, and } from 'drizzle-orm';
import { campaigns, campaignRecipients } from './schema/campaigns';
import { customers } from './schema/customers';
import { emitOutboxEvents } from './outbox';
import type { DbTx } from './index';

/**
 * `campaign.targetSegment` ('all'|'vip'|'inactive'|'new'|'custom') has no
 * resolution logic anywhere in this repo for anything but 'all' — it is not
 * the same thing as the freeform `customerSegments`/`customerSegmentMembers`
 * tables (those are user-created, UUID-keyed segments unrelated to this
 * enum). Rather than silently enqueuing zero recipients for a campaign
 * nobody would ever receive, callers must catch this and fail loudly.
 */
export class UnresolvedSegmentError extends Error {
  constructor(public readonly targetSegment: string) {
    super(`No recipient-resolution logic exists yet for target segment '${targetSegment}' — only 'all' is supported. Blocked on building real segment-membership rules.`);
    this.name = 'UnresolvedSegmentError';
  }
}

/**
 * Resolves a campaign's target audience, snapshots one `campaign_recipients`
 * row per resolved customer (so a later segment-membership change can't
 * retroactively change who this specific send reaches), and enqueues an
 * outbox event for every recipient that isn't skipped up front. Called from
 * both `campaigns.send` and the scheduled-campaign cron so they share one
 * implementation.
 */
export async function snapshotAndEnqueueCampaign(tx: DbTx, campaign: { id: string; orgId: string; channel: 'whatsapp' | 'sms' | 'email'; targetSegment: string }): Promise<void> {
  if (campaign.targetSegment !== 'all') {
    throw new UnresolvedSegmentError(campaign.targetSegment);
  }

  const resolvedCustomers = await tx.select({
    id: customers.id,
    marketingConsent: customers.marketingConsent,
  }).from(customers).where(eq(customers.orgId, campaign.orgId));

  let totalRecipients = 0;

  if (resolvedCustomers.length > 0) {
    const recipientRows = resolvedCustomers.map((c) => {
      let status: 'pending' | 'skipped_no_consent' | 'skipped_unsupported_channel' = 'pending';
      if (c.marketingConsent === false) {
        status = 'skipped_no_consent';
      } else if (campaign.channel === 'sms') {
        // No SMS provider client exists anywhere in this repo yet — quarantine
        // rather than fabricate a send.
        status = 'skipped_unsupported_channel';
      }

      return {
        orgId: campaign.orgId,
        campaignId: campaign.id,
        customerId: c.id,
        channel: campaign.channel,
        status,
      };
    });

    const recipients = await tx.insert(campaignRecipients).values(recipientRows).returning({
      id: campaignRecipients.id,
      status: campaignRecipients.status,
    });

    const pendingRecipients = recipients.filter((recipient) => recipient.status === 'pending');

    if (pendingRecipients.length > 0) {
      await emitOutboxEvents(tx, pendingRecipients.map((recipient) => ({
        orgId: campaign.orgId,
        eventType: 'campaign.recipient.send',
        payload: {
          orgId: campaign.orgId,
          recipientId: recipient.id,
        },
      })));
    }

    totalRecipients = pendingRecipients.length;
  }

  await tx.update(campaigns)
    .set({ totalRecipients, updatedAt: new Date() })
    .where(and(eq(campaigns.id, campaign.id), eq(campaigns.orgId, campaign.orgId)));
}
