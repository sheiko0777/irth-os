import { auditLog } from './schema';
import type { AuditChannel, DbTx } from './index';

/**
 * A refused call is evidence — someone probing, or a role missing something
 * they need — so it goes to the audit log (PR-1d, CX-05). One helper for both
 * doors (apps/admin tRPC and apps/api Hono) so they cannot drift.
 *
 * Throttled per isolate: at most one row per actor + path per minute (a client
 * retrying in a loop), and at most DENIAL_CAP_PER_MINUTE rows per actor per
 * minute across all paths (someone walking the API). The refusal itself never
 * depends on the row: a throttled or failed write still refuses.
 *
 * ponytail: in-isolate memory, so N isolates allow N× the cap. Move to a DB or
 * KV counter if denial floods ever matter more than this.
 */
export const DENIAL_WINDOW_MS = 60_000;
export const DENIAL_CAP_PER_MINUTE = 20;

const lastByPath = new Map<string, number>();
const byActor = new Map<string, { start: number; count: number }>();

/** Pure gate — exported for tests. Records the attempt when it returns true. */
export function shouldLogDenial(actorKey: string, path: string, now = Date.now()): boolean {
  if (lastByPath.size > 10_000) lastByPath.clear();
  if (byActor.size > 10_000) byActor.clear();

  const pathKey = `${actorKey}:${path}`;
  const last = lastByPath.get(pathKey);
  if (last !== undefined && now - last < DENIAL_WINDOW_MS) return false;

  let win = byActor.get(actorKey);
  if (!win || now - win.start >= DENIAL_WINDOW_MS) {
    win = { start: now, count: 0 };
    byActor.set(actorKey, win);
  }
  if (win.count >= DENIAL_CAP_PER_MINUTE) return false;

  win.count += 1;
  lastByPath.set(pathKey, now);
  return true;
}

/** Test hook: forget every throttle window. */
export function resetDenialThrottle(): void {
  lastByPath.clear();
  byActor.clear();
}

export interface DenialEntry {
  orgId: string;
  userId: string | null;
  /** Procedure path (admin) or METHOD + route (api). Never the request body. */
  path: string;
  permission: string;
  channel: AuditChannel;
  requestId?: string | null;
}

/**
 * Writes one outcome='denied' row through `runInOrg` (ctx.withOrg in admin,
 * withOrg(c, …) in api — irth_app + RLS). Swallows write errors: a lost audit
 * row must not turn a 403 into a 500.
 */
export async function logDenial(
  runInOrg: (fn: (tx: DbTx) => Promise<unknown>) => Promise<unknown>,
  entry: DenialEntry,
): Promise<void> {
  if (!shouldLogDenial(`${entry.orgId}:${entry.userId}`, entry.path)) return;
  try {
    await runInOrg((tx) => tx.insert(auditLog).values({
      orgId: entry.orgId,
      userId: entry.userId,
      action: 'PERMISSION_DENIED',
      tableName: 'permissions',
      recordId: null,
      changes: { path: entry.path, permission: entry.permission },
      outcome: 'denied',
      channel: entry.channel,
      requestId: entry.requestId ?? null,
    }));
  } catch {
    // The refusal is what matters.
  }
}
