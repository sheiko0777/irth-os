## 1. Recommendation: choose (b), but do not make the ERP completely headless

Use ERPNext as the back-office engine for accounting, purchasing, manufacturing, lots/expiry, warehouses, supplier records, and statutory stock movements. Keep the TypeScript system as the commerce control plane: connectors, order intake, orchestration, operational dashboards, customer view, notifications, public API, and MCP façade.

My important disagreement with option (b) as written: do not rebuild every ERP workflow in a bespoke interface. Let the accountant and initially some purchasing/warehouse users work directly in ERPNext. Give the owner a tailored control center and exception queue, but accept that complex accounting configuration, production orders, period close, and stock adjustments belong in the ERP interface.

“Never open Shopify admin again” is achievable. “Nobody ever sees ERPNext” would waste much of the benefit of adopting it.

### Why I would refuse option (a)

A reliable general ledger is not merely journal tables and debit-equals-credit validation. It includes:

- Posting rules for sales, returns, discounts, tax, landed cost, inventory valuation, write-offs, payment fees, and exchange differences.
- Receivables, allocations, credit notes, aging, close controls, locked periods, reversals, audit trails, and numbering.
- Manufacturing consumption, scrap, work in progress, yield variances, and finished-goods costing.
- Lot genealogy, expiry handling, stock transfers, reservations, stock reconciliation, and negative-stock policy.
- Purchasing, partial receipts, supplier returns, three-way matching, and landed costs.
- Consolidation, intercompany transactions, and eliminations.

AI agents accelerate code production. They do not supply the missing accounting policy, validate costing behavior, or discover every ugly correction workflow before month-end.

Six to twelve months would plausibly produce an impressive bespoke beta. It would not produce a system I would trust for statutory books, manufacturing costing, and inventory valuation. For one operator, the honest range is more like 18–36 months followed by permanent maintenance—and the most dangerous defects would be plausible-looking numbers rather than obvious crashes.

ERPNext gives away years of accumulated workflow and correction handling. That is exactly what should be adopted rather than recreated.

### Why ERPNext over Odoo Community

My default would be ERPNext because its open-source core is generally a cleaner fit for the “no recurring application license” constraint and includes more of the accounting/manufacturing/inventory surface without designing around edition boundaries.

I would still run a short, accountant-led fit test before committing. It must prove:

1. The Egyptian chart, tax treatments, fiscal sequences, period close, and required financial statements.
2. Lot/expiry workflows and the actual manufacturing costing scenarios.
3. COD clearing and courier remittance reconciliation.
4. Multi-company accounting and intercompany entries.
5. Arabic documents and the integration point for ETA e-invoicing.

If ERPNext fails that exercise, I would choose another mature ERP—including Odoo if its exact deployment is economically acceptable—not return to bespoke accounting.

The existing ETA integration may remain in TypeScript. ERPNext should finalize the legal sales invoice; the adapter should submit an immutable representation of that invoice to ETA and attach the resulting identifiers/status. Do not keep the current basic ledger as a second accounting system.

### The two-stack cost

Two stacks are a real cost, but much smaller than owning an ERP implementation:

- Two deployment and backup procedures.
- API-version and upgrade compatibility.
- Eventual consistency and stuck-document handling.
- Mapping ERP identifiers to commerce identifiers.
- Users occasionally changing records directly in the ERP.

Control this by keeping ERPNext close to stock, pinning versions, testing upgrades against a restored staging backup, and avoiding core forks. Put an anti-corruption adapter between TypeScript and ERPNext rather than spreading ERPNext document semantics throughout the monorepo.

Do not maintain two peer data models. Maintain authoritative domains plus projections:

| Domain | Authority |
|---|---|
| Legal invoices, GL, AR/AP, period close | ERPNext |
| Physical stock movements, lots, valuation | ERPNext |
| Purchasing and manufacturing | ERPNext |
| External order payloads and channel mappings | TypeScript control plane |
| Omnichannel order orchestration and exceptions | TypeScript control plane |
| Customer interaction history | TypeScript control plane |
| Behavioral analytics | Analytics store |
| Published storefront quantities | Derived projection, never an authority |

The realistic failure mode of the hybrid is synchronization drift. That is visible and reconcilable. The realistic failure mode of bespoke ERP is silently incorrect stock valuation or financial statements. I strongly prefer the former.

---

## 2. Use one canonical order aggregate, not one simplistic lifecycle

Use a common sales-order model for every channel, with channel-specific extensions and preserved raw source payloads. Do not create unrelated `shopify_orders`, `pos_sales`, `b2b_orders`, and `dm_orders` as the operational models; that guarantees four fulfillment and reporting systems.

