import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context } from '@/server/trpc';
import { integrationsRouter } from '@/server/routers/integrations';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

const EVENT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function ctx(role: 'owner' | 'admin' | 'member' = 'owner'): Context {
  return {
    db: mockDb,
    withOrg: withOrgMock,
    idempotent: idempotentMock,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role,
  } as unknown as Context;
}

function chainOf(value: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'from', 'where', 'orderBy', 'limit', 'offset', 'leftJoin', 'innerJoin', 'groupBy', 'returning', 'values', 'set', 'onConflictDoUpdate'];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(value).then(resolve);
  return chain;
}

beforeEach(() => {
  mockDb._reset();
});

describe('integrations router', () => {
  const caller = integrationsRouter.createCaller(ctx('owner'));

  it('outboxList: yields empty array when db is empty', async () => {
    mockDb.select = vi.fn(() => chainOf([]));
    const res = await caller.outboxList({});
    expect(res).toEqual({ data: [], error: null, meta: null });
  });

  it('outboxList: handles showProcessed flag gracefully', async () => {
    mockDb.select = vi.fn(() => chainOf([{ id: 'ev1' }]));
    const res = await caller.outboxList({ showProcessed: true });
    expect(res).toEqual({ data: [{ id: 'ev1' }], error: null, meta: null });
  });
});

function retryContext(eventBelongsToOrg: boolean) {
  const updated = eventBelongsToOrg ? [{
    id: EVENT_ID, orgId: 'org-1', processed: false, attempts: 0,
    nextRetryAt: null, lastError: null, claimedAt: null,
  }] : [];
  const set = vi.fn();
  const auditValues = vi.fn();
  const tx = {
    update: vi.fn(() => {
      const chain = {
        set: (values: Record<string, unknown>) => {
          set(values);
          return chain;
        },
        where: () => chain,
        returning: async () => updated,
      };
      return chain;
    }),
    insert: vi.fn(() => ({ values: async (values: Record<string, unknown>) => auditValues(values) })),
    rollback: vi.fn(),
  };
  const ctx = {
    db: {},
    withOrg: (callback: (transaction: typeof tx) => unknown) => callback(tx),
    session: { user: { id: 'admin-1', email: 'admin@test.com' }, session: {} },
    orgId: 'org-1', userId: 'admin-1', role: 'admin',
  } as unknown as Context;
  return { ctx, set, auditValues };
}

describe('integrations.outboxRetry', () => {
  it('resets retry eligibility and writes an audit entry for the acting admin', async () => {
    const { ctx: retryCtx, set, auditValues } = retryContext(true);
    await integrationsRouter.createCaller(retryCtx).outboxRetry({ id: EVENT_ID });

    expect(set).toHaveBeenCalledWith({ attempts: 0, lastError: null, nextRetryAt: null, claimedAt: null });
    expect(auditValues).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1', userId: 'admin-1', action: 'RETRY_OUTBOX_EVENT', tableName: 'outbox_events',
    }));
  });

  it('does not retry or audit an event outside the caller org', async () => {
    const { ctx: retryCtx, auditValues } = retryContext(false);
    await expect(integrationsRouter.createCaller(retryCtx).outboxRetry({ id: EVENT_ID }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(auditValues).not.toHaveBeenCalled();
  });
});
