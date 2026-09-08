import { createHash } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { idempotencyKeys } from './schema/idempotency';
import { jsonSafe } from './json';
import type { DbInstance, DbTx } from './index';

/** Raised when a request must not proceed. `code` maps to an HTTP/tRPC status. */
export class IdempotencyError extends Error {
    constructor(
        message: string,
        readonly code: 'CONFLICT' | 'BAD_REQUEST',
    ) {
        super(message);
        this.name = 'IdempotencyError';
    }
}

/**
 * Stable fingerprint of a request body.
 *
 * Object key order must not matter — `{a:1,b:2}` and `{b:2,a:1}` are the same
 * request, and JSON.stringify preserves insertion order, so hashing its output
 * directly would call a retry a mismatch depending on how the client happened
 * to build the object.
 *
 * Runs through jsonSafe first: request bodies routinely carry bigint money, and
 * JSON.stringify THROWS on bigint rather than coercing it.
 */
export function fingerprint(input: unknown): string {
    const canonical = stableStringify(jsonSafe(input));
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value instanceof Date) return JSON.stringify(value.toISOString());

    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * Runs `operation` at most once per (tenant, name, key).
 *
 * A retry with the same key returns the FIRST response, without re-applying.
 * Retries are not hypothetical: a timed-out client, a lost response on mobile
 * data, a double-tapped button and a proxy retry all produce a second identical
 * request for one intended action.
 *
 * The transactions added in P2/P3 make each call atomic. Atomic is NOT
 * idempotent — two atomic calls still apply twice. And the server cannot infer
 * which is which, because a customer genuinely ordering the same item twice in
 * a minute is legitimate. Only a caller-supplied key separates them.
 *
 * WHY THE CLAIM IS ITS OWN TRANSACTION
 *
 * The claim commits BEFORE the work starts, in a transaction of its own. That
 * is deliberate and is the only ordering that survives a concurrent retry:
 *
 *   - Claim inside the work's transaction, and the claim is invisible to other
 *     sessions until the work commits. Two concurrent attempts would both
 *     insert, and one would fail on the unique index only at commit — after
 *     doing the work twice.
 *   - Claim first, and the second attempt collides immediately, before touching
 *     anything.
 *
 * The cost is that a process which dies mid-operation leaves an `in_progress`
 * row: the business transaction rolls back, the claim does not. That is the
 * safe direction to fail — a stuck key returns CONFLICT until it is swept,
 * whereas the alternative silently double-applies. `sweepIdempotencyKeys`
 * clears them.
 *
 * @param key   Caller-supplied. `undefined` skips the mechanism entirely and
 *              runs the operation directly, so existing callers keep working
 *              and a client opts in by sending a key.
 */
