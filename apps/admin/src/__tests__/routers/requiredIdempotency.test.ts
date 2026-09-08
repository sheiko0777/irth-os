import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { giftCardsRouter } from '@/server/routers/giftCards';
import { purchasingRouter } from '@/server/routers/purchasing';
import { customersRouter } from '@/server/routers/customers';
import { mockDb, withOrgMock } from '../helpers/mockDb';

const UUID = '11111111-1111-4111-8111-111111111111';

function dedupingContext() {
  const responses = new Map<string, unknown>();
  let executions = 0;
  const idempotent = vi.fn(async <T>(operation: string, key: string | undefined): Promise<T> => {
    const cacheKey = `${operation}:${key}`;
    if (!responses.has(cacheKey)) {
      executions++;
      responses.set(cacheKey, { data: { operation }, error: null, meta: null });
    }
    return responses.get(cacheKey) as T;
  });
  const context = {
    db: mockDb,
    withOrg: withOrgMock,
    idempotent,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role: 'owner',
  } as unknown as Context;
  return { context, idempotent, executions: () => executions };
}

async function expectBadRequest(value: Promise<unknown>) {
  await expect(value).rejects.toSatisfy(
    (error: unknown) => error instanceof TRPCError && error.code === 'BAD_REQUEST',
  );
}

beforeEach(() => mockDb._reset());

describe('required financial idempotency keys', () => {
  it('rejects all four mutations when the key is missing', async () => {
    const { context } = dedupingContext();
    await expectBadRequest(giftCardsRouter.createCaller(context).topup({ id: UUID, amount: 10 } as never));
    await expectBadRequest(giftCardsRouter.createCaller(context).redeem({ id: UUID, amount: 10 } as never));
    await expectBadRequest(purchasingRouter.createCaller(context).po.receive({ id: UUID, items: [] } as never));
    await expectBadRequest(customersRouter.createCaller(context).addPoints({ id: UUID, points: 10 } as never));
  });

  it.each([
    ['giftCards.topup', (context: Context) => giftCardsRouter.createCaller(context).topup({ id: UUID, amount: 10, idempotencyKey: 'same-key' })],
    ['giftCards.redeem', (context: Context) => giftCardsRouter.createCaller(context).redeem({ id: UUID, amount: 10, idempotencyKey: 'same-key' })],
    ['purchasing.receive', (context: Context) => purchasingRouter.createCaller(context).po.receive({ id: UUID, items: [], idempotencyKey: 'same-key' })],
    ['customers.addPoints', (context: Context) => customersRouter.createCaller(context).addPoints({ id: UUID, points: 10, idempotencyKey: 'same-key' })],
  ])('%s forwards the key and dedupes a retry', async (operation, invoke) => {
    const { context, idempotent, executions } = dedupingContext();
    const first = await invoke(context);
    const retry = await invoke(context);

    expect(retry).toEqual(first);
    expect(executions()).toBe(1);
    expect(idempotent).toHaveBeenCalledTimes(2);
    expect(idempotent).toHaveBeenNthCalledWith(1, operation, 'same-key', expect.any(Object), expect.any(Function));
  });
});
