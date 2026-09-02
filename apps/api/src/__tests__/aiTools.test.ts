import { describe, expect, it, vi } from 'vitest';
import type { DbTx, Role } from '@irth/db';
import { allowedAiToolDefinitions, executeAiTool } from '../ai/tools';

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function chainable(finalValue: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'from', 'where', 'orderBy', 'limit', 'innerJoin']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown) => void) => Promise.resolve(finalValue).then(resolve);
  return chain;
}

function ctx(role: Role, db: unknown = {}): Parameters<typeof executeAiTool>[2] {
  return {
    db: db as DbTx,
    orgId: ORG_ID,
    userId: 'user-1',
    role,
    locale: 'en',
  };
}

describe('IRTH Intelligence tools', () => {
  it('does not expose finance-only sales summaries to members', () => {
    const names = allowedAiToolDefinitions('member').map((tool) => tool.name);

    expect(names).toContain('orders_list');
    expect(names).toContain('products_search');
    expect(names).toContain('inventory_snapshot');
    expect(names).not.toContain('sales_summary');
  });

  it('rejects a forbidden tool before touching the database', async () => {
    const db = { select: vi.fn(() => chainable([])) };

    await expect(executeAiTool('sales_summary', { days: 30 }, ctx('member', db))).rejects.toThrow('Forbidden AI tool');
    expect(db.select).not.toHaveBeenCalled();
  });

  it('rejects model-supplied tenant arguments', async () => {
    const db = { select: vi.fn(() => chainable([])) };

    await expect(
      executeAiTool('products_search', { orgId: '00000000-0000-0000-0000-000000000000', limit: 5 }, ctx('admin', db)),
    ).rejects.toThrow();
    expect(db.select).not.toHaveBeenCalled();
  });

  it('executes an allowed read tool and returns dashboard cards', async () => {
    const rows = [{
      id: 'order-1',
      orderNumber: 'IRT-2026-0001',
      status: 'pending',
      totalAmountMinor: 12345n,
      currency: 'EGP',
      createdAt: new Date('2026-09-02T10:00:00.000Z'),
    }];
    const query = chainable(rows);
    const db = { select: vi.fn(() => query) };

    const result = await executeAiTool('orders_list', { status: 'pending', limit: 1 }, ctx('member', db));

    expect(db.select).toHaveBeenCalledOnce();
    expect(result.cards).toEqual([{
      type: 'orders',
      title: 'Orders',
      items: [{
        id: 'order-1',
        orderNumber: 'IRT-2026-0001',
        status: 'pending',
        totalAmountMinor: '12345',
        currency: 'EGP',
        createdAt: '2026-09-02T10:00:00.000Z',
      }],
    }]);
  });
});
