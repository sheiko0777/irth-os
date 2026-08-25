/**
 * Per-worker setup for the integration suite.
 *
 * Deliberately does NOT mock `@irth/db` — that is what the unit suite's
 * `src/__tests__/setup.ts` does, and importing the mock here would make every
 * assertion below pass without a database.
 *
 * `packages/db/src/index.ts` builds its `db` singleton from DATABASE_URL at
 * module load, so anything importing `@irth/db` — including the tRPC routers
 * that later phases will exercise end to end — must find it pointing at the
 * test branch. globalSetup has already refused to run if the two URLs are the
 * same, so aliasing here cannot redirect the suite onto the app database.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
loadEnv({ path: path.join(ADMIN_ROOT, '.env.test.local') });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is not set — see globalSetup for how to provide it.');
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.BETTER_AUTH_SECRET ??= 'test-secret-32-chars-minimum-ok';
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
