#!/usr/bin/env node
/**
 * Diagnostic script to find non-EGP currency rows across all tables in the database.
 * Run inside a strictly READ-ONLY transaction.
 */

import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

// Table/Column mappings
const targets = [
  { table: 'organizations', column: 'presentation_currency' },
  { table: 'products', column: 'currency' },
  { table: 'orders', column: 'currency' },
  { table: 'orders', column: 'presentment_currency' },
  { table: 'customers', column: 'currency' },
  { table: 'customer_brand_relationships', column: 'currency' },
  { table: 'rep_cash_handovers', column: 'currency' },
  { table: 'rep_cash_collections', column: 'currency' },
  { table: 'sales_quotes', column: 'currency' },
  { table: 'legal_entities', column: 'functional_currency' },
  { table: 'channels', column: 'currency' },
  { table: 'gift_cards', column: 'currency' },
  { table: 'journal_lines', column: 'currency' },
  { table: 'journal_lines', column: 'functional_currency' },
  { table: 'order_source_transactions', column: 'currency' },
  { table: 'price_lists', column: 'currency' },
  { table: 'purchase_orders', column: 'currency' },
  { table: 'supplier_payments', column: 'currency' },
];

async function main() {
  let hasNonEGP = false;

  await sql.begin('READ ONLY', async (tx) => {
    console.log("TABLE".padEnd(32) + "COLUMN".padEnd(25) + "CURRENCY  COUNT");
    console.log("-".repeat(70));

    for (const { table, column } of targets) {
      // Find counts grouped by currency where it's not EGP
      const rows = await tx.unsafe(`
        SELECT "${column}" as currency, count(*) as count
        FROM "${table}"
        WHERE "${column}" IS NOT NULL AND "${column}" != 'EGP'
        GROUP BY "${column}"
        ORDER BY count DESC
      `);

      if (rows.length > 0) {
        hasNonEGP = true;
        for (const row of rows) {
          console.log(`${table.padEnd(32)}${column.padEnd(25)}${row.currency.padEnd(10)}${row.count}`);

          // Print sample rows ids (max 10)
          let sampleRows = [];
          if (table === 'journal_lines') {
            sampleRows = await tx.unsafe(`
              SELECT entry_id as id
              FROM "${table}"
              WHERE "${column}" = $1
              LIMIT 10
            `, [row.currency]);
          } else if (table === 'customer_brand_relationships') {
            sampleRows = await tx.unsafe(`
              SELECT customer_id as id
              FROM "${table}"
              WHERE "${column}" = $1
              LIMIT 10
            `, [row.currency]);
          } else {
            sampleRows = await tx.unsafe(`
              SELECT id
              FROM "${table}"
              WHERE "${column}" = $1
              LIMIT 10
            `, [row.currency]);
          }
          const sampleIds = sampleRows.map(r => r.id).join(', ');
          console.log(`  -> Sample IDs: ${sampleIds}`);
        }
      }
    }

    console.log("\nChecking for journal_entries whose lines contain more than one distinct currency...");
    const mixedJournalEntries = await tx`
      SELECT entry_id, count(DISTINCT currency) as currency_count
      FROM journal_lines
      GROUP BY entry_id
      HAVING count(DISTINCT currency) > 1
    `;

    if (mixedJournalEntries.length > 0) {
      hasNonEGP = true;
      console.log(`Found ${mixedJournalEntries.length} journal_entries with mixed currencies.`);

      const samples = mixedJournalEntries.slice(0, 10);
      for (const row of samples) {
        console.log(`  -> Entry ID: ${row.entry_id} (Currencies: ${row.currency_count})`);
      }
    } else {
      console.log("No journal_entries with mixed currencies found.");
    }
  });

  console.log("\n" + "-".repeat(70));
  if (hasNonEGP) {
    console.log("NON-EGP ROWS FOUND");
    process.exit(2);
  } else {
    console.log("CLEAN");
    process.exit(0);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
}).finally(() => {
  sql.end({ timeout: 5 });
});