But also do not put everything into one `status` column. An order has several independent lifecycles:

- Commercial: draft, confirmed, cancelled, completed.
- Fulfillment: unallocated, reserved, picked, shipped, delivered, returned.
- Payment: unpaid, authorized, collected, partially refunded, refunded.
- Invoicing: not invoiced, invoiced, credited.
- COD settlement: courier-held, remitted, short-paid, disputed.
- B2B receivable: current, due, overdue, allocated, written off.

Quotes, orders, shipments, invoices, payments, remittances, and returns should be separate objects connected to the same commercial order.

Channel behavior then becomes policy:

- POS: confirm, fulfill, and collect payment almost together.
- COD: confirm and reserve; ship; recognize delivery; place money into a courier/COD clearing account; allocate the later remittance and fees.
- Online gateway: record gateway transaction separately and reconcile settlement batches and fees.
- B2B: optionally quote first, allow partial deliveries, create an invoice with terms, then manage receipts and aging.
- DM order: manually capture the same canonical order with source attribution and conversation links.

Each order must have one immutable selling legal entity. If a cart includes goods sold by different legal entities, split it into separate legal orders. Do not hide that legal boundary inside reporting.

---

## 3. “The system is master” needs a more honest definition

The system can be master for catalog policy, pricing rules, and desired inventory availability. It cannot be the sole real-time authority over a Shopify checkout that Shopify has already accepted.

Shopify remains authoritative for the fact that a Shopify checkout occurred. ERPNext remains authoritative for physical stock. The control plane coordinates the two.

A robust flow is:

1. ERP stock movements change on-hand stock.
2. Central reservations determine available-to-promise.
3. The control plane computes a desired quantity for each channel.
4. Connectors publish absolute desired quantities, not blind `+1/-1` deltas.
5. A storefront order arrives through webhook plus periodic polling.
6. The order is idempotently imported and reserved centrally.
7. Any failure enters a visible exception queue.
8. Scheduled reconciliation compares source orders, central orders, reservations, and published quantities.

Every connector operation needs:

- An idempotency key.
- Source system and external object ID.
- Source version or update timestamp where available.
- Correlation/causation IDs.
- The last value written by this system.
- An inbox/outbox record and retry state.
- A reconciliation path independent of webhooks.

Echo prevention should not mean “ignore the next webhook.” Compare versions and payload fingerprints and identify whether the incoming change acknowledges a particular outbound command.

Conflict rules must be field-specific. For example:

- Shopify owns Shopify checkout facts.
- ERP owns physical on-hand stock and lot movements.
- The control plane owns channel allocation and desired published availability.
- Refund authorization may be initiated externally, but its ERP posting follows controlled accounting rules.

### POS and Shopify selling simultaneously

There is no distributed transaction spanning a POS terminal, Shopify, and ERPNext. Exactly-once global stock allocation is not a credible promise.

For POS, require an online central reservation before completing the sale. For storefronts, use:

- Channel allocations or safety buffers for scarce products.
- Very fast webhook ingestion.
- Immediate republishing after reservations.
- Conservative availability for fast-moving SKUs.
- An explicit oversell-resolution workflow.

If the same last unit is sold by POS and Shopify within the synchronization window, one order may still oversell. Preventing that absolutely would require central authorization in every checkout path, which ordinary hosted storefront checkout does not offer. The business must choose between occasional oversells and deliberately under-publishing inventory.

Reconciliation is part of the product, not a maintenance afterthought. The owner’s home screen should show discrepancies, stuck syncs, unreserved orders, negative availability, and unmatched settlements.

---

## 4. Tenant at group level; legal entity as a mandatory accounting boundary

Keep one tenant for the whole IRTH group. Do not model each legal entity as an unrelated tenant: that would make cross-entity staff, group customer views, shared operations, and consolidation unnecessarily difficult.

The hierarchy should be:

```text
Tenant/group
  └─ Legal entity
       ├─ Brand
       ├─ Sales channel/account
       └─ Logical warehouse/bins
```

A physical facility shared by companies must still have logically distinct inventory ownership. One shelf location can contain separate entity-owned stock, but the stock ledger cannot treat it as fungible.

Change the existing model from simple `org_id` isolation to:

- `group_id` on every tenant-owned row.
- `legal_entity_id` on all financial, commercial, purchasing, and inventory documents.
- User membership at group level plus entity-specific grants and roles.
- Immutable legal entity once a document has legal or stock consequences.
- Composite constraints preventing lines, warehouses, invoices, and journals from accidentally crossing entities.
- Company-specific numbering, fiscal periods, currencies, tax registrations, and close locks.
- Explicit intercompany sale/purchase pairs and consolidation eliminations.

