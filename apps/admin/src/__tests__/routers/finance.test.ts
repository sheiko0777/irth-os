import { EGP, zero } from '@irth/domain';
import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { mockDb } from '../helpers/mockDb';

const { financeRouter } = await import('@/server/routers/finance');

function ctx(role: 'owner' | 'admin' | 'member' = 'owner'): Context {
  return {
    db: mockDb,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role,
  } as unknown as Context;
}

const RANGE = { startDate: '2026-01-01', endDate: '2026-01-31' };

async function expectCode(p: Promise<unknown>, code: TRPCError['code']) {
  await expect(p).rejects.toSatisfy(
    (e: unknown) => e instanceof TRPCError && e.code === code
  );
}

// All finance queries guard empty aggregate rows with `?.` and `?? '0'`, so an
// empty mock result set resolves to zeroed metrics rather than throwing.
describe('finance', () => {
  const caller = financeRouter.createCaller(ctx('admin'));

  it('pnl resolves with zeroed metrics when aggregates are empty', async () => {
    const res = await caller.pnl(RANGE);
    expect(res.data.totalRevenue).toEqual(zero(EGP));
    expect(res.data.totalOrders).toBe(0);
    expect(res.data.avgOrderValue).toEqual(zero(EGP));
    expect(res.data.cancelledOrders).toBe(0);
    expect(res.data.pendingOrders).toBe(0);
    expect(res.data.startDate).toBe(RANGE.startDate);
    expect(res.data.endDate).toBe(RANGE.endDate);
    expect(res.error).toBeNull();
  });

  it('pnl rejects missing endDate with BAD_REQUEST', async () => {
    await expectCode(caller.pnl({ startDate: '2026-01-01' } as never), 'BAD_REQUEST');
  });

  it('codReconciliation resolves with an empty data array', async () => {
    const res = await caller.codReconciliation(RANGE);
    expect(res.data).toEqual([]);
    expect(res.error).toBeNull();
    expect(res.meta).toBeNull();
  });

  it('vatReport computes zero VAT from empty aggregates', async () => {
    const res = await caller.vatReport(RANGE);
    expect(res.data.grossRevenue).toEqual(zero(EGP));
    expect(res.data.vatAmount).toEqual(zero(EGP));
    expect(res.data.netRevenue).toEqual(zero(EGP));
    expect(res.data.orderCount).toBe(0);
    expect(res.error).toBeNull();
  });

  it('askAi top-products branch resolves with the empty-catalog message', async () => {
    const res = await caller.askAi({ question: 'what are my top products' });
    expect(res.data.result).toContain('لا توجد');
    expect(res.data.query).toContain('SELECT');
    expect(res.data.question).toBe('what are my top products');
  });

  it('askAi pending branch resolves with a zero count', async () => {
    const res = await caller.askAi({ question: 'how many pending orders' });
    expect(res.data.result).toContain('0');
    expect(res.data.query).toContain("status = 'pending'");
  });

  it('askAi rejects a question over 500 chars with BAD_REQUEST', async () => {
    await expectCode(caller.askAi({ question: 'x'.repeat(501) }), 'BAD_REQUEST');
  });

  it('member role is FORBIDDEN on finance procedures (admin-gated)', async () => {
    const member = financeRouter.createCaller(ctx('member'));
    await expectCode(member.vatReport(RANGE), 'FORBIDDEN');
    await expectCode(member.askAi({ question: 'revenue' }), 'FORBIDDEN');
  });
});
