-- 0068: 'submitting' claim state for eta_invoices (+ ETA's own 'invalid').
--
-- Every issuer (outbox worker, admin submit, admin submitPending) now claims
-- the row with status 'submitting' BEFORE calling ETA -- see
-- packages/db/src/etaClaim.ts. Without a claim, two issuers racing for the same
-- order could each file a tax invoice. 'invalid' is a real ETA document status
-- that eta.checkStatus already writes (status.toLowerCase()), which the 0044
-- CHECK rejected.
ALTER TABLE "eta_invoices" DROP CONSTRAINT "eta_invoices_status_check";
--> statement-breakpoint
ALTER TABLE "eta_invoices" ADD CONSTRAINT "eta_invoices_status_check"
  CHECK (status IN ('pending','submitting','submitted','valid','invalid','rejected','cancelled','error'));
