-- 0042: Close the last tenant-ownership gaps + reconcile Drizzle with the DB.
--
-- ARCHAEOLOGY FIRST, because two earlier migrations already did most of this
-- work at the database level:
--
--   * 0027's DO-block added `org_id REFERENCES organizations(id) ON DELETE
--     CASCADE` (named `<table>_org_id_organizations_id_fk`) to 15 tables, and
--     created their leading-org_id indexes.
--   * 0030 added `*_org_id_fk` + `*_org_id_idx` to purchase_order_items and
--     return_items, plus the composite child-table FKs.
--   * 0006 / 0011 / 0012 created the remaining org_id indexes (0012's
--     `CREATE INDEX ON suppliers(org_id)` auto-named itself
--     `suppliers_org_id_idx`).
--
-- So the ONLY database-level gap left is five tables whose org_id was still a
-- bare column: idempotency_keys, org_feature_flags, journal_lines,
-- org_document_counters, order_returns. This file adds those five FKs, using
-- drizzle's own default constraint-name pattern so a future drizzle-kit
-- introspection sees no diff.
--
-- The rest of this wave's work is in packages/db/src/schema/*: declaring the
-- .references() and index definitions the database has had all along, so the
-- schema files stop lying about what the database enforces. `public` is empty
-- today, so plain validated ALTERs are safe; once real rows exist this becomes
-- ADD CONSTRAINT ... NOT VALID + VALIDATE CONSTRAINT.

ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org_feature_flags" ADD CONSTRAINT "org_feature_flags_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org_document_counters" ADD CONSTRAINT "org_document_counters_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
