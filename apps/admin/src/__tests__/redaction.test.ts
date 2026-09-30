/**
 * PR-1e: sensitive fields are removed on the server for members without the
 * matching sensitive.* permission — through the real protectedProcedure
 * middleware, so every procedure gets it without opting in.
 */
import { describe, expect, it, vi } from 'vitest';
import { effectiveAccess, hiddenKeys, redact } from '@irth/db';
import { router, requirePermission, type Context } from '@/server/trpc';

vi.mock('@/lib/auth', () => ({ verifySession: vi.fn() }));

const member = effectiveAccess({ systemKey: 'member' });
const admin = effectiveAccess({ systemKey: 'admin' });

describe('redact', () => {
  it('removes hidden keys at any depth and keeps bigint, Date and everything else intact', () => {
    const when = new Date('2026-09-26T00:00:00Z');
    const input = {
      rows: [{ item: { id: 'a', quantity: 3, averageCostMinor: 1250n, updatedAt: when }, product: { name: 'سيروم', costMinor: 99n } }],
      meta: { total: 1n },
    };
    const out = redact(input, new Set(['averageCostMinor', 'costMinor']));
    expect(out).toEqual({ rows: [{ item: { id: 'a', quantity: 3, updatedAt: when }, product: { name: 'سيروم' } }], meta: { total: 1n } });
    expect(out.rows[0].item.updatedAt).toBeInstanceOf(Date);
    expect(input.rows[0].item.averageCostMinor).toBe(1250n); // the original is not mutated
  });

  it('removes the key rather than zeroing it — absent, not "free"', () => {
    const out = redact({ costMinor: 500n }, new Set(['costMinor']));
    expect('costMinor' in out).toBe(false);
  });
});

describe('hiddenKeys — defaults per the owner decision', () => {
  it('a موظف loses cost and supplier price; an admin keeps them', () => {
    expect([...hiddenKeys(member, 'inventory.list')]).toEqual(expect.arrayContaining(['averageCostMinor', 'costMinor', 'unitCostMinor']));
    expect(hiddenKeys(admin, 'inventory.list').size).toBe(0);
  });

  it('a PO total is a supplier price under purchasing, but a sales order total is not touched', () => {
    expect(hiddenKeys(member, 'purchasing.po.list').has('totalAmountMinor')).toBe(true);
    expect(hiddenKeys(member, 'orders.list').has('totalAmountMinor')).toBe(false);
  });

  it('customer contact stays visible to a موظف by default, and goes when revoked — on order and customer paths only', () => {
    expect(hiddenKeys(member, 'orders.getById').has('phone')).toBe(false);
    const noContact = effectiveAccess({ systemKey: 'member', overrides: { revoke: { sensitive: ['customerContact'] } } });
    expect(hiddenKeys(noContact, 'orders.getById').has('phone')).toBe(true);
    expect(hiddenKeys(noContact, 'customers.list').has('email')).toBe(true);
    expect(hiddenKeys(noContact, 'members.list').has('email')).toBe(false);
  });

  it('a per-person grant brings cost back for that one member', () => {
    const granted = effectiveAccess({ systemKey: 'member', overrides: { grant: { sensitive: ['cost'] } } });
    expect(hiddenKeys(granted, 'inventory.list').has('averageCostMinor')).toBe(false);
  });
});

describe('the middleware applies it to every procedure', () => {
  const r = router({
    item: requirePermission('inventory', 'view').query(() => ({ data: { id: 'x', averageCostMinor: 700n, quantity: 2 } })),
  });
  const ctx = (access: ReturnType<typeof effectiveAccess>) => ({
    session: { user: { id: 'u', email: 'u@test.com' } }, orgId: '00000000-0000-4000-8000-000000000001', userId: 'u', role: 'member', access,
  } as unknown as Context);

  it('strips for a موظف, keeps for an admin', async () => {
    expect(await r.createCaller(ctx(member)).item()).toEqual({ data: { id: 'x', quantity: 2 } });
    expect(await r.createCaller(ctx(admin)).item()).toEqual({ data: { id: 'x', averageCostMinor: 700n, quantity: 2 } });
  });
});
