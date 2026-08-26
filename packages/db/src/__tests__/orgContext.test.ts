import { describe, expect, it, vi } from 'vitest';
import { NotAMemberError, resolveActiveOrgMembership, setActiveOrg, listMembershipsForUser } from '../orgContext';

/**
 * A minimal chainable query-builder mock, tailored to exactly the method
 * chains orgContext.ts uses (select/from/where/orderBy/limit/innerJoin/set).
 * Each call to `db.select` is configured with `mockReturnValueOnce` per
 * expected query in sequence — this lets a test assert not just the RESULT
 * but that a later query in the fallback chain was (or was not) reached at
 * all, which matters here: the whole point of the pin/fallback logic is that
 * a valid pin must short-circuit before ever running the oldest-membership
 * query.
 */
function chainable(finalValue: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'limit', 'innerJoin', 'set']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(finalValue).then(resolve);
  return chain;
}

function mockDb() {
  return { select: vi.fn(), update: vi.fn(() => chainable(undefined)) };
}

describe('resolveActiveOrgMembership', () => {
  it('no pin set — falls back to the oldest membership', async () => {
    const db = mockDb();
    db.select
      .mockReturnValueOnce(chainable([{ lastActiveOrgId: null }])) // user row, no pin
      .mockReturnValueOnce(chainable([{ orgId: 'org-old', role: 'member' }])); // oldest fallback

    const result = await resolveActiveOrgMembership(db as never, 'user-1');

    expect(result).toEqual({ orgId: 'org-old', role: 'member' });
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it('valid pin — used directly, oldest-fallback query never runs', async () => {
    const db = mockDb();
    db.select
      .mockReturnValueOnce(chainable([{ lastActiveOrgId: 'org-pinned' }])) // pin
      .mockReturnValueOnce(chainable([{ orgId: 'org-pinned', role: 'admin' }])); // membership still live

    const result = await resolveActiveOrgMembership(db as never, 'user-1');

    expect(result).toEqual({ orgId: 'org-pinned', role: 'admin' });
    // Exactly 2 calls: pin lookup + membership check. A 3rd would mean the
    // fallback ran even though the pin resolved — the bug this test guards.
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it('pin points at a revoked membership — falls back to the oldest remaining', async () => {
    const db = mockDb();
    db.select
      .mockReturnValueOnce(chainable([{ lastActiveOrgId: 'org-revoked' }])) // pin
      .mockReturnValueOnce(chainable([])) // membership check: revoked, no row
      .mockReturnValueOnce(chainable([{ orgId: 'org-remaining', role: 'member' }])); // fallback

    const result = await resolveActiveOrgMembership(db as never, 'user-1');

    expect(result).toEqual({ orgId: 'org-remaining', role: 'member' });
    expect(db.select).toHaveBeenCalledTimes(3);
  });

  it('zero memberships anywhere — returns null', async () => {
    const db = mockDb();
    db.select
      .mockReturnValueOnce(chainable([{ lastActiveOrgId: null }]))
      .mockReturnValueOnce(chainable([]));

    const result = await resolveActiveOrgMembership(db as never, 'user-1');

    expect(result).toBeNull();
  });
});

describe('setActiveOrg', () => {
  it('rejects switching into an org the caller is not a member of, without writing anything', async () => {
    const db = mockDb();
    db.select.mockReturnValueOnce(chainable([]));

    await expect(setActiveOrg(db as never, 'user-1', 'org-not-mine')).rejects.toBeInstanceOf(NotAMemberError);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('verifies membership, then writes the pin', async () => {
    const db = mockDb();
    db.select.mockReturnValueOnce(chainable([{ orgId: 'org-2', role: 'owner' }]));

    const result = await setActiveOrg(db as never, 'user-1', 'org-2');

    expect(result).toEqual({ orgId: 'org-2', role: 'owner' });
    expect(db.update).toHaveBeenCalledTimes(1);
  });
});

describe('listMembershipsForUser', () => {
  it('returns every org the user belongs to, oldest first', async () => {
    const db = mockDb();
    db.select.mockReturnValueOnce(chainable([
      { orgId: 'org-1', orgName: 'IRTH Group', role: 'owner' },
      { orgId: 'org-2', orgName: 'Second Co', role: 'member' },
    ]));

    const result = await listMembershipsForUser(db as never, 'user-1');

    expect(result).toEqual([
      { orgId: 'org-1', orgName: 'IRTH Group', role: 'owner' },
      { orgId: 'org-2', orgName: 'Second Co', role: 'member' },
    ]);
  });
});
