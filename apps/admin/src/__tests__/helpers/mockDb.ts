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

export const mockDb = {
  select: vi.fn(() => chainable()),
  insert: vi.fn(() => chainable()),
  update: vi.fn(() => chainable()),
  delete: vi.fn(() => chainable()),
  transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(mockDb)),
  query: {},
  _reset() {
    vi.clearAllMocks();
    this.select = vi.fn(() => chainable());
    this.insert = vi.fn(() => chainable());
    this.update = vi.fn(() => chainable());
    this.delete = vi.fn(() => chainable());
  },
};
