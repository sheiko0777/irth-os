# Operations Foundation

This delivery establishes the first operating boundary for the IRTH unified
control centre. It is deliberately read-safe: no order allocation, stock
deduction, external synchronization, or accounting posting is introduced here.

## Included

- Named access profiles with allow, deny, and screen rules.
- Per-member profile assignment, individual overrides, job title, and warehouse scope.
- Owner-only profile administration with audit entries for profile and assignment changes.
- Warehouses, inventory lots, expiry dates, available/reserved balances, and an FEFO index.
- A responsive operations screen for creating warehouses and receiving lots.
- IRTH Intelligence observes the same effective permission policy as tRPC.

## Security rules

- Organization scope always comes from the authenticated membership, never the browser or the model.
- An explicit deny wins over a role, profile, or individual allow.
- A profile is an allow-list; assigning one removes inherited broad member access.
- Warehouse-scoped members cannot query pre-existing organization-wide inventory rows because those rows have no reliable warehouse attribution. They use the lot ledger instead.
- The assistant does not expose that legacy aggregate to warehouse-scoped members.

## Deployment

1. Apply database migration `packages/db/drizzle/0049_access_profiles_and_warehouses.sql` through the normal production migration process.
2. Existing organizations receive one default warehouse named `المخزن الرئيسي` with code `MAIN`. Historic inventory is intentionally not moved into it.
3. An owner creates the relevant access profiles, assigns each member's profile and warehouse scope, then validates the member's next request.
4. Keep `GROQ_API_KEY` only in the API Worker secret store. Setup remains documented in `IRTH_INTELLIGENCE.md`; no admin or browser environment variable is needed.

## Next operating increments

1. Reserve, allocate, transfer, and consume lot balances atomically from order fulfillment.
2. Add brands, channels, and idempotent inbound Shopify event processing to the shared operation pipeline.
3. Add supplier and courier partner memberships with their own scoped portals.
4. Post approved fulfillment, payment, and return events to the accounting ledger.
