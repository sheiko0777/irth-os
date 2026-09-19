import { describe, expect, it } from 'vitest';
import { plan } from '../../scripts/check-migrations.mjs';

describe('check-migrations plan()', () => {
  const sampleMain = [
    'packages/db/drizzle/0000_empty_silk_fever.sql',
    'packages/db/drizzle/0010_courier_settlement.sql',
    'packages/db/drizzle/0066_two_factor_lockout_columns.sql',
  ];

  it('passes when no migrations are changed or added in PR', () => {
    const result = plan(sampleMain, []);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.maxMain).toBe(66);
  });

  it('passes when a strictly higher, valid, unique migration is added', () => {
    const result = plan(sampleMain, [
      { status: 'A', file: 'packages/db/drizzle/0067_dm_01_legal_entities.sql' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails when an added migration collides with an existing migration number on main (planted 0066_dup.sql)', () => {
    const result = plan(sampleMain, [
      { status: 'A', file: 'packages/db/drizzle/0066_dup.sql' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('Duplicate migration number "0066"'))).toBe(true);
    expect(result.errors.some((e: string) => e.includes('0066_two_factor_lockout_columns.sql') && e.includes('0066_dup.sql'))).toBe(true);
    expect(result.errors.some((e: string) => e.includes('must be strictly greater than origin/main\'s highest migration (0066)'))).toBe(true);
  });

  it('fails when two migrations with the same prefix are added in the same PR', () => {
    const result = plan(sampleMain, [
      { status: 'A', file: 'packages/db/drizzle/0067_first.sql' },
      { status: 'A', file: 'packages/db/drizzle/0067_second.sql' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('Duplicate migration number "0067"') && e.includes('0067_first.sql') && e.includes('0067_second.sql'))).toBe(true);
  });

  it('fails when an existing migration is modified (status M, planted edit to 0010)', () => {
    const result = plan(sampleMain, [
      { status: 'M', file: 'packages/db/drizzle/0010_courier_settlement.sql' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Cannot modify existing migration file: 0010_courier_settlement.sql');
  });

  it('fails when an existing migration is deleted (status D)', () => {
    const result = plan(sampleMain, [
      { status: 'D', file: 'packages/db/drizzle/0010_courier_settlement.sql' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Cannot delete existing migration file: 0010_courier_settlement.sql');
  });

  it('fails when an existing migration is renamed (status R)', () => {
    const result = plan(sampleMain, [
      { status: 'R100', file: 'packages/db/drizzle/0010_courier_settlement.sql' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Cannot rename existing migration file: 0010_courier_settlement.sql');
  });

  it('fails when an added migration number is <= max(main) (planted 0060_x.sql)', () => {
    const result = plan(sampleMain, [
      { status: 'A', file: 'packages/db/drizzle/0060_x.sql' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('Migration number 0060 (0060_x.sql) must be strictly greater than origin/main\'s highest migration (0066)'))).toBe(true);
  });

  it('fails when an added migration filename is malformed', () => {
    const cases = [
      '0067-kebab-case.sql',
      '67_unpadded.sql',
      '0067_UpperCase.sql',
      '0067_has space.sql',
      'migration_0067.sql',
    ];

    for (const file of cases) {
      const result = plan(sampleMain, [{ status: 'A', file }]);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e: string) => e.includes(`Migration filename "${file}" is malformed`))).toBe(true);
    }
  });

  it('ignores non-SQL files in PR changes', () => {
    const result = plan(sampleMain, [
      { status: 'M', file: 'packages/db/drizzle/meta/_journal.json' },
      { status: 'A', file: 'packages/db/drizzle/README.md' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('parses raw git diff string format', () => {
    const result = plan(sampleMain, [
      'A\tpackages/db/drizzle/0067_valid_migration.sql',
    ]);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
