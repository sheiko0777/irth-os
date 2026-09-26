import { effectiveAccess } from '@irth/db';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context } from '@/server/trpc';
import { auditRouter } from '@/server/routers/audit';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

function ctx(role: 'owner' | 'admin' | 'member' = 'admin'): Context {
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
  for (const m of ['select', 'from', 'where', 'orderBy', 'limit', 'offset', 'leftJoin', 'innerJoin', 'groupBy']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(value).then(resolve);
  return chain;
}

beforeEach(() => {
  mockDb._reset();
});

describe('audit router — immutable activity logging', () => {
  it('rejects unprivileged member roles from reading audit logs', async () => {
    const caller = auditRouter.createCaller(ctx('member'));
    await expect(caller.list({ page: 1, pageSize: 25 })).rejects.toThrow('Missing permission: audit.view');
  });

  it('list: returns paginated audit records with humanized labels and device parsing', async () => {
    const caller = auditRouter.createCaller(ctx('admin'));

    const mockCountResult = [{ count: 1 }];
    const mockRows = [
      {
        id: '11111111-1111-1111-1111-111111111111',
        orgId: 'org-1',
        userId: 'user-1',
        action: 'UPDATE_BIN_LOCATION',
        tableName: 'product_variants',
        recordId: '22222222-2222-2222-2222-222222222222',
        changes: { from: 'A-01', to: 'A-04' },
        createdAt: new Date('2026-09-19T05:00:00Z'),
        userName: 'Sherif',
        userEmail: 'sherif@example.com',
        userImage: null,
        userRole: 'owner',
      },
    ];

    const mockSessions = [
      {
        userId: 'user-1',
        ipAddress: '197.34.12.1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
      },
    ];

    // Count query
    mockDb.select.mockReturnValueOnce(chainOf(mockCountResult));
    // Rows query
    mockDb.select.mockReturnValueOnce(chainOf(mockRows));
    // Sessions query
    mockDb.select.mockReturnValueOnce(chainOf(mockSessions));

    const result = await caller.list({ page: 1, pageSize: 25 });

    expect(result.pagination.total).toBe(1);
    expect(result.items).toHaveLength(1);

    const first = result.items[0];
    expect(first.action).toBe('UPDATE_BIN_LOCATION');
    expect(first.actionLabelAr).toBe('تحديث موقع الرف والتخزين');
    expect(first.tableLabelAr).toBe('متغيرات المنتجات');
    expect(first.actor.name).toBe('Sherif');
    expect(first.client.ipAddress).toBe('197.34.12.1');
    expect(first.client.browser).toBe('Chrome');
    expect(first.client.os).toBe('Windows 10/11');
    expect(first.client.deviceType).toBe('desktop');
  });

  it('stats: computes aggregated KPI metrics', async () => {
    const caller = auditRouter.createCaller(ctx('owner'));

    mockDb.select.mockReturnValueOnce(chainOf([{ count: 120 }])); // total
    mockDb.select.mockReturnValueOnce(chainOf([{ count: 15 }])); // today
    mockDb.select.mockReturnValueOnce(chainOf([{ count: 4 }])); // users
    mockDb.select.mockReturnValueOnce(chainOf([{ createdAt: new Date(), action: 'UPDATE_PRODUCT' }])); // latest

    const stats = await caller.stats();

    expect(stats.totalEvents).toBe(120);
    expect(stats.todayEvents).toBe(15);
    expect(stats.activeOperatorsCount).toBe(4);
    expect(stats.latestEvent?.action).toBe('UPDATE_PRODUCT');
  });
});
