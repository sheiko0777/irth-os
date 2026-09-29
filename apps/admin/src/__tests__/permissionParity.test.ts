/**
 * PR-1b parity: moving authorization from `ctx.role` onto `ctx.access`
 * (0074's roles + overrides) changes nothing for anyone on a system role.
 *
 * permissionParity.fixture.json was recorded against the code BEFORE the move
 * (role tiers: protectedProcedure / adminProcedure / ownerProcedure / can(role)).
 * This test calls every procedure in the app router as owner, admin and member
 * and requires the same allow/deny outcome for each.
 *
 * How an outcome is read without running anything: see helpers/procedureHarness.ts.
 *
 * Regenerate only against pre-change code: WRITE_PARITY_FIXTURE=1.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { effectiveAccess, type Role } from '@irth/db';
import { harnessCtx, outcomeOf, type Outcome } from './helpers/procedureHarness';

vi.mock('@/lib/auth', () => ({ verifySession: vi.fn() }));
const { appRouter } = await import('@/server/routers/_app');

const ROLES: Role[] = ['owner', 'admin', 'member'];
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'permissionParity.fixture.json');

async function currentMatrix(): Promise<Record<string, Record<Role, Outcome>>> {
  const paths = Object.keys(appRouter._def.procedures).sort();
  const out: Record<string, Record<Role, Outcome>> = {};
  for (const p of paths) {
    const row = {} as Record<Role, Outcome>;
    for (const role of ROLES) {
      row[role] = await outcomeOf(appRouter, harnessCtx(role, effectiveAccess({ systemKey: role })), p);
    }
    out[p] = row;
  }
  return out;
}

describe('permission parity for system roles', () => {
  it('every procedure allows and denies exactly what it did before the move to ctx.access', async () => {
    const now = await currentMatrix();
    if (process.env.WRITE_PARITY_FIXTURE === '1') {
      writeFileSync(FIXTURE, JSON.stringify(now, null, 2) + '\n');
      return;
    }
    const before = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, Record<Role, Outcome>>;
    // New procedures are the permission gate's business, not this test's:
    // compare the ones that existed before, and require none disappeared.
    const drift: string[] = [];
    for (const [p, roles] of Object.entries(before)) {
      if (!now[p]) { drift.push(`${p}: procedure no longer exists`); continue; }
      for (const role of ROLES) {
        if (now[p][role] !== roles[role]) drift.push(`${p} as ${role}: was ${roles[role]}, now ${now[p][role]}`);
      }
    }
    expect(drift, drift.join('\n')).toEqual([]);
    expect(Object.keys(before).length).toBeGreaterThan(100);
  });
});
