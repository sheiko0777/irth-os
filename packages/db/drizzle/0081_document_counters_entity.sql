-- 0081: document counters keyed per (org, legal entity, kind) — DM-04.
--
-- WHY THIS EXISTS
--
-- 0036 gave each tenant one gapless series per document kind, keyed
-- (org_id, kind). DM-01 (0069) split the org into legal entities, and every
-- statutory series (invoices, credit notes, ...) belongs to the entity that
-- issues it, not to the group: two entities in one org must each run their own
-- independent, gapless series. So the key becomes (org_id, legal_entity_id,
-- kind).
--
-- BACKFILL
--
-- Every existing counter row is re-keyed to its org's default entity
-- (organizations.stock_owner_entity_id, seeded for every org by 0069), so the
-- default entity simply continues the series it already had: the next order
-- after this migration is last_value + 1, exactly as before. Nullable column ->
-- backfill -> SET NOT NULL, so this runs on the existing database.
--
-- The entity FK is the composite (legal_entity_id, org_id) -> legal_entities
-- (id, org_id) from 0069, so a counter row for another org's entity is
-- unrepresentable.
--
-- RLS (ENABLE + FORCE + the NULLIF tenant policy on org_id) and the grants
-- (SELECT/INSERT/UPDATE, DELETE revoked) from 0036 are untouched: the table is
-- altered in place, not recreated, and the policy predicate is still org_id.
--
-- `kind` stays text (0036: adding a kind is a code change, not a migration).
-- DocumentKind in packages/db/src/index.ts is the vocabulary.

ALTER TABLE "org_document_counters" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint

UPDATE "org_document_counters" c SET "legal_entity_id" = o."stock_owner_entity_id"
  FROM "organizations" o WHERE o."id" = c."org_id";--> statement-breakpoint

ALTER TABLE "org_document_counters" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "org_document_counters" ADD CONSTRAINT "org_document_counters_entity_same_org_fk"
  FOREIGN KEY ("legal_entity_id", "org_id") REFERENCES "legal_entities"("id", "org_id");--> statement-breakpoint

ALTER TABLE "org_document_counters" DROP CONSTRAINT "org_document_counters_pkey";--> statement-breakpoint
ALTER TABLE "org_document_counters" ADD CONSTRAINT "org_document_counters_pkey"
  PRIMARY KEY ("org_id", "legal_entity_id", "kind");