export async function withIdempotency<T>(
    dbInstance: DbInstance,
    args: {
        orgId: string;
        /** Procedure name. The same key under two operations is two intents. */
        operation: string;
        key: string | undefined;
        /** Request input, hashed to detect a key reused with different parameters. */
        request: unknown;
    },
    operation: (claimId?: string) => Promise<T>,
): Promise<T> {
    const { orgId, operation: name, key, request } = args;

    // Opt-in: no key, no bookkeeping.
    if (key === undefined) return operation();

    if (key.length === 0 || key.length > 255) {
        throw new IdempotencyError(
            'Idempotency key must be between 1 and 255 characters.',
            'BAD_REQUEST',
        );
    }

    const fp = fingerprint(request);

    // Claim, or discover an existing claim. ON CONFLICT DO NOTHING rather than a
    // SELECT-then-INSERT: the latter has a window between the two statements in
    // which a concurrent retry also finds nothing and also inserts.
    const claimed = await dbInstance
        .insert(idempotencyKeys)
        .values({
            orgId,
            key,
            operation: name,
            requestFingerprint: fp,
            state: 'in_progress',
            recoveryTracked: true,
        })
        .onConflictDoNothing()
        .returning({ id: idempotencyKeys.id });

    if (claimed.length === 0) {
        const [existing] = await dbInstance
            .select()
            .from(idempotencyKeys)
            .where(and(
                eq(idempotencyKeys.orgId, orgId),
                eq(idempotencyKeys.operation, name),
                eq(idempotencyKeys.key, key),
            ))
            .limit(1);

        if (!existing) {
            // The row vanished between the conflict and this read — a sweep ran
            // in the gap. Retrying is safe and correct.
            throw new IdempotencyError(
                'Idempotency key was reclaimed concurrently. Retry the request.',
                'CONFLICT',
            );
        }

        // Same key, different request. Replaying the first response here would
        // silently discard what this second request actually asked for, so it
        // is reported rather than guessed at.
        if (existing.requestFingerprint !== fp) {
            throw new IdempotencyError(
                `Idempotency key "${key}" was already used for a different request. ` +
                    'Use a new key for a new request.',
                'BAD_REQUEST',
            );
        }

        if (existing.state === 'in_progress') {
            // The first attempt is still running. Telling the client to retry is
            // the honest answer: we cannot return a result that does not exist
            // yet, and proceeding would double-apply.
            throw new IdempotencyError(
                'A request with this idempotency key is still in progress. Retry shortly.',
                'CONFLICT',
            );
        }

        return existing.response as T;
    }

    let result: T;
    try {
        result = await operation(claimed[0].id);
    } catch (err) {
        // Release the claim only when no business transaction committed. A
        // callback can throw after its transaction commits; deleting that claim
        // would let a retry apply the already-committed effect again.
        await dbInstance
            .delete(idempotencyKeys)
            .where(and(
                eq(idempotencyKeys.orgId, orgId),
                eq(idempotencyKeys.operation, name),
                eq(idempotencyKeys.key, key),
                eq(idempotencyKeys.recoveryTracked, true),
                isNull(idempotencyKeys.effectCommittedAt),
            ))
            .catch(() => undefined);
        throw err;
    }

    // jsonSafe because responses carry bigint money, and the driver serializes
    // jsonb with JSON.stringify, which throws on bigint.
    await dbInstance
        .update(idempotencyKeys)
        .set({ state: 'completed', response: jsonSafe(result) as object, completedAt: new Date() })
        .where(and(
            eq(idempotencyKeys.orgId, orgId),
            eq(idempotencyKeys.operation, name),
            eq(idempotencyKeys.key, key),
        ));

    return result;
}

/**
 * Records, inside the wrapped business transaction, that its effects committed.
 * If that transaction rolls back the marker rolls back with it. A sweeper can
 * therefore distinguish a pre-commit crash from a committed effect whose later
 * response-marker update never ran.
 */
export async function markIdempotencyEffect(
    tx: Pick<DbTx, 'update'>,
    claimId: string,
    orgId: string,
): Promise<void> {
    await tx.update(idempotencyKeys)
        .set({ effectCommittedAt: new Date() })
        .where(and(eq(idempotencyKeys.id, claimId), eq(idempotencyKeys.orgId, orgId)));
}

/**
 * Deletes completed keys and safely reclaimable incomplete claims older than
 * `olderThanHours`.
 *
 * Two reasons this is not optional. Stuck `in_progress` rows from processes that
 * died mid-operation would otherwise return CONFLICT forever. And the table
 * stores a full response per financial mutation, so it grows without bound.
 *
 * An in-progress claim is reclaimable only when it was created by the
 * recovery-aware implementation and has no effect marker. The marker is
 * written in the business transaction, so a committed-but-unmarked effect is
 * retained instead of being applied twice by a retry. Legacy claims are also
 * retained because their outcome cannot be proved.
 *
 * NOTE: replayed responses are only correct while the key survives. Sweeping
 * too aggressively means a late retry re-applies for real.
 */
export async function sweepIdempotencyKeys(
    tx: Pick<DbTx, 'execute' | 'rollback'>,
    olderThanHours = 24,
): Promise<number> {
    const rows = await tx.execute<{ count: string }>(sql`
        WITH deleted AS (
            DELETE FROM idempotency_keys
            WHERE created_at < now() - (${olderThanHours} * INTERVAL '1 hour')
              AND (
                state = 'completed'
                OR (
                  state = 'in_progress'
                  AND recovery_tracked = true
                  AND effect_committed_at IS NULL
                )
              )
            RETURNING 1
        )
        SELECT count(*)::text AS count FROM deleted
    `);
    return Number([...rows][0]?.count ?? 0);
}
