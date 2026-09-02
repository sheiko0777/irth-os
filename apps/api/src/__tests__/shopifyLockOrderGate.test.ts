/**
 * The Shopify orders/create handler must take its inventory row locks in an
 * order that is stable ACROSS requests.
 *
 * WHY A STATIC GATE RATHER THAN ONLY A BEHAVIOURAL TEST
 *
 * The behavioural proof lives in apps/admin's integration suite
 * (idempotency.test.ts, "concurrent orders with inverse line-item order").
 * That test mirrors this handler rather than importing it — apps/admin cannot
 * reach into apps/api — so on its own it proves the PATTERN works and says
 * nothing about whether production still uses it. Delete the sort here and
 * that suite stays green.
 *
 * This is the same split, and the same reasoning, as revenuePostingGate.test.ts:
 * one test proves the behaviour, one proves the shipped code performs it.
 *
 * WHAT BREAKS WITHOUT IT
 *
 * Every line taken by the shortfall path holds a row lock on inventory_items
 * from its FOR UPDATE through its UPDATE. Shopify chooses the order of
 * line_items, so orders [X,Y] and [Y,X] deadlock: one transaction holds X
 * waiting for Y while the other holds Y waiting for X. Measured against real
 * Postgres, 12/12 trials deadlocked in payload order and 0/12 sorted.
 *
 * That abort is not a harmless retry. recordDelivery commits its dedup row
 * before the work transaction, so Shopify's redelivery is answered
 * `alreadyProcessed` and the order is never created at all.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HANDLER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../routes/webhooks/shopify.ts',
);

describe('Shopify orders/create takes inventory locks in a stable order', () => {
  const src = readFileSync(HANDLER, 'utf8');

  it('sorts line items before the loop that locks inventory rows', () => {
    // Matches a sort applied to a copy of payload.line_items. Deliberately not
    // pinned to the exact comparator — the requirement is "sorted by something
    // stable across requests", not one specific key.
    const SORTS_LINE_ITEMS = /\[\s*\.\.\.\s*payload\.line_items\s*\]\s*\.sort\s*\(/;

    expect(
      SORTS_LINE_ITEMS.test(src),
      'payload.line_items must be sorted before the inventory loop, or two orders '
        + 'sharing variants in opposite order deadlock and one is silently dropped',
    ).toBe(true);
  });

  it('iterates the sorted copy, not payload.line_items directly', () => {
    // Sorting into a variable and then looping over the original would pass the
    // check above while changing nothing — the failure mode a naive gate has.
    expect(
      /for\s*\(\s*const\s+\w+\s+of\s+payload\.line_items\s*\)/.test(src),
      'the inventory loop still iterates payload.line_items directly, so the sort '
        + 'above it has no effect on lock order',
    ).toBe(false);
  });

  it('still holds the shortfall read under FOR UPDATE', () => {
    // The lock ordering above only matters because this lock exists; if the
    // FOR UPDATE were dropped, the oversell race it prevents comes back.
    expect(
      /\.for\(\s*'update'\s*\)/.test(src),
      'the shortfall read must stay FOR UPDATE, or concurrent deliveries drive '
        + 'inventory negative (measured: 2/40 trials, as low as -2)',
    ).toBe(true);
  });
});
