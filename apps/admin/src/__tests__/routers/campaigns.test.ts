import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { mockDb } from '../helpers/mockDb';

const { campaignsRouter } = await import('@/server/routers/campaigns');

function ctx(role: 'owner' | 'admin' | 'member' = 'owner'): Context {
  return {
    db: mockDb,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role,
  } as unknown as Context;
}

function chainOf(value: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'orderBy', 'limit', 'offset', 'leftJoin', 'innerJoin', 'groupBy', 'returning', 'values', 'set', 'onConflictDoUpdate']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(value).then(resolve);
  return chain;
}

const UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const forbidden = (e: unknown) => e instanceof TRPCError && e.code === 'FORBIDDEN';

async function expectCode(p: Promise<unknown>, code: TRPCError['code']) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === code);
}

beforeEach(() => {
  mockDb._reset();
});

describe('campaigns', () => {
  it('list resolves with an array', async () => {
    const res = await campaignsRouter.createCaller(ctx()).list({});
    expect(Array.isArray(res.data)).toBe(true);
  });

  it('create rejects an invalid channel', async () => {
    await expectCode(
      campaignsRouter.createCaller(ctx()).create({ name: 'x', channel: 'pigeon', targetSegment: 'all', message: 'hi' } as never),
      'BAD_REQUEST'
    );
  });

  it('create rejects an empty message', async () => {
    await expectCode(
      campaignsRouter.createCaller(ctx()).create({ name: 'x', channel: 'whatsapp', targetSegment: 'all', message: '' } as never),
      'BAD_REQUEST'
    );
  });

  it('send transitions under the status guard without pre-reading', async () => {
    // The draft/scheduled check lives in the UPDATE's WHERE clause. A SELECT
    // before the UPDATE would mean check-then-update is back, which lets two
    // concurrent sends both transition and blast customers twice.
    const selectSpy = vi.fn(() => chainOf([]));
    mockDb.select = selectSpy;
    mockDb.update = vi.fn(() => chainOf([{ id: UUID, status: 'sending' }]));

    const res = await campaignsRouter.createCaller(ctx()).send({ id: UUID });

    expect(res.data).toMatchObject({ status: 'sending' });
    expect(mockDb.update).toHaveBeenCalled();
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('send reports NOT_FOUND when no such campaign exists', async () => {
    mockDb.update = vi.fn(() => chainOf([]));
    mockDb.select = vi.fn(() => chainOf([]));
    await expectCode(campaignsRouter.createCaller(ctx()).send({ id: UUID }), 'NOT_FOUND');
  });

  it('send reports BAD_REQUEST when the campaign exists but is not sendable', async () => {
    // Guard matched nothing, yet the row exists => already sent or sending.
    mockDb.update = vi.fn(() => chainOf([]));
    mockDb.select = vi.fn(() => chainOf([{ id: UUID }]));
    await expectCode(campaignsRouter.createCaller(ctx()).send({ id: UUID }), 'BAD_REQUEST');
  });

  it('a member cannot create, send or delete', async () => {
    const member = campaignsRouter.createCaller(ctx('member'));
    await expect(member.send({ id: UUID })).rejects.toSatisfy(forbidden);
    await expect(member.delete({ id: UUID })).rejects.toSatisfy(forbidden);
    await expect(
      member.create({ name: 'x', channel: 'whatsapp', targetSegment: 'all', message: 'hi' } as never)
    ).rejects.toSatisfy(forbidden);
  });

  it('an admin cannot delete — delete is owner-only', async () => {
    await expect(
      campaignsRouter.createCaller(ctx('admin')).delete({ id: UUID })
    ).rejects.toSatisfy(forbidden);
  });
});
