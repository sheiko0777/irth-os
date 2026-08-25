/**
 * Fails the build if a route returns a payload that JSON.stringify would throw
 * on.
 *
 * WHY
 *
 * `c.json()` calls JSON.stringify, which does not merely render BigInt oddly —
 * it throws:
 *
 *     TypeError: Do not know how to serialize a BigInt
 *
 * Money became bigint minor units in migration 0028. Before that, Drizzle
 * returned `decimal` columns as strings, so every route that returned a row
 * worked by accident. After it, every route returning money is a 500 at
 * runtime. apps/admin is unaffected only because tRPC is configured with
 * superjson; nothing in this app had an equivalent.
 *
 * Payloads must be `null`, or wrapped in `jsonSafe(...)` from @irth/db.
 *
 * WHY A SCANNER RATHER THAN A REGEX
 *
 * The first pass at this was `c\.json\(\{\s*data:\s*([^,]+?),`. It missed the
 * SHORTHAND form — `c.json({ data, error: null })` — which is exactly what the
 * product list endpoint used, so the list of every product came back
 * unwrapped and crashing while the check reported clean. `[^,]+?` also stops at
 * the first comma, so on an object-literal payload it captured half an
 * expression and produced `jsonSafe({ product), variants }` — a syntax error.
 *
 * A check that a line break or a comma can defeat is not a check.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../routes');

/** Reads the `data` property's source text out of each `c.json({...})` call. */
function dataPayloads(source: string): { text: string; line: number }[] {
  const found: { text: string; line: number }[] = [];
  const NEEDLE = 'c.json(';

  for (let i = source.indexOf(NEEDLE); i !== -1; i = source.indexOf(NEEDLE, i + 1)) {
    // Walk to the matching close paren, tracking depth and skipping literals so
    // a brace or quote inside a string cannot end the scan early.
    let depth = 0;
    let j = i + NEEDLE.length - 1;
    let end = -1;
    for (; j < source.length; j++) {
      const ch = source[j];
      if (ch === '"' || ch === "'" || ch === '`') {
        const quote = ch;
        j++;
        while (j < source.length && source[j] !== quote) {
          if (source[j] === '\\') j++;
          j++;
        }
        continue;
      }
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      else if (ch === ')' || ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) { end = j; break; }
      }
    }
    if (end === -1) continue;

    const call = source.slice(i, end + 1);
    const line = source.slice(0, i).split('\n').length;

    // Shorthand `{ data, ... }` — the form the original regex could not see.
    if (/\{\s*data\s*[,}]/.test(call)) {
      found.push({ text: 'data (shorthand)', line });
      continue;
    }

    const m = /\bdata\s*:/.exec(call);
    if (!m) continue;

    // Take the value by depth from the colon to its terminating comma.
    let d = 0;
    let k = m.index + m[0].length;
    const start = k;
    for (; k < call.length; k++) {
      const ch = call[k];
      if (ch === '(' || ch === '{' || ch === '[') d++;
      else if (ch === ')' || ch === '}' || ch === ']') { if (d === 0) break; d--; }
      else if (ch === ',' && d === 0) break;
    }
    found.push({ text: call.slice(start, k).trim(), line });
  }

  return found;
}

const isSafe = (payload: string) =>
  payload === 'null' || payload.startsWith('jsonSafe(');

function routeFiles(): string[] {
  return readdirSync(ROUTES).filter((f) => f.endsWith('.ts'));
}

describe('serialization gate', () => {
  it('has routes to scan', () => {
    // A scanner over an empty list passes everything without reading a byte.
    expect(routeFiles().length).toBeGreaterThan(3);
  });

  it('wraps every route payload so JSON.stringify cannot throw on bigint', () => {
    const offenders: string[] = [];

    for (const file of routeFiles()) {
      const source = readFileSync(path.join(ROUTES, file), 'utf8');
      for (const { text, line } of dataPayloads(source)) {
        if (!isSafe(text)) offenders.push(`${file}:${line} -> ${text}`);
      }
    }

    expect(
      offenders,
      'These payloads reach JSON.stringify unwrapped. If any field is a bigint ' +
        '(every money column is, since 0028) the endpoint throws at runtime. ' +
        'Wrap with jsonSafe(...) from @irth/db:\n  ' + offenders.join('\n  '),
    ).toEqual([]);
  });

  it('detects the shapes it claims to detect', () => {
    // The gate must be able to fail, including on the two forms that defeated
    // the regex this replaced.
    const shorthand = 'return c.json({ data, error: null, meta: null });';
    const multiline = 'return c.json({\n  data,\n  error: null,\n});';
    const bare = 'return c.json({ data: rows, error: null });';
    const wrapped = 'return c.json({ data: jsonSafe(rows), error: null });';
    const nullish = 'return c.json({ data: null, error: 42 });';
    const objectLiteral = 'return c.json({ data: jsonSafe({ product, variants }), error: null });';

    expect(dataPayloads(shorthand).every((p) => !isSafe(p.text))).toBe(true);
    expect(dataPayloads(multiline).every((p) => !isSafe(p.text))).toBe(true);
    expect(dataPayloads(bare).every((p) => !isSafe(p.text))).toBe(true);

    // ...and must NOT trip on correct code, or it is unusable.
    expect(dataPayloads(wrapped).every((p) => isSafe(p.text))).toBe(true);
    expect(dataPayloads(nullish).every((p) => isSafe(p.text))).toBe(true);
    // The comma inside the object literal must not truncate the payload.
    expect(dataPayloads(objectLiteral)[0].text).toBe('jsonSafe({ product, variants })');
  });
});
