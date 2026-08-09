/**
 * Rule 1 gate: money is an integer count of minor units (CLAUDE.md).
 *
 * `numeric`/`decimal` money columns are the source of every float defect in
 * this repo — VAT computed as `Number(total) * 0.14`, lifetime revenue via
 * `parseFloat(x).toFixed(2)`, line totals that do not sum to the header. This
 * test makes a *new* one impossible to merge.
 *
 * It is a ratchet, not a snapshot. `KNOWN_DECIMAL_MONEY` lists the columns that
 * predate the rule. The assertion is equality, not subset, so:
 *   - adding a decimal money column fails (it is not in the list)
 *   - converting one to bigint without shrinking the list also fails
 * Either way the list can only move toward empty. When it *is* empty, delete it
 * and the rule enforces itself.
 *
 * Runs on source text, with no database, so it gates a PR rather than a deploy.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Columns that are legitimately fractional: physical quantities and rates.
 * A weight really is 1.250 kg. A rate should become basis points (rule 1 says
 * rates are integers), but it is not *money*, so it is out of scope here and
 * tracked separately rather than hidden in the money allowlist.
 */
const NOT_MONEY = /weight|percent|ratio|rate$|_rate|qty|quantity|score|length|width|height/i;

/** Name fragments that mean "this column holds an amount of money". */
const IS_MONEY =
  /price|amount|cost|balance|total|revenue|spent|refund|fee|subtotal|value|credit|debit|paid|due|salary|discount/i;

/**
 * Decimal money columns that existed before this gate. Every entry is a defect
 * scheduled for conversion to `bigint` minor units. Shrink this list; never
 * grow it.
 */
const KNOWN_DECIMAL_MONEY: readonly string[] = [
  'coupons.min_order_amount',
  'coupons.value',
  'courier_remittances.amount',
  'courier_shipments.cod_amount',
  'customers.total_spent',
  'gift_card_transactions.amount',
  'gift_cards.balance',
  'gift_cards.initial_amount',
  'order_items.price',
  'order_returns.refund_amount',
  'orders.total_amount',
  'price_list_items.price',
  'product_variants.price',
  'products.price',
  'purchase_order_items.unit_cost',
  'purchase_orders.total_amount',
  'return_items.unit_price',
  'shipping_rates.max_order_value',
  'shipping_rates.min_order_value',
  'shipping_rates.price',
];

type Column = { table: string; column: string; type: string; file: string };

async function schemaFiles(): Promise<string[]> {
  const nested = await readdir(path.join(SRC, 'schema'));
  return [
    path.join(SRC, 'schema.ts'),
    ...nested.filter((f) => f.endsWith('.ts')).map((f) => path.join(SRC, 'schema', f)),
  ];
}

/**
 * Attributes each decimal column to its enclosing `pgTable` so the key is a
 * stable `table.column`. Keying on line numbers instead would make every
 * unrelated edit above a column look like a new violation.
 *
 * Matching runs over the whole source by character offset rather than line by
 * line, because both call styles are in use here:
 *
 *   pgTable('orders', { … })            // schema.ts
 *   pgTable(\n  'coupons',\n  { … })     // schema/coupons.ts
 *
 * A line-scoped regex silently misses the second form, and a column whose table
 * never resolved would land in the report as `<none>.value` — which is exactly
 * what the first test in this file exists to catch.
 */
function parseDecimalColumns(source: string, file: string): Column[] {
  const tables = [...source.matchAll(/pgTable\(\s*['"]([a-z0-9_]+)['"]/gi)].map((m) => ({
    name: m[1],
    at: m.index ?? 0,
  }));

  return [...source.matchAll(/\b(numeric|decimal)\s*\(\s*['"]([a-z0-9_]+)['"]/gi)].map((m) => {
    const at = m.index ?? 0;
    // The enclosing table is the last one declared before this column.
    const owner = [...tables].reverse().find((t) => t.at < at);
    return {
      table: owner?.name ?? '<none>',
      column: m[2],
      type: m[1],
      file,
    };
  });
}

async function allDecimalColumns(): Promise<Column[]> {
  const files = await schemaFiles();
  const out: Column[] = [];
  for (const file of files) {
    out.push(...parseDecimalColumns(await readFile(file, 'utf8'), path.basename(file)));
  }
  return out;
}

const isMoney = (c: Column) => IS_MONEY.test(c.column) && !NOT_MONEY.test(c.column);
const key = (c: Column) => `${c.table}.${c.column}`;

describe('rule 1 — money is bigint minor units', () => {
  it('parses the schema it claims to guard', async () => {
    const columns = await allDecimalColumns();
    // If the parser silently matched nothing, every assertion below would pass
    // vacuously and the gate would be decorative.
    expect(columns.length).toBeGreaterThan(0);
    expect(columns.every((c) => c.table !== '<none>')).toBe(true);
  });

  it('has no decimal money column outside the known list', async () => {
    const violations = (await allDecimalColumns()).filter(isMoney).map(key).sort();
    const known = [...KNOWN_DECIMAL_MONEY].sort();

    const added = violations.filter((v) => !known.includes(v));
    expect(
      added,
      `New decimal/numeric money column(s). Money is bigint minor units — see CLAUDE.md rule 1:\n  ${added.join('\n  ')}`,
    ).toEqual([]);

    const converted = known.filter((k) => !violations.includes(k));
    expect(
      converted,
      `Converted to bigint but still listed as a known defect. Remove from KNOWN_DECIMAL_MONEY:\n  ${converted.join('\n  ')}`,
    ).toEqual([]);
  });

  it('treats weights and rates as non-money', async () => {
    const nonMoney = (await allDecimalColumns())
      .filter((c) => !isMoney(c))
      .map(key)
      .sort();
    // Guards the classifier itself: if IS_MONEY were widened until it swallowed
    // these, the previous test would start reporting false violations.
    expect(nonMoney).toEqual([
      'price_lists.discount_percent',
      'shipping_rates.max_weight',
      'shipping_rates.min_weight',
    ]);
  });
});
