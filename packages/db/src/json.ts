/**
 * JSON serialization boundary for values that carry bigint.
 *
 * WHY THIS EXISTS
 *
 * `JSON.stringify` throws on BigInt — not "renders it oddly", throws:
 *
 *     TypeError: Do not know how to serialize a BigInt
 *
 * Money became bigint minor units in migration 0028. Before that, Drizzle
 * returned `decimal` columns as STRINGS, which are JSON-safe, so every path
 * that stringified a row worked by accident. After it, the same paths throw at
 * runtime:
 *
 *   - `c.json(row)` in the Hono API — every endpoint returning money.
 *   - jsonb parameters, which the postgres driver serializes with
 *     JSON.stringify — so `withAudit`'s `changes` column takes down any audited
 *     write whose changeset mentions an amount.
 *
 * apps/admin is unaffected because tRPC is configured with superjson, which
 * encodes bigint itself. Nothing in the API had an equivalent.
 *
 * WHY IT LIVES IN packages/db
 *
 * Conceptually it belongs with Money in @irth/domain. It is here because both
 * consumers — withAudit in this package, and the Hono API — already depend on
 * @irth/db, whereas putting it in domain would add a workspace dependency to
 * packages/db and require a full install to link it. Placement follows the
 * existing dependency edges rather than adding one.
 *
 * ONE IMPLEMENTATION, ON PURPOSE
 *
 * The obvious shortcut is a private copy at each boundary. That is how the
 * `Date` bug below came to exist in two places at once: a fix applied to one
 * copy leaves the other wrong, and the two drift silently because both look
 * correct in isolation. This package is zero-dependency precisely so every
 * consumer — Workers, Next.js, React Native — can share it.
 */

/** Recursively JSON-safe form of `T`: bigint becomes a decimal string. */
export type JsonSafe<T> = T extends bigint
    ? string
    : T extends Date
      ? Date
      : T extends Array<infer U>
        ? JsonSafe<U>[]
        : T extends object
          ? { [K in keyof T]: JsonSafe<T[K]> }
          : T;

/**
 * Returns a structurally identical value with every bigint replaced by its
 * decimal string.
 *
 * A STRING, not a number: minor units are exact integers and `Number(bigint)`
 * silently loses precision past 2^53. Rendering money as a float at the
 * serialization boundary would undo the entire point of migration 0028.
 *
 * Dates pass through untouched. This is not a detail — `Object.entries(new
 * Date())` is `[]`, because a Date's value lives in an internal slot rather
 * than enumerable properties. A generic object walk therefore turns every
 * timestamp into `{}`, so `createdAt` and `updatedAt` would serialize as empty
 * objects on every response. Caught by testing the helper against a row shape
 * rather than a hand-written object literal.
 */
export function jsonSafe<T>(value: T): JsonSafe<T> {
    return convert(value) as JsonSafe<T>;
}

function convert(value: unknown): unknown {
    if (typeof value === 'bigint') return value.toString();

    // Before the object branch: see the Date note above.
    if (value instanceof Date) return value;

    // typeof null === 'object', so this must precede the object branch too.
    if (value === null || typeof value !== 'object') return value;

    if (Array.isArray(value)) return value.map(convert);

    // Leave exotic objects alone rather than flattening them into plain ones.
    // Map/Set have no own enumerable entries either, so walking them would
    // produce {} exactly as Date did; they are not JSON-serializable to begin
    // with, so passing them through lets JSON.stringify fail loudly on the real
    // problem instead of silently emitting an empty object.
    if (value instanceof Map || value instanceof Set || value instanceof RegExp) return value;

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = convert(v);
    return out;
}