Brands and channels are dimensions, not security or accounting boundaries. A brand can theoretically move between entities; a posted invoice cannot.

RLS should continue to enforce group isolation, but group-only RLS is insufficient. Entity-scoped permissions should restrict accountants or operators where required. Supplier users need a separate external-principal policy granting access only to documents involving their supplier account—not merely membership in the group.

The reflection-based RLS and tenancy tests are worth preserving and extending. The existing `org_id` can conceptually become `group_id`; this does not require throwing away the security approach.

---

## 5. Postgres is enough initially—if behavioral events do not abuse the OLTP database

For this company’s likely traffic, Postgres can support operational analytics and early behavioral analytics for a substantial period. The mistake would be mixing unlimited raw clickstream scans with order posting, stock reservations, and financial work on the same constrained compute.

Use a separate analytics database or at least separately scalable storage. Ingest events asynchronously and in batches. Store:

- Event name and occurred/received times.
- Brand, channel, session, anonymous identity, and known customer identity.
- Product/order references.
- A small set of indexed common dimensions.
- Additional properties in JSON.
- Consent and data-retention metadata.

Partition raw events by time. Build hourly/daily funnel and revenue aggregates. Keep recent raw events for a defined period—perhaps 90–180 days—and retain compact aggregates longer.

Postgres has no universal numeric ceiling, but I would start planning an exit when any of these appear:

- Raw behavioral data reaches tens of millions of rows and approaches roughly 100 GB.
- Sustained ingestion reaches hundreds of events per second.
- Autovacuum, backups, or analytical scans affect operational latency.
- Most useful questions require repeatedly scanning raw events.
- Event-storage and I/O costs exceed the cost of a purpose-built store.

A small Egyptian multi-brand retailer may remain below that point for years if bots are filtered and retention is controlled.

The cheapest credible escape hatch is:

1. Export older raw events to Parquet in inexpensive object storage such as R2.
2. Keep current events and aggregates in Postgres.
3. Use DuckDB for periodic historical analysis.
4. Add self-hosted ClickHouse on a separate VPS only when interactive raw-event analysis justifies its operational burden.

I would not self-host a large CDP stack on day one. “Free software” that requires several databases and constant maintenance is not cheap for a solo operator.

---

## 6. What I would cut or defer

The first release should complete one closed operational loop:

- Unified SKU/item mapping.
- All storefront orders imported reliably.
- Central stock and reservations.
- Bidirectional storefront inventory publication.
- Picking, shipping, delivery, returns, and cancellation.
- COD and gateway settlement reconciliation.
- ERP sales, stock, and accounting documents.
- Reconciliation and exception queues.
- A concise live owner dashboard.

Then add purchasing, manufacturing, lots/expiry, and financial close in controlled increments.

I would explicitly refuse or defer the following:

- **Bespoke statutory accounting.** ERPNext should own the books.
- **A completely bespoke ERP front end.** Use ERP screens for deep accounting and manufacturing workflows.
- **A custom offline-capable POS.** Use ERPNext POS or integrate an existing POS first. Offline synchronization is a project by itself.
- **A custom supplier portal.** Start with ERPNext’s portal/document workflows and branded email/PDFs.
- **Unified social inbox and identity resolution.** Meta permissions, changing APIs, identity ambiguity, and conversation-state handling make this disproportionately expensive. Link conversations manually before attempting full automation.
- **Universal social publishing and analytics.** Add specific high-value platform integrations later.
- **A general connector-building platform.** Build a small adapter contract and the three connectors actually needed. Do not build Zapier.
- **MCP as the transaction backbone.** The public API, webhooks, authentication, idempotency, permissions, and audit model come first. MCP should be a thin façade over the same approved application commands. Provider MCP servers are optional adapters, not reliable accounting infrastructure.
- **Pixel-level analytics perfection.** Begin with product, cart, checkout, purchase, and campaign-attribution events.
- **The Expo application unless scanning or warehouse mobility immediately requires it.** A responsive web application is sufficient initially.
- **Exactly-once cross-platform synchronization.** Promise idempotent at-least-once processing plus reconciliation instead.
- **A single magical customer profile that automatically merges every phone, Instagram account, marketplace identity, and email.** Store identities and suggest merges; do not silently merge them.

The owner can truthfully say “I run my business from this” when the system controls orders, availability, fulfillment, cash reconciliation, purchasing, stock, and financial visibility—and when exceptions are surfaced without opening each storefront admin.

He does not need every communication channel, social tool, and workflow rebuilt before that statement becomes true. The architecture should optimize for closing business loops, not accumulating feature checkboxes.