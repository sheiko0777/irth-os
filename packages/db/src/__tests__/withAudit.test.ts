/**
 * withAudit v2 defaults (CX-05) and the shared denial throttle. A pre-0082
 * call — no actorKind/channel/outcome — must still write a user/admin/success
 * row, and before/after go through jsonSafe like `changes` (bigint-safe).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  auditLog, auditRow, withAudit, shouldLogDenial, resetDenialThrottle,
  DENIAL_CAP_PER_MINUTE, DENIAL_WINDOW_MS,
} from '../index';

function fakeTx() {
  const rows: Record<string, unknown>[] = [];
  const tx = {
    insert: (table: unknown) => ({
      values: async (row: Record<string, unknown>) => { if (table === auditLog) rows.push(row); },
    }),
    rollback: () => { throw new Error('unused'); },
  };
  return { tx: tx as unknown as Parameters<typeof withAudit>[0], rows };
}

describe('withAudit defaults', () => {
  it('a pre-v2 call writes actor_kind=user, channel=admin, outcome=success', async () => {
    const { tx, rows } = fakeTx();
    const result = await withAudit(tx, async () => ({ id: '00000000-0000-0000-0000-000000000001' }), {
      orgId: 'org-1', userId: 'user-1', action: 'CREATE', tableName: 'orders', changes: { total: 10n },
    });
    expect(result.id).toBe('00000000-0000-0000-0000-000000000001');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId: 'org-1', userId: 'user-1', action: 'CREATE', tableName: 'orders',
      actorKind: 'user', channel: 'admin', outcome: 'success',
      recordId: '00000000-0000-0000-0000-000000000001',
      changes: { total: '10' }, before: null, after: null,
    });
  });

  it('explicit v2 fields win; before/after are bigint-safe', () => {
    const row = auditRow({
      orgId: 'org-1', userId: null, action: 'X', tableName: 't', changes: {},
      actorKind: 'webhook', channel: 'webhook', outcome: 'failed', reason: 'boom',
      before: { amountMinor: 5n }, after: { amountMinor: 7n },
    }, null);
    expect(row).toMatchObject({
      actorKind: 'webhook', channel: 'webhook', outcome: 'failed', reason: 'boom', recordId: null,
      before: { amountMinor: '5' }, after: { amountMinor: '7' },
    });
    expect(() => JSON.stringify(row)).not.toThrow();
  });
});

describe('shouldLogDenial', () => {
  beforeEach(() => resetDenialThrottle());

  it('one row per actor + path per window', () => {
    expect(shouldLogDenial('a', '/p', 0)).toBe(true);
    expect(shouldLogDenial('a', '/p', 1)).toBe(false);
    expect(shouldLogDenial('a', '/p', DENIAL_WINDOW_MS)).toBe(true);
  });

  it(`at most ${DENIAL_CAP_PER_MINUTE} per actor per window; other actors unaffected`, () => {
    for (let i = 0; i < DENIAL_CAP_PER_MINUTE; i++) expect(shouldLogDenial('a', `/p${i}`, 0)).toBe(true);
    expect(shouldLogDenial('a', '/another', 1)).toBe(false);
    expect(shouldLogDenial('b', '/another', 1)).toBe(true);
    expect(shouldLogDenial('a', '/another', DENIAL_WINDOW_MS)).toBe(true);
  });
});
