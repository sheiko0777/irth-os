-- Idempotent per 0052's established pattern for named constraints: drop-then-add
-- is the only form whose result does not depend on what was already there under
-- the name (see 0052's own note on this) -- a bare ADD CONSTRAINT instead fails
-- loudly if this file is ever re-applied against a database that already has it.
ALTER TABLE public.return_items
  DROP CONSTRAINT IF EXISTS return_items_order_item_id_order_items_id_fk;--> statement-breakpoint

ALTER TABLE public.return_items
  ADD CONSTRAINT return_items_order_item_id_order_items_id_fk
  FOREIGN KEY (order_item_id) REFERENCES public.order_items(id);
