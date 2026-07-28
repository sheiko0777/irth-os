import { vi } from 'vitest';

// Stub Next.js server env
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.BETTER_AUTH_SECRET = 'test-secret-32-chars-minimum-ok';
process.env.PLATFORM_ADMIN_EMAIL = 'admin@test.com';
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';

// Keep the real schema (tables, enums, withAudit) and replace only the
// live connection with the chainable mock. postgres-js does not connect
// until a query executes, so importing the real module is safe here.
vi.mock('@irth/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@irth/db')>();
  const { mockDb } = await import('./helpers/mockDb');
  return {
    ...actual,
    db: mockDb,
    createDb: () => mockDb,
  };
});
