import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchStatus } from '@irth/domain';

/** OR-14 Shopify fixture matrix: one directory per scenario. */
const ROOT = fileURLToPath(new URL('../fixtures/shopify', import.meta.url).href);

export function listFixtures(): string[] {
  return readdirSync(ROOT).filter((name) => statSync(join(ROOT, name)).isDirectory());
}

function readJson(dir: string, file: string): any {
  return JSON.parse(readFileSync(join(ROOT, dir, file), 'utf8'));
}

export function loadFixture(name: string) {
  return {
    expectedCandidate: readJson(name, 'expected.candidate.json'),
    expectedValidation: readJson(name, 'expected.validation.json') as {
      /** Partial FetchStatus for this scenario; omitted keys default to loaded / complete. */
      fetchStatus?: FetchStatus;
      blockers: Array<{ code: string; section: string }>;
      sections: Record<string, { status: string }>;
    },
  };
}
