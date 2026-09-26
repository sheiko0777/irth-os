import { effectiveAccess } from '@irth/db';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

const { deadLettersRouter } = await import('@/server/routers/deadLetters');

function ctx(role: 'owner' | 'admin' | 'member' = 'owner'): Context {
  return {
    db: mockDb,
    withOrg: withOrgMock,
    idempotent: idempotentMock,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role,
    access: effectiveAccess({ systemKey: role }),
  } as unknown as Context;
}

function chainOf(value: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'orderBy', 'limit', 'offset', 'returning', 'values', 'set']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(value).then(resolve);
  return chain;
}

const UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

async function expectCode(p: Promise<unknown>, code: TRPCError['code']) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === code);
}

function deadLetter(overrides: Partial<{ id: string; orgId: string; replayedAt: Date | null }> = {}) {
  return {
    id: overrides.id ?? UUID,
    orgId: overrides.orgId ?? 'org-1',
    eventType: 'org.invite.sent',
    payload: JSON.stringify({ email: 'invitee@test.com' }),
    attempts: 5,
    lastError: 'resend unreachable',
    failedAt: new Date('2026-09-13T00:00:00.000Z'),
    replayedAt: overrides.replayedAt ?? null,
    replayedBy: null,
  };
}

beforeEach(() => {
  mockDb._reset();
});

describe('deadLetters', () => {
  it('list resolves with the data envelope', async () => {
    mockDb.select = vi.fn(() => chainOf([deadLetter()]));
    const res = await deadLettersRouter.createCaller(ctx()).list({});
    expect(res.data).toEqual([deadLetter()]);
    expect(res.error).toBeNull();
  });

  it('a member cannot list or replay — dead-letter payloads can carry secrets (OTP codes, tokens)', async () => {
    const member = deadLettersRouter.createCaller(ctx('member'));
    const forbidden = (e: unknown) => e instanceof TRPCError && e.code === 'FORBIDDEN';
    await expect(member.list({})).rejects.toSatisfy(forbidden);
    await expect(member.replay({ id: UUID })).rejects.toSatisfy(forbidden);
  });

  it('replay rejects a malformed id with BAD_REQUEST', async () => {
    await expectCode(deadLettersRouter.createCaller(ctx()).replay({ id: 'nope' } as never), 'BAD_REQUEST');
  });

  it('replay returns an error result when the dead letter does not exist', async () => {
    mockDb.select = vi.fn(() => chainOf([]));
    const res = await deadLettersRouter.createCaller(ctx()).replay({ id: UUID });
    expect(res.data).toBeNull();
    expect(res.error).toBe('Dead letter not found');
  });

  it('replay refuses to re-queue an already-replayed dead letter', async () => {
    mockDb.select = vi.fn(() => chainOf([deadLetter({ replayedAt: new Date() })]));
    const insertSpy = vi.fn(() => chainOf([]));
    mockDb.insert = insertSpy;

    const res = await deadLettersRouter.createCaller(ctx()).replay({ id: UUID });

    expect(res.data).toBeNull();
    expect(res.error).toBe('Already replayed');
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('replay re-queues the event and marks the dead letter replayed', async () => {
    const letter = deadLetter();
    mockDb.select = vi.fn(() => chainOf([letter]));
    const insertSpy = vi.fn(() => chainOf([]));
    const updateSpy = vi.fn(() => chainOf([]));
    mockDb.insert = insertSpy;
    mockDb.update = updateSpy;

    const res = await deadLettersRouter.createCaller(ctx()).replay({ id: UUID });

    expect(res.data).toEqual({ requeued: true });
    expect(res.error).toBeNull();
    // A fresh outbox_events row, carrying the original event's identity —
    // not a partial/garbled re-encoding of it.
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const insertedValues = insertSpy.mock.results[0]!.value;
    expect(insertedValues.values).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', eventType: 'org.invite.sent', payload: letter.payload }),
    );
    // The dead letter itself is marked replayed, by this caller.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const updatedValues = updateSpy.mock.results[0]!.value;
    expect(updatedValues.set).toHaveBeenCalledWith(
      expect.objectContaining({ replayedBy: 'user-1' }),
    );
  });
});
