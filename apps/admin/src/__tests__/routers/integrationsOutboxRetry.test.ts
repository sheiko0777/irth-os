import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { TRPCError } from '@trpc/server';
import { outboxEvents } from '@irth/db';
import type { Context } from '@/server/trpc';
import { integrationsRouter } from '@/server/routers/integrations';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

const EVENT_ID = '00000000-0000-4000-8000-000000000001';

function ctx(role: 'owner' | 'admin' | 'member' = 'owner'): Context {
  return {
    db: mockDb,
    withOrg: withOrgMock,
    idempotent: idempotentMock,
    session: {
      user: { id: 'user-1', email: 'u@test.com' },
      session: { activeOrganizationId: 'org-1' },
    },
    orgId: 'org-1',
    userId: 'user-1',
    role,
  } as unknown as Context;
}

function chainOf(value: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ['set', 'where', 'returning'];
  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown) => void) =>
    Promise.resolve(value).then(resolve);
  return chain;
}

function containsReference(
  value: unknown,
  needle: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (Object.is(value, needle)) return true;
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;

  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (
      containsReference(
        (value as Record<PropertyKey, unknown>)[key],
        needle,
        seen,
      )
    ) {
      return true;
    }
  }
  return false;
}

async function expectTRPCCode(
  promise: Promise<unknown>,
  code: TRPCError['code'],
) {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof TRPCError && error.code === code,
  );
}

beforeEach(() => {
  mockDb._reset();
});

describe('integrations retryOutboxEvent', () => {
  it('resets attempts and lastError for a matching event in the caller org', async () => {
    const chain = chainOf([{ id: EVENT_ID }]);
    mockDb.update = vi.fn(() => chain);

    const res = await integrationsRouter
      .createCaller(ctx('admin'))
      .retryOutboxEvent({ eventId: EVENT_ID });

    expect(res).toEqual({
      data: { eventId: EVENT_ID },
      error: null,
      meta: null,
    });
    expect(mockDb.update).toHaveBeenCalledWith(outboxEvents);
    expect(chain.set as Mock).toHaveBeenCalledWith({
      attempts: 0,
      lastError: null,
    });
    expect(chain.returning as Mock).toHaveBeenCalledWith({
      id: outboxEvents.id,
    });

    const whereCondition = (chain.where as Mock).mock.calls[0]?.[0];
    expect(containsReference(whereCondition, outboxEvents.id)).toBe(true);
    expect(containsReference(whereCondition, outboxEvents.orgId)).toBe(true);
  });

  it('throws when the event id does not match a row in the caller org', async () => {
    const chain = chainOf([]);
    mockDb.update = vi.fn(() => chain);

    await expectTRPCCode(
      integrationsRouter
        .createCaller(ctx('owner'))
        .retryOutboxEvent({ eventId: EVENT_ID }),
      'NOT_FOUND',
    );
  });

  it('blocks members before the retry write runs', async () => {
    await expectTRPCCode(
      integrationsRouter
        .createCaller(ctx('member'))
        .retryOutboxEvent({ eventId: EVENT_ID }),
      'FORBIDDEN',
    );

    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
