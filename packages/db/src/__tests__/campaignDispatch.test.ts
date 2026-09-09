import { describe, expect, it, vi } from 'vitest';
import { snapshotAndEnqueueCampaign } from '../campaignDispatch';
import { campaigns, campaignRecipients } from '../schema/campaigns';
import { outboxEvents } from '../schema/outbox';
import type { DbTx } from '../index';

type RecipientStatus = 'pending' | 'skipped_no_consent' | 'skipped_unsupported_channel';

function transactionDouble(
  resolvedCustomers: Array<{ id: string; marketingConsent: boolean | null }>,
  returnedRecipients: Array<{ id: string; status: RecipientStatus }>,
) {
  const recipientValues = vi.fn(() => ({
    returning: vi.fn(() => Promise.resolve(returnedRecipients)),
  }));
  const outboxValues = vi.fn(() => Promise.resolve());
  const insert = vi.fn((table: unknown) => ({
    values: table === campaignRecipients ? recipientValues : outboxValues,
  }));
  const campaignSet = vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) }));
  const update = vi.fn((table: unknown) => {
    expect(table).toBe(campaigns);
    return { set: campaignSet };
  });
  const select = vi.fn(() => ({
    from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(resolvedCustomers)) })),
  }));

  return {
    tx: { select, insert, update, rollback: vi.fn() } as unknown as DbTx,
    insert,
    recipientValues,
    outboxValues,
    campaignSet,
  };
}

describe('snapshotAndEnqueueCampaign', () => {
  it('batches recipients and outbox events while preserving each customer status', async () => {
    const db = transactionDouble(
      [
        { id: 'customer-pending-1', marketingConsent: true },
        { id: 'customer-skipped', marketingConsent: false },
        { id: 'customer-pending-2', marketingConsent: null },
      ],
      // Keep the returned rows in the same order as the VALUES input and avoid
      // grouping pending rows, so event selection cannot be a count/slice.
      [
        { id: 'recipient-pending-1', status: 'pending' },
        { id: 'recipient-skipped', status: 'skipped_no_consent' },
        { id: 'recipient-pending-2', status: 'pending' },
      ],
    );

    await snapshotAndEnqueueCampaign(db.tx, {
      id: 'campaign-1',
      orgId: 'org-1',
      channel: 'whatsapp',
      targetSegment: 'all',
    });

    expect(db.recipientValues).toHaveBeenCalledTimes(1);
    expect(db.recipientValues).toHaveBeenCalledWith([
      expect.objectContaining({ customerId: 'customer-pending-1', status: 'pending' }),
      expect.objectContaining({ customerId: 'customer-skipped', status: 'skipped_no_consent' }),
      expect.objectContaining({ customerId: 'customer-pending-2', status: 'pending' }),
    ]);
    expect(db.outboxValues).toHaveBeenCalledTimes(1);
    expect(db.outboxValues).toHaveBeenCalledWith([
      expect.objectContaining({ payload: JSON.stringify({ orgId: 'org-1', recipientId: 'recipient-pending-1' }) }),
      expect.objectContaining({ payload: JSON.stringify({ orgId: 'org-1', recipientId: 'recipient-pending-2' }) }),
    ]);
    expect(db.campaignSet).toHaveBeenCalledWith(expect.objectContaining({ totalRecipients: 2 }));
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(db.insert.mock.calls.map(([table]) => table)).toEqual([campaignRecipients, outboxEvents]);
  });

  it('does not call either insert for zero resolved customers', async () => {
    const db = transactionDouble([], []);

    await expect(snapshotAndEnqueueCampaign(db.tx, {
      id: 'campaign-empty',
      orgId: 'org-1',
      channel: 'email',
      targetSegment: 'all',
    })).resolves.toBeUndefined();

    expect(db.insert).not.toHaveBeenCalled();
    expect(db.recipientValues).not.toHaveBeenCalled();
    expect(db.outboxValues).not.toHaveBeenCalled();
    expect(db.campaignSet).toHaveBeenCalledWith(expect.objectContaining({ totalRecipients: 0 }));
  });

  it('batches consenting SMS customers as unsupported without an outbox insert', async () => {
    const db = transactionDouble(
      [
        { id: 'customer-no-consent', marketingConsent: false },
        { id: 'customer-unsupported', marketingConsent: true },
      ],
      [
        { id: 'recipient-no-consent', status: 'skipped_no_consent' },
        { id: 'recipient-unsupported', status: 'skipped_unsupported_channel' },
      ],
    );

    await snapshotAndEnqueueCampaign(db.tx, {
      id: 'campaign-sms',
      orgId: 'org-1',
      channel: 'sms',
      targetSegment: 'all',
    });

    expect(db.recipientValues).toHaveBeenCalledTimes(1);
    expect(db.recipientValues).toHaveBeenCalledWith([
      expect.objectContaining({ customerId: 'customer-no-consent', status: 'skipped_no_consent' }),
      expect.objectContaining({ customerId: 'customer-unsupported', status: 'skipped_unsupported_channel' }),
    ]);
    expect(db.outboxValues).not.toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.campaignSet).toHaveBeenCalledWith(expect.objectContaining({ totalRecipients: 0 }));
  });
});
