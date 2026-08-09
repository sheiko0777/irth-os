// `src/db.ts` throws at import time when DATABASE_URL is unset, and it sits in
// the import graph of every middleware and route — so even a test of a pure
// string predicate needs this set. postgres-js does not open a socket until a
// query actually runs, so a placeholder URL is enough and nothing connects.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.BETTER_AUTH_SECRET ??= 'test-secret-32-chars-minimum-ok';
