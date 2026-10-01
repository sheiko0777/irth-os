/**
 * CX-07: only one place may turn a connection secret back into plaintext.
 *
 * decryptSecret / getConnectionSecret (packages/db/src/secrets.ts) and the
 * API's readConnectionSecret (src/integrations/kernel/secrets.ts) may be named
 * only in those two places. Any other source file in apps/api, apps/admin or
 * packages/db that names them fails the build — same shape as tenancyGate:
 * read the sources with node:fs, no DB, so it gates the PR.
 * Test files are exempt (they exercise the kernel).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const ROOTS = ['apps/api/src', 'apps/admin/src', 'packages/db/src'];
const ALLOWED = [/^packages\/db\/src\/secrets\.ts$/, /^apps\/api\/src\/integrations\/kernel\//];
const DECRYPT = /\b(decryptSecret|getConnectionSecret|readConnectionSecret)\b/g;

function decryptViolations(relPath: string, source: string): string[] {
  if (/(^|\/)__tests__\//.test(relPath) || ALLOWED.some((re) => re.test(relPath))) return [];
  const out: string[] = [];
  for (const m of source.matchAll(DECRYPT)) {
    const line = source.slice(0, m.index).split('\n').length;
    out.push(`${relPath}:${line} ${m[1]}`);
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name === '.next') return [];
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|mts)$/.test(e.name) ? [full] : [];
  });
}

describe('secrets import gate', () => {
  it('fails on a file outside the kernel that names the decrypt path', () => {
    const fixture = "import { decryptSecret } from '@irth/db/src/secrets';\nconst t = await decryptSecret(k, a, s);\n";
    expect(decryptViolations('apps/api/src/routes/leaky.ts', fixture)).toEqual([
      'apps/api/src/routes/leaky.ts:1 decryptSecret',
      'apps/api/src/routes/leaky.ts:2 decryptSecret',
    ]);
    expect(decryptViolations('apps/admin/src/server/routers/x.ts', 'readConnectionSecret(tx, a)')).toHaveLength(1);
    expect(decryptViolations('apps/api/src/integrations/kernel/secrets.ts', fixture)).toEqual([]);
  });

  it('no source file outside the kernel names decryptSecret / getConnectionSecret / readConnectionSecret', () => {
    const files = ROOTS.flatMap((root) => sourceFiles(path.join(REPO, root)));
    expect(files.length).toBeGreaterThan(100);
    const violations = files.flatMap((file) => {
      const rel = path.relative(REPO, file).split(path.sep).join('/');
      return decryptViolations(rel, readFileSync(file, 'utf8'));
    });
    expect(violations, `decrypt path used outside the kernel:\n  ${violations.join('\n  ')}`).toEqual([]);
  }, 120_000); // walks three source trees; slow on a cold Windows disk
});
