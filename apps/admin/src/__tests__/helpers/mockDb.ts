import { vi } from 'vitest';

// Chainable query builder mock
function chainable(finalValue: unknown = []) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'from', 'where', 'orderBy', 'limit', 'offset', 'leftJoin', 'innerJoin', 'groupBy', 'returning', 'values', 'set', 'onConflictDoUpdate'];
  methods.forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  // Terminal methods
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(finalValue).then(resolve);
  // Make it thenable (awaitable)
  Object.defineProperty(chain, Symbol.toStringTag, { value: 'MockQuery' });
  return chain;
}

/**
 * Stands in for `ctx.withOrg` in unit tests.
 *
 * The real one opens a transaction and issues `SET LOCAL ROLE irth_app` +
 * `set_config('app.org_id', …, true)` so RLS applies. None of that is
 * meaningful against a mock, so this just hands the callback the mock db and
 * keeps the procedure's own logic under test.
 *
 * Tenant isolation is NOT asserted here and cannot be — it is proven against
 * real Postgres in src/__tests__/integration/tenantIsolation.test.ts. Treating
 * a green unit test as evidence of isolation is exactly the mistake this
 * comment exists to prevent.
 */
export const withOrgMock = <T>(fn: (tx: typeof mockDb) => Promise<T>): Promise<T> => fn(mockDb);

export const mockDb = {
  select: vi.fn(() => chainable()),
  insert: vi.fn(() => chainable()),
  update: vi.fn(() => chainable()),
  delete: vi.fn(() => chainable()),
  transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(mockDb)),
  // Raw SQL. Needed because withOrgContext issues `SET LOCAL ROLE irth_app` and
  // `set_config('app.org_id', …, true)` through execute() before handing the
  // transaction to its callback — without this, any unit test whose procedure
  // is wrapped fails on `tx.execute is not a function` rather than on anything
  // it was written to check.
  //
  // Returns an empty result: these statements have no rows, and a mocked db
  // cannot enforce RLS anyway. Tenant isolation is asserted in
  // src/__tests__/integration/tenantIsolation.test.ts against real Postgres —
  // this mock only keeps the wiring from throwing.
  execute: vi.fn(async () => []),
  query: {},
  _reset() {
    vi.clearAllMocks();
    this.select = vi.fn(() => chainable());
    this.insert = vi.fn(() => chainable());
    this.update = vi.fn(() => chainable());
    this.delete = vi.fn(() => chainable());
    this.execute = vi.fn(async () => []);
  },
};
