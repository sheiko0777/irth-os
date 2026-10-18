import { describe, expect, it, vi } from 'vitest';
// @ts-ignore
import { runMigrationFile, MIGRATION_LOCK_ID } from '../../scripts/migrate.mjs';

describe('runMigrationFile', () => {
  it('acquires an advisory lock as the first statement', async () => {
    const executed: any[] = [];

    // Mock the template literal tag
    const tx = Object.assign(
      async (strings: any, ...values: any[]) => {
        executed.push({ type: 'tag', query: strings[0].trim(), values });
        // Return empty row for the ledger check
        return [];
      },
      {
        unsafe: async (sql: string) => {
          executed.push({ type: 'unsafe', sql });
        }
      }
    );

    const logger = { log: vi.fn() };
    const statements = ['CREATE TABLE test();'];

    const result = await runMigrationFile(tx, '0001_test.sql', statements, logger);

    expect(result).toBe(true);

    // The very first call must be the advisory lock
    expect(executed[0]).toEqual({
      type: 'unsafe',
      sql: `SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`
    });

    // The second call must be the ledger check
    expect(executed[1].type).toBe('tag');
    expect(executed[1].query).toContain('SELECT filename FROM public._migrations');

    // The third call must be the search path
    expect(executed[2]).toEqual({
      type: 'unsafe',
      sql: 'SET LOCAL search_path TO public'
    });

    // The fourth call must be the statement
    expect(executed[3]).toEqual({
      type: 'unsafe',
      sql: 'CREATE TABLE test();'
    });

    // The last call must be the ledger insert
    expect(executed[4].type).toBe('tag');
    expect(executed[4].query).toContain('INSERT INTO public._migrations (filename) VALUES (');
  });

  it('skips the migration if the file is already in the ledger', async () => {
    const executed: any[] = [];

    const tx = Object.assign(
      async (strings: any, ...values: any[]) => {
        executed.push({ type: 'tag', query: strings[0].trim(), values });
        if (strings[0].includes('SELECT filename FROM public._migrations')) {
          // Return a row to simulate that it's already applied
          return [{ filename: '0001_test.sql' }];
        }
        return [];
      },
      {
        unsafe: async (sql: string) => {
          executed.push({ type: 'unsafe', sql });
        }
      }
    );

    const logger = { log: vi.fn() };
    const statements = ['CREATE TABLE test();'];

    const result = await runMigrationFile(tx, '0001_test.sql', statements, logger);

    expect(result).toBe(false);

    // The very first call must be the advisory lock
    expect(executed[0]).toEqual({
      type: 'unsafe',
      sql: `SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`
    });

    // We shouldn't execute the statement or set the search path
    expect(executed.some(e => e.type === 'unsafe' && e.sql === 'CREATE TABLE test();')).toBe(false);

    // The logger should record a skip message
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('skipped  0001_test.sql (already applied by a concurrent runner)')
    );
  });
});
