# IRTH OS — Business Operating System: integrated re-architecture plan

> **Status:** v1 complete (2026-09-17). Integrated by Claude from six repo-verified domain reconciliations (DM/OR/IN/CX/AN/DL), the sol + astra Codex reviews and the 9-agent synthesis; every task packet exists in full. Only §9's visual direction is provisional until astra runs (OpenAI cap lifts 2026-09-19 22:54; brief ready, task UI-00).
> **Goal coverage check:** G1 CX-08/23/24/26 · G2 CX-22/24 · G3 OR-04…22, CX-12, IN-06 · G4 AN-13…22 · G5 AN-*, ScopeSwitcher · G6 CX-03, role shells, S4 workbench, CX-20/IN-22 · G7 CX-27 (Meta; TikTok not promised) · G8 CX-05/06 · G9 DM-10, AN-05, DM-20/21 · G10 modular monolith, CX-04, CX-10 · G11 OR parity contract · G12 zero paid tools · G13 DM-03/20/21/23, ACC-02 · G14 IN-01…13 · G15 OR-20, IN-06/18 · G16 S1 Shopify+COD → S2 Woo/manual/POS → S3 B2B/gateways/bank/credit · G17 DM-02/03/06/09/10 · G18 §7–8 · G19 §9.
> **For agentic workers:** every task below is a self-contained packet (files, reuse pointers, acceptance, tests). Execute with `superpowers:subagent-driven-development` or hand the packet to Codex/Jules/Hermes via the GitHub issue that mirrors it (section 8).

---

## 1. Context — why this plan exists

The owner runs an Egyptian consumer-goods group: parent brand **IRTH** + **3 legally separate brands**, one operations team, one management. Today the business runs on the Shopify dashboard + WhatsApp + paper. The existing `irth-os` repo (pnpm/Turborepo: Hono on Cloudflare Workers, Next.js 15 admin on Vercel, Drizzle + Neon Postgres, tRPC, Better Auth) is **not in production** and was judged by the owner as "a UI over a database": no active management tools, no live analytics, no real accounting, nowhere to see profit/cost. The concrete failure that triggered the re-plan: **a real Shopify order arrived and the admin showed only the order number and price** — no items, no customer, no address.

Root cause (verified in code): `packages/db/src/schema.ts` `orders` has 7 business columns; `apps/api/src/routes/webhooks/shopify.ts` inserts only those (L540-549) and drops unmatched SKUs at L354-358 because `order_items.variant_id` is NOT NULL; no raw payload or customer/address/money snapshot is kept; the order page renders only what exists. Nothing in the pipeline can *represent* a complete order, so no UI could show one.

What the owner wants (goals G1–G19, all must be covered or explicitly deferred):
- **G1** vendor-independent: every provider pluggable via API keys + MCP, both directions · **G2** the system exposes its own MCP server + public API · **G3** one place to run everything — "never open the Shopify admin again" · **G4** live storefront events + customer-behaviour analytics in-system · **G5** admin sees all departments/employees/warehouses/sales/sites · **G6** each employee class has its own screens + permissions; the accountant does *all* accounting in-system; ops own screens; suppliers get portal accounts · **G7** social publish + analytics + inbox in-system · **G8** full filterable audit log · **G9** clean extensible architecture with active tools, analytics, accounting, profit/cost tracking · **G10** smooth not complex; no external tools day-to-day; secure · **G11** everything the Shopify/any admin panel shows must be available in ours — a real order must show full details incl. customer · **G12** cheapest possible · **G13** full statutory books per entity + consolidated + ETA · **G14** buy-resell + manufacturing/packaging + lots/expiry · **G15** orders + inventory live from every storefront, bidirectional inventory sync · **G16** channels: storefronts (Shopify + WooCommerce, 3+ domains), WhatsApp/IG DM, physical shop POS, wholesale B2B; payments: COD, gateways, bank/InstaPay, credit · **G17** EGP + EUR + Gulf; parent owns stock and sells to brands; one group-level customer profile · **G18** the plan is task-distributed for parallel execution by Codex/Jules/Hermes + Claude, one connected structure · **G19** modern, impressive, mobile-first UI.

### Inputs consulted (all read in full)
| Source | What it contributed |
|---|---|
| 9-agent research + audit workflow (`synthesis-core.json`, `agent-summaries.json`) | ERP primitives (party table, template/variant + per-channel listing, stock-move ledger + cache, separate valuation, immutable posted-document→journal boundary, dimensions on posting lines); multi-entity patterns (ERPNext/Odoo); 36-module map; codebase audit (what exists, what is missing) |
| Codex **sol** architecture review (`docs/delivery/research/codex-sol-architecture-review.md`) | Option B (keep kernel) + ERPNext as a gate; one order aggregate with independent lifecycles; system-as-master only for policy/pricing/desired availability; publish absolute quantities; reconciliation as a product feature; Postgres is enough; cut list |
| Codex **astra** critique (`docs/delivery/research/codex-astra-critique.md`) | "Keep B, make it much smaller, change the delivery order": modular monolith; unit of delivery = one complete business transaction; storefront-admin parity contract + section-status vocabulary; 7-step ingestion; zero-paid analytics stack; 5 approval policies; role templates; explicit adapters; data-model corrections (brand optional, location≠ownership, recognition point, cancellation≠return); manufacturing-lite must keep loss/traceability; TikTok blocker; Clarity is not "in-admin"; top-10 simplifications + top-5 risks |
| Reconciliation workflow `wf_a1f4c62d-b05` — DM / OR / IN / CX / AN / DL domain agents (read-only, repo-verified) | File:line-level decisions, keep/cut lists, and the task packets in section 7 |
| Owner answers (2026-09-16) | Round 1–4 facts (channels, payments, roles, books, manufacturing, currencies, customer profile, Option B) + A1–A4 below |

### Owner decisions that shape the plan (locked)
| # | Decision |
|---|---|
| A1 | **Parent ships directly to the end customer for every brand; brands never hold stock.** Intercompany sale recognized per shipment (flash title), aggregated into a monthly intercompany invoice. Brand-owned stock positions are not built (the owner dimension allows adding them later without a rewrite). |
| A2 | **Only the parent entity is ETA-registered today.** Fiscal issuance for parent documents in S3; brand registration + per-entity signer in S4, gated on the accountant. |
| A3 | **Manufacturing process unconfirmed (one-step vs bulk→packaging).** Design the two-stage model (bulk = intermediate lot consumed by a packaging batch; open batches valued in WIP); single-step is the degenerate case. Ops confirms before S2. |
| A4 | **The owner will provide the real failed Shopify order number.** Captured in full via GraphQL Admin as the canonical S1 regression fixture (PII-redacted in repo, raw copy private). |
| A5 (2026-09-25) | **Admin-built roles, not fixed templates.** The owner/admin creates accounts and picks, per role and per person, the screens, actions, data scope (warehouse/brand/channel/supplier) and sensitive-field visibility. Principal kinds: staff, delivery rep, sales rep, supplier (separate portal). **All screens and features stay** — scope is not cut. Supersedes CX-03's fixed templates and the "no permission builder" decision; CX-20's scoping and supplier RLS are kept. Plan: `docs/delivery/EXECUTION_PLAN.md`. |
| R1–R4 (earlier) | Not in production; mixed Shopify + WooCommerce; owner + accountant + ops + suppliers; cheapest; full statutory books; buy-resell + manufacturing + lots/expiry; orders + inventory live; current cloud OK; all four channels; COD + gateways + bank/InstaPay + credit; social publish + analytics + inbox; **Option B + ERPNext gate**; parent owns stock; EGP + EUR + Gulf; one group-level customer profile. |

---

## 2. The shape (what we are building)

**One modular monolith, one admin, one backend, one transactional database.** Modules are folders and ordinary TypeScript functions in the existing monorepo. Deployment boundaries stay where infrastructure forces them: `apps/admin` (Next.js on Vercel), `apps/api` (Hono Worker = HTTP + cron + outbox worker), and later an **ETA signer** host (CAdES signing cannot run on Workers). `apps/mobile`, the platform-admin layer, `packages/types`, `org_feature_flags`, `activity_log` are deleted.

**Unit of delivery = a completed business transaction, not a foundation or a module.** Slice 1 takes the owner's real order from webhook to explainable margin. Every later slice repeats that for the next channel/process and builds only the foundation it needs.

**Kernel kept verbatim (extend only):** `withOrgContext` + RLS root on `org_id` (`packages/db/src/index.ts:151-180`, `drizzle/0031`), the ledger's three guarantees (`ledger.ts`, `drizzle/0038`: pure pre-check → deferred balance trigger → REVOKE UPDATE/DELETE), `reverseJournalEntry`, WAC `nextAverageCost` round-half-even (`costing.ts`), bigint minor-unit money (`packages/domain/src/money.ts`), idempotency keys, gapless `nextDocumentNumber`, transactional outbox + dead letters + worker, Shopify inbox `claimDelivery/markDeliveryProcessed`, `migrate.mjs`, and the three CI gates (`rlsCoverage`, `schemaDrift`, `tenancyGate`) + `tenantIsolation`.

**Hierarchy:** `org` (the group, RLS root, unchanged) → `legal_entities` (functional currency, document prefix, recognition point, tax registration; kind operating|elimination) → `brands` (analytic dimension) → `channels` (brand + selling entity + kind shopify|woocommerce|pos|whatsapp|b2b|marketplace + default warehouse) → `warehouses` (physical location only; **ownership is a column on the stock position, never on the warehouse**).
- `legal_entity_id` NOT NULL on every money/stock/document row, enforced by composite FKs `(parent_id, legal_entity_id)` (the `0030/0038` pattern) so a cross-entity line is unrepresentable.
- `brand_id` NOT NULL on orders/channels; **nullable** on products (shared ingredients), journal lines (unallocated shared costs) and stock.
- Staff are group-wide (one ops team, one accountant) — no per-entity narrowing until the supplier portal (S3) adds a second GUC predicate for `principal_kind='supplier'`.

**Order aggregate:** one `orders` table for every channel with five independent lifecycles (`commercial`, `fulfillment`, `payment`, `invoice`, `settlement`), full buyer/address/money snapshots, `sections` jsonb carrying the 11-section status vocabulary (`loaded | not_applicable | not_exposed_by_provider | permission_denied | fetch_failed`), source ids/versions, and an `accepted_candidate_id`. Import runs **receive+preserve → hydrate → candidate → validate → promote atomically → visible "Import blocked"** through the existing outbox worker. The database, not discipline, enforces completeness: `CHECK (source IS NULL OR accepted_candidate_id IS NOT NULL)`, `CHECK (sections ?& <11 keys>)`, and a deferred constraint trigger asserting `count(order_items) = candidate.line_count` at COMMIT. Unmapped lines never promote; they stay visible on the candidate with full detail.

**Stock:** `inventory_items` re-keyed to `(org, owner_entity, warehouse, variant)` with a UNIQUE index; `stock_lots` (every position has lots; non-lot-tracked variants use an implicit `-` lot) with states `released|quarantined|rejected|expired|recalled`; `inventory_movements` extended with `kind/lot_id/position_id/ref/unit_cost` and written **only** by `moveStock()` (grep-asserted). Reservations at position level; FEFO with hard blocks at ship time; COGS snapshot at ship; absolute-quantity publication to channels with buffers, echo-ack and 15-min reconciliation; production always posts through WIP (1045).

**Ledger:** journal lines gain `legal_entity_id`, analytic dims (brand, channel, warehouse, variant, order, counterparty), transaction + functional currency amounts with `fx_rate_num/den` bigint; the balance trigger sums functional amounts; posting idempotency by `UNIQUE(entity, source_table, source_id, entry_kind)`. Recognition posting at the entity/channel recognition point: parent direct sale = one entry; brand sale = mirrored parent/brand entries linked by `intercompany_documents` (flash title). Consolidation = per-entity books + elimination entity + report-time IAS 21 translation (no stored translated ledger).

**Surfaces:** shared operation functions + zod schemas are the single source; thin REST/OpenAPI adapter (public API, S5), thin MCP adapter exposing a deliberate ~12–15 tool subset (S5), tRPC kept for the admin where it already works. Providers = explicit adapters per family (storefront, courier, payment, messaging, social) with **static capability manifests**; providers-as-data = connections, encrypted credentials, config, cursors, health only. Five approval policies + one `approvals` table; fixed role templates + scoped assignments; append-only `audit_log` by grant + a real viewer.

**Analytics (zero paid tools):** Shopify Web Pixel app extension + WooCommerce mu-plugin → Worker `/collect` → Cloudflare Queue (+DLQ) → monthly Postgres partitions on a limited role/pool + daily aggregates (90-day raw retention) → 8 hand-written SQL reports in the admin; Workers Analytics Engine for ops telemetry; browser purchase events never create revenue. No PostHog/Metabase/GA4 foundation; replay deferred (rrweb if mandated; Clarity is not "in-admin").

**ERPNext** remains a **gate**, fit-tested early (S2/S3 timeframe, no code) against the four entities, currencies, taxes, intercompany, returns, COD, bank rec and a simulated close; if adopted, strict one-way export, no sync back.

---

## 3. Cross-domain conflicts — resolved

| Conflict | Resolution | Why |
|---|---|---|
| DM proposed new `stock_positions`/`stock_moves` tables; IN proposed extending `inventory_items`/`inventory_movements` in place | **IN wins**: extend in place, re-key, add UNIQUE, single writer `moveStock()` | astra: "preserve working kernel code in place"; six existing writers keep compiling; the missing UNIQUE index is a latent defect fixed in the same migration |
| DM proposed `order_section_status` table + trigger; OR proposed `orders.sections` jsonb + `order_import_candidates` | **OR wins**: jsonb + `CHECK (sections ?& ARRAY[11 keys])` + candidate table | Same guarantee, one table fewer, one renderer for blocked and promoted orders |
| DM: `order_items.variant_id` nullable with `mapping_state unmapped`; OR: NOT NULL except `line_kind='custom_nonstock'`, unmapped lines never promote | **OR wins** | Keeps every downstream kernel invariant (reservation, costing, posting, courier) free of null handling; the candidate screen still shows "3 bottles of serum at this price" |
| DM `wip` enum state + close check; IN "always post through WIP 1045" | **IN wins** | Fewer branches; open batches are simply the WIP balance at period end; satisfies A3 either way |
| DM `stock_reservations(order_item_id, position_id, lot_id?)`; IN position-level only, lots allocated at ship | **IN wins** (no lot on reservation) | FEFO at pick time is standard; B2B shelf-life is a destination rule passed to `allocateLots` |
| Migration numbering: DM, OR, IN each start at `0067` | **Single sequence assigned in section 7** (S0 first, then S1 by dependency order); PR title claims the number | The 2FA incident (#340) came from ordering; history stays linear |
| Sol: ERPNext should own stock/back-office; owner chose B | ERPNext = accounting-close gate only; operational stock stays in-system | Owner decision; astra concurs |
| Synthesis: `parties` table + role tables; DM: keep `customers` as the group person | **DM wins** (defer `parties` until one person plays two roles) | `org == group` already; big-bang rename has no S1 payoff |

---

## 4. Slices and acceptance gates (owner-verifiable, not calendar dates)

| Slice | Outcome | Gate (all must hold) |
|---|---|---|
| **S0 — Foundation minimum** (only what S1 needs) | Dimension tables + backfill; fx primitives; ledger v2 (entity, dims, functional amounts); per-entity document counters; orders v2 schema + promotion guards; customer identities + brand relationships; inbound_deliveries (raw bytes); candidate schema/table; audit_log append-only + columns; connections generalized (channel/entity on connection); role templates; approvals table; migration policy; GitHub task system + Playwright harness in CI | Every migration applies on a fresh DB **and** on the existing dev DB; `rlsCoverage`, `schemaDrift`, `tenancyGate`, `tenantIsolation` green; `seedGroup()` fixture creates parent + 3 brand entities, brands, channels, warehouse, rates, transfer-price list; GitHub board carries every S1 issue with executor labels; Playwright smoke test runs in CI |
| **S1 — Order-first (Shopify)** | The owner's real order flows end-to-end in the admin | (1) Webhook → durable inbox → hydration → candidate → promoted order; a forced crash mid-promotion leaves **no** `orders` row. (2) Order workspace shows all **11 sections** with statuses, matching the Shopify admin page side by side (items with titles/qty/unit price, buyer name + contact, addresses, discounts/tax/shipping/total, transactions, fulfilments, refunds, notes/tags/risk, evidence). (3) A deliberately unmapped line produces **"Import blocked"** with the missing section and next action; mapping it promotes the order. (4) Reservation → FEFO lot allocation → shipment booked on Bosta with tracking → Shopify fulfilment write-back with tracking. (5) COD remittance recorded and reconciled against the shipment. (6) Recognition posting at the configured point: parent direct sale = one balanced entry; brand sale = parent/brand pair with `intercompany_documents`; per-entity trial balance balances in functional currency. (7) Margin visible on the order with "cost unknown ≠ zero" labelling. (8) Every step has an `audit_log` row visible in the filterable viewer. (9) Dropping a webhook on purpose → the 15-min scan imports it; the daily reconciliation report counts blocked imports separately from revenue. (10) Owner home shows 3 reports (orders needing attention incl. blocked imports; sales/contribution by entity·brand·channel; stock availability/expiry). (11) Playwright specs for (2)(3)(10) green in CI. |
| **S2 — Second channels + physical ops** | WooCommerce, manual WhatsApp/DM orders, web POS, receiving, manufacturing-lite, lots/FEFO, write-offs, stocktaking, returns-to-quarantine | Woo order promotes through the **same** pipeline with zero Woo branches in `promoteCandidate`; a WhatsApp order created manually passes the same completeness gate; a POS sale completes idempotently (retry with the same key returns the same receipt) and its refund lands in a quarantined lot; till close posts cash variance; a production order consumes ingredient lots into WIP and outputs a quarantined lot released after QC; **mock-recall test** (2 ingredient lots → bulk → 2 packed lots → 3 shipments) reconciles held + shipped + written-off = received; opening stock imported from the owner's CSV; inventory invariants suite green; ERPNext fit-test completed with the accountant and the decision recorded |
| **S3 — B2B, purchasing, suppliers, money-in/out** | Customer invoices + credit terms + AR aging; supplier bills + 3-way match + GRNI/PPV + landed cost + AP aging + payments; supplier portal; multi-warehouse transfers; returns disposition + RTO; gateway settlement import + bank/InstaPay payments + settlement matching; ETA issuance for the parent (eInvoice B2B, eReceipt B2C/POS) on an off-Workers signer | B2B order → invoice with terms → partial payment applied → aging buckets correct; supplier user logs in, acknowledges a PO with a changed date (creates buyer approval), files ASN, flips PO to bill capped at received-unbilled, sees payment status, gets 404 on another supplier's PO; GRN → bill: GRNI nets to zero, PPV carries the delta; a Paymob settlement file reconciles to orders with fees posted to the entity; parent e-invoice accepted by ETA (sandbox then production) |
| **S4 — Accounting workbench** | Period close (soft/hard, reopen by approval), closing entries, FX revaluation, consolidation with eliminations + IAS 21 translation, brand-entity ETA registration/signers, accountant workbench screens | The accountant closes one month for all four entities inside the system: soft-close checklist clean → hard close → trial balance + P&L + balance sheet per entity → consolidated TB balances to zero with eliminations and a CTA line → posting into a closed period is refused → reopen requires an approval; ETA documents issued for every registered entity |
| **S5 — Analytics, social, API/MCP, automation** | Pixel/mu-plugin → `/collect` → Queue → partitions → the remaining 5 reports + web-vitals + integration health; social calendar + Meta adapter (publish, analytics, IG/FB inbox); public REST API + scoped hashed API keys; MCP server (deliberate subset) + outbound MCP client tools; automation rules + agent limits; evidence archive/purge; replay only if mandated | Funnel report from real pixel data matches order counts within the stated coverage statement; an API key with `orders:read` reads orders and is rejected on writes; an MCP client lists exactly the published tools and a write tool creates an **approvals** row, never a direct write; a scheduled Instagram post publishes and its metrics appear in-system; IG/FB DMs appear in the inbox tied to the customer record |

**Deferred beyond S5 (with reason):** offline POS (online-only locked); TikTok auto-publish (platform policy blocks internal-tool Direct Post); Postiz (adds a hosted stack + Temporal); PostHog/Metabase/GA4 as foundations; session replay (rrweb only if mandated); `parties` table; FIFO/lot cost layers; brand-held stock positions; multi-level BOM/routing/scheduling/variances; bins/serials/consignment; RFQ/supplier catalogs/scorecards; GDPR webhooks (custom app, not App Store); bulk-operation reconciliation; hash-chained/partitioned audit; generic permission builder; universal surface generator; Cloudflare Workflows/Temporal/Inngest.

---

## 5. Executors and lanes (who does what)

| Executor | Fit | Notes |
|---|---|---|
| **claude** (this session) | Schema/migrations/RLS/tenancy, cross-module integration, every review, plan upkeep, slice gates | Reviews every external PR with the `money-reviewer` and `tenancy-reviewer` agents; owns migration numbering |
| **codex** (sol for money/ingestion paths, terra for routine) | Ingestion pipeline, ledger v2, stock ops, recognition posting, POS, production, settlement matching, adapters | Dispatch via `codex-companion.mjs task --cwd E:/irth-os-jules-land --prompt-file <packet>`; state the tier per dispatch |
| **jules** | Well-specified, isolated, PR-sized tasks from a GitHub issue: routers, small schema additions, fixtures, tests, read models | Consumes the GitHub issue verbatim; never touches RLS policies or money arithmetic |
| **hermes** | Fixture matrices, docs, invariant suites, scaffolding, research | Same packets; output reviewed by claude before merge |
| **owner** | Real-order fixture (A4), opening-stock CSV, UAT at each gate, decisions | |
| **accountant** | Recognition points, chart additions, VAT regimes, ETA registrations, ERPNext fit-test, close UAT | |
| **ui-track** (astra when credits allow; fallback claude + design skills) | Design system, IA, component inventory, screen program, UI build packets | Brief: `docs/delivery/briefs/astra-ui-brief.md`; screens only wire to read models/ops defined in S0/S1 packets |

---

## 6. Risks (astra's five + new) and the task that mitigates each

| Risk | Mitigation |
|---|---|
| A complete-looking facade survives the rewrite | DB-enforced promotion guards; "Import blocked" as a first-class state; owner fixture regression test; Playwright asserts every section; blocked-import counter on the home dashboard; source-vs-admin side-by-side check before declaring a store connected |
| Balanced books hide wrong economics/tax | Multi-entity ledger test suite (ownership, currencies, returns, intercompany) written with the accountant as the spec; recognition point configurable per entity/channel; consolidation with CTA; ERPNext fit-test early |
| Shared stock oversold / traceability lost | Position-level reservations with guarded UPDATE; FEFO hard blocks; absolute publication with buffers + echo-ack + 15-min reconcile; `moveStock` single writer; mock-recall gate before selling lot-tracked goods |
| Cash and profit appear before they exist | Five lifecycles; COD/gateway/bank settlement states separate from payment; recognition posting only at the configured point; "missing costs are not zero costs" labels; margin shown per entity and per group after transfer markup |
| The operator inherits too many systems | Modular monolith; no generators, no workflow engine, no permission builder, no Postiz, no BI product; acceptance gates instead of calendar promises; one GitHub task system |
| Protected customer data redaction (200 + null + errors) reproduces the exact failure | Connector health probe tests **permissions**, not HTTP status; buyer/addresses carry `permission_denied` with the Dev Dashboard action |
| Shopify API 2025-10 loses support 2026-10-16 | Bump to 2026-07 in S1 (OR-04) |
| Parallel agents collide on migrations/files | Single migration sequence claimed in the PR title; file ownership per parallel group; schema-change queue owned by claude |
| Usage limits (Claude/OpenAI) stall the machine | Every packet is executable in a fresh context; GitHub issue = durable state; workflows resume from journal |

---

## 7. Task DAG and packets

### 7.0 How to read this section
- **IDs are stable**: `DM-nn` data model/ledger, `OR-nn` order ingestion/parity, `IN-nn` inventory/manufacturing/POS/purchasing/supplier, `CX-nn` connectors/API/MCP/auth/approvals/audit, `AN-nn` analytics/reports/observability, `DL-nn` delivery system, `UI-nn` design track. The **full packet** for every ID (goal, exact files, reuse pointers, acceptance bullets, tests, risks) lives in the six domain files `docs/delivery/packets/{DM,OR,IN,CX,AN,DL}.md`. **Execution step 0 (DL-00)** commits those six files verbatim into `docs/delivery/packets/` so the packets are durable, then DL-17 publishes them as GitHub issues.
- Columns: exec = codex / jules / hermes / claude / owner / acct / ui · size S/M/L · deps = must be merged first · grp = parallel group (tasks in one group never touch the same files; groups run concurrently).
- **Merges applied to the raw packets** (the integrator's job, done here): DM-12 ⊂ CX-05 (audit v2) · DM-11 ⊂ CX-13 (shipments collapse) · CX-09 ⊂ OR-01+OR-04 (one inbox = `inbound_deliveries`, path-scoped `/webhooks/:provider/:connectionId/:topic`, raw bytes, per-connection secret) · DM-05 ⊕ OR-09 = one orders-v2 migration (OR shape: jsonb `buyer/billing_address/shipping_address/sections` + `CHECK (sections ?& 11 keys)`, `order_items.variant_id` NULL only for `line_kind='custom_nonstock'`, deferred trigger `count(order_items) = candidate.line_count`; five lifecycle columns from DM) · DM-07/DM-08 ⊂ IN-01/IN-02/IN-04/IN-05 (extend `inventory_items`/`inventory_movements` in place; `moveStock()` single writer) · OR-10's `customer_source_links` ⊂ DM-06 `customer_identities` · OR-19 health columns ⊂ CX-07 `connections.health` · DM-16/DM-17 ⊂ IN-11/IN-12/IN-09 · DM-18 ⊂ CX-20 · DM-19 keeps the **AR** side only (customer_invoices, credit_notes, payments-in, applications, shared settlement matcher); IN-19/20/21 own the **AP** side · OR-21 evidence permission ⊂ CX-03 role templates · DM-14 ⊕ OR-13 ⊕ DL-20 = the real-order fixture chain.
- **Migration sequence** (initial allocation; the PR title claims the real number and `migration-check` enforces "> main max", so gaps are fine): 0067 DM-01 · 0068 CX-02 · 0069 CX-03 · 0070 CX-05 · 0071 CX-07 · 0072 DM-02 · 0073 DM-03 · 0074 DM-04 · 0075 OR-01 · 0076 OR-03 · 0077 DM-05/OR-09 · 0078 DM-06 · 0079 CX-10 · 0080 AN-02 · **S1:** 0081 IN-01 · 0082 IN-04 · 0083 CX-13 · 0084 IN-05 · 0085 IN-06 · 0086 IN-07 · 0087 DM-09 · 0088 OR-07 · 0089 OR-20 · 0090 CX-12 · **S2:** 0091 IN-09 · 0092 IN-10 · 0093 IN-11 · 0094 IN-12 · 0095 IN-15 · 0096 IN-16 · 0097 OR-25 · **S3:** 0098 IN-19 · 0099 IN-20 · 0100 IN-21 · 0101 CX-20 · 0102 IN-22 · 0103 IN-23 · 0104 IN-24 · 0105 IN-25 · 0106 IN-26 · 0107 DM-19 · 0108 DM-23 · **S4:** 0109 DM-20 · 0110 DM-21 · **S5:** 0111 AN-14 · 0112 CX-23 · 0113 CX-25. Only `exec:claude` tasks write migrations; other lanes raise `needs:schema`.

### 7.1 S0 — Foundation minimum (gate in §4)

| ID | Task | exec | size | deps | grp |
|---|---|---|---|---|---|
| DL-00 | Commit the six packet files to `docs/delivery/packets/` + this plan to `docs/superpowers/specs/2026-09-17-irth-os-bos-design.md` | claude | S | — | S0-A |
| DL-01 | `docs/agents/` bootstrap: issue-tracker, domain map, routing table, packet template, labels | claude | S | DL-00 | S0-A |
| DL-02 | Idempotent GitHub bootstrap script: labels, 6 milestones, Project board | claude | S | DL-01 | S0-A |
| DL-03 | Issue forms (task-packet, slice-epic, decision) + PR template | jules | S | DL-01 | S0-A |
| DL-05 | CI `migration-check`: numbering lock, no edits to existing migrations | jules | S | — | S0-A |
| DL-06 | CI `schema-guard`: schema paths need `exec:claude`/`schema:approved`; `exec:ui` may not touch server | jules | S | DL-02 | S0-A |
| DL-04 | Merge policy: required checks, squash-only, branch cleanup (owner runs the gh commands) | claude+owner | S | DL-05, DL-06 | S0-A |
| DL-07 | `apps/api` real-Postgres integration harness in CI (same Neon branch group) | claude | M | — | S0-A |
| DL-08 | Playwright scaffold + e2e CI job + `data-testid` contract doc | hermes (+claude installs) | M | DL-07 | S0-A |
| DL-09 | `packet-to-brief.mjs`: issue → Codex brief with real gate commands + tier line | jules | S | DL-01 | S0-A |
| DL-10 | Lane rules in AGENTS.md, worktree doc, fix stale tenancy-reviewer text | claude | S | DL-01 | S0-A |
| DL-11 | Jules configuration + `jules`-label probe on DL-03 | owner | S | DL-02, DL-03, DL-10 | S0-A |
| DL-12 | Hermes lane probe + capability doc | owner | S | DL-01 | S0-A |
| DL-13 | `review-external-pr` skill + review protocol (money/tenancy reviewers, packet compliance) | claude | M | DL-02, DL-04 | S0-A |
| DL-14 | Durable daily sync routine → irth-os Watch dashboard + epic digest | claude | S | DL-02, DL-13, DL-15 | S0-A |
| DL-15 | Evidence ledger `docs/delivery/S0..S5.md`; freeze STATUS/BASELINE | jules | S | DL-01 | S0-A |
| DL-16 | Seed slice epics S0–S5 with gate checklists + lane/file-ownership tables | claude | S | DL-02, DL-03 | S0-A |
| DL-17 | `publish-tasks.mjs`: packets → issues with labels/milestone/sub-issue/blocked_by | jules | M | DL-02, DL-03, DL-16 | S0-A |
| DL-18 | Automation security policy (label triggers actor-gated, no PII in issues) | claude | S | DL-02, DL-06 | S0-A |
| DL-19 | Optional: Codex cloud `@codex review` — decide yes/no | owner | S | DL-18 | S0-A |
| DL-20 | Fixture policy + deterministic masking tool for the real order (A4) | claude | S | — | S0-A |
| DL-21 | UI-track integration rules (`exec:ui`, allowed paths, screenshots, data contract) | claude | S | DL-02, DL-06, DL-13 | S0-A |
| CX-01 | ONE Better Auth authority in `apps/api`; admin becomes a client (same-site cookies) | claude | M | — | S0-B |
| CX-02 | Delete platform-admin, `packages/types`, `apps/mobile`, mobile REST routes, `activity_log`, `org_feature_flags` | jules | M | CX-01 | S0-B |
| CX-03 | Role templates v2 (owner/admin/accountant/ops/warehouse/sales/supplier) + `redactForRole` + `evidence.view` | jules | S | CX-02 | S0-B |
| CX-04 | MFA enforced server-side for owner/admin/accountant (mutations 403 `mfa_required`) | jules | S | CX-01, CX-03 | S0-B |
| CX-11 | Ops convention (`packages/db/src/ops/*`) + write-surface gate test | hermes | S | CX-02 | S0-B |
| DM-15 | Migration policy + checklist + `_TEMPLATE.sql.txt` + `migrate.mjs --dry-run` | claude | S | — | S0-C |
| DM-01 | Dimension tables `legal_entities/brands/channels/warehouses` + backfill + `seedGroup()` | claude | M | DM-15 | S0-C |
| DM-02 | `exchange_rates` + `SUPPORTED_CURRENCIES` EGP/EUR/SAR/AED + `convertMinor` | jules | S | DM-01 | S0-C |
| DM-03 | Ledger v2: entity + dims + functional-currency balance trigger + posting idempotency index | codex (sol) | L | DM-01, DM-02 | S0-C |
| DM-04 | Document counters per (org, entity, kind) + wider `DocumentKind` | jules | S | DM-01 | S0-C |
| CX-05 | `audit_log` v2: actor/channel/outcome/before/after, REVOKE + trigger, `withAudit` defaults, capped denial logging | claude | M | CX-02 | S0-C |
| CX-07 | `connections` + `connection_secrets` + secrets kernel (KEK in Worker secret, key_version, rotate, import gate) | claude | M | CX-02 | S0-C |
| CX-08 | Adapter interfaces + static manifests + permission-testing health contract + registry + connections ops | codex (terra) | M | CX-07, CX-03 | S0-C |
| OR-01 | `inbound_deliveries` (rename `shopify_webhook_deliveries`; raw bytes, headers, sha256, api_version, retention) — absorbs CX-09 | claude | M | CX-07 | S0-C |
| OR-02 | `packages/domain/orders/candidate.ts`: CandidateOrder zod, 11 sections, 5 statuses, blocker codes, `decimalStringToMinor` | jules | S | — | S0-C |
| OR-03 | `order_import_candidates` table + RLS | claude | S | OR-01 | S0-C |
| DM-05⊕OR-09 | Orders v2: 5 lifecycles, snapshots, sections jsonb + CHECK, `order_items` v2, source children tables, promotion guard trigger, `transitionOrderLifecycle` | claude | L | DM-01, DM-04, OR-03 | S0-C |
| DM-06 | `customer_identities` (connection-scoped), `customer_brand_relationships`, `customer_merges`; guest orders | jules | S | DM-01, DM-05 | S0-C |
| CX-10 | `approvals` table + 5 policy predicates + request/decide/execute with revalidation + inbox ops | codex (sol) | M | CX-03, CX-05 | S0-C |
| AN-01 | Report contract + catalogue + single `reports.run/list` op | claude | S | CX-11 | S0-C |
| AN-02 | `work_events` append-only + `recordWorkEvent` + S1/S2 transition catalogue | claude | M | CX-05 | S0-C |
| DM-13a | Integration fixture kit: `seedGroup`, chart, rates (fixture loader added in S1) | hermes | S | DM-01, DM-02, DM-03, DM-05 | S0-C |

**S0 critical path:** DM-15 → DM-01 → DM-02 → DM-03 → DM-05⊕OR-09 → DM-06 (claude/codex serialised on schema); everything in S0-A and S0-B runs alongside. **S0 exit = gate in §4.**

### 7.2 S1 — Order-first, Shopify (the owner's real order end-to-end)

| ID | Task | exec | size | deps | grp |
|---|---|---|---|---|---|
| OR-04 | Receive-and-preserve webhook routes: raw-bytes HMAC, inbox insert + outbox enqueue in one tx, 11 order topics, scopes, API 2026-07 | codex (sol) | M | OR-01, OR-03, CX-08 | S1-A |
| OR-05 | Shopify order hydration client (GraphQL 2026-07): pagination, throttle backoff, error classification per section | codex (sol) | M | OR-02, OR-04 | S1-A |
| OR-06 | Normalizer: Shopify order graph → CandidateOrder (money via `decimalStringToMinor`, guest, mapping state) | codex (sol) | M | OR-02, OR-05 | S1-A |
| OR-08 | Completeness validator R1–R10 (pure) with section statuses + next-action keys | codex (terra) | S | OR-02 | S1-A |
| OR-07 | `variant_source_links` (connection-scoped) + backfill + drop `product_variants.shopify_*` + mapping resolver ops | claude | M | OR-03, CX-12 | S1-A |
| OR-10 | Atomic `promoteCandidate` + `inbound.delivery.process` worker handler (advisory lock, version check, reservation call, outbox events) | codex (sol) | L | OR-05..08, DM-05⊕OR-09, DM-06, IN-04 | S1-A |
| OR-11 | Revision handling: edits/refunds/fulfilments/transactions; pending-revision block; supersede | codex (sol) | M | OR-10 | S1-A |
| OR-14 | Shopify fixture matrix (19 recorded scenarios incl. redaction, throttle, 502, invalid UTF-8) | hermes | M | OR-02 | S1-A |
| OR-15 | Failure-mode integration suite (crash mid-promotion, duplicates, reordering, failed child write, concurrency, RLS) | codex (terra) | M | OR-10, OR-11, OR-14, DL-07 | S1-A |
| OR-13 | Real failed order: capture script (hermes writes, owner runs), masked fixture, end-to-end regression test | owner+hermes+jules | M | OR-05, OR-10, DL-20 | S1-A |
| OR-19 | Connector activation health: protected-data probe, scopes, webhook registration verification, daily re-check | codex (terra) | S | OR-04, OR-05, CX-08 | S1-A |
| OR-20 | 15-min overlapping incremental scan + daily reconciliation + activation backfill (60 days / `read_all_orders`) | codex (sol) | M | OR-04, OR-10 | S1-A |
| OR-22 | Shopify fulfilment write-back after dispatch (`fulfillmentCreateV2` with tracking, idempotent) | codex (terra) | M | OR-04, OR-11, CX-13 | S1-A |
| CX-12 | Shopify adapter re-homed on `connections` (N stores/org, sectioned `fetchOrder`, publish availability, fulfilment, per-connection webhooks); delete legacy single-shop path | codex (sol) | L | CX-07, CX-08, OR-01 | S1-D |
| CX-13 | Collapse `shipment_tracking` + `courier_shipments` → `shipments` + `shipment_events` (+ remittances per entity) | claude | M | CX-07, DM-05⊕OR-09 | S1-D |
| CX-14 | Bosta adapter: book (real address snapshot, COD), cancel, track, settlement CSV import, webhook; delete the 501 stub | codex (sol) | L | CX-08, CX-13 | S1-D |
| CX-15 | Wire refund approval policy into refund / COD short-pay path (first live approval) | jules | S | CX-10, CX-14 | S1-D |
| IN-01 | Re-key `inventory_items` to (org, owner_entity, warehouse, variant) + UNIQUE; `stock_lots`; movement columns; backfill | claude | M | DM-01 | S1-B |
| IN-02 | `moveStock()` single writer + lot state transitions + writer-assertion test; re-home 6 callers | codex (sol) | M | IN-01 | S1-B |
| IN-03 | Opening stock import (CSV → released lots, WAC, Dr 1040 / Cr 3020) | jules | S | IN-02, DM-03 | S1-B |
| IN-04 | Reservations + ATP; promotion reserves atomically or marks `operational_block='stock'`; delete webhook floor-decrement | codex (sol) | M | IN-02, OR-02 | S1-B |
| IN-05 | FEFO allocation with hard blocks + `shipment_lot_allocations` + COGS snapshot at ship | codex (sol) | M | IN-04, CX-13 | S1-B |
| IN-06 | Absolute quantity publication to Shopify with buffers, echo-ack, coalesced outbox, 15-min reconcile | codex (sol) | M | IN-04, CX-12 | S1-B |
| IN-07 | Lot state ops, daily expiry sweep, `recalls`, forward trace | jules | M | IN-05 | S1-B |
| IN-08 | Stock availability/expiry/stockout read endpoints (report 3 data + order desk ATP) | jules | S | IN-04, IN-07 | S1-B |
| DM-09 | `intercompany_price_lists` + `intercompany_documents` + recognition-point override per channel | jules | S | DM-01, DM-03 | S1-C |
| DM-10 | `postOrderRecognition`: direct sale vs parent/brand mirrored pair at the recognition point; reversal path | codex (sol) | M | DM-03, DM-09, IN-05 | S1-C |
| DM-22 | Multi-entity ledger/costing test extension (ownership, currencies, returns, intercompany) — the accountant's spec | hermes | M | DM-03, IN-05, DM-10 | S1-C |
| DM-13b | Fixture kit part 2: `loadRealOrderFixture()` + `docs/db/TESTING.md` | hermes | S | DM-13a, OR-13 | S1-C |
| OR-12 | Import-blocked exception ops: listBlocked, getCandidate, retryHydrate, discard, acknowledgeAccessGranted, blockedSummary | jules | M | OR-07, OR-10, OR-16 | S1-E |
| OR-16 | `OrderView` read model for promoted **and** blocked orders (11 sections, actions_available, deep links; raw evidence gated) + plain pages with `data-testid` | jules | M | DM-05⊕OR-09, OR-10, CX-08 | S1-E |
| OR-18 | Order actions: hold/release, search/filter (buyer jsonb, source number, blocked-only), server-computed `actions_available` | jules | S | OR-16 | S1-E |
| OR-17 | Playwright: order workspace parity, Import-blocked flow, home blocked-count, disabled unsupported action | jules | M | OR-16, OR-12, DL-08 | S1-E |
| CX-06 | Audit viewer: `audit.list` op with filters + `/audit` page + `<RecordHistory/>` on order/product/customer | jules | M | CX-05, CX-03 | S1-E |
| AN-03 | Report fixture pack + `docs/reports.md` definitions for the S1 three | hermes | S | AN-01 | S1-E |
| AN-04 | Report 2 — Orders needing attention (blocked imports, stuck syncs, unreserved, unmatched settlements) | jules | M | AN-01, OR-12, IN-04 | S1-E |
| AN-05 | Report 1 — Sales & contribution by entity/brand/channel/currency + per-order margin with missing-cost labels | codex (sol) | L | AN-01, DM-10, IN-05 | S1-E |
| AN-06 | Report 6 — Courier delivery, RTO, COD remittance performance | codex (terra) | M | AN-01, CX-14 | S1-E |
| AN-07 | Owner home wiring: 3 report cards + freshness/coverage + blocked-import counter | claude | S | AN-04, AN-05, AN-06 | S1-E |
| AN-08 | Observability hygiene: Workers-safe log level, requestId everywhere, redaction check | jules | S | — | S1-E |
| UI-01…06 | Design-track packets from the astra spec (§9): app shell + nav (mobile-first), Order Desk, Order Workspace (11 sections), Import-blocked resolver, Owner home, Connections/health + Audit viewer polish | ui | M each | OR-16, OR-12, AN-07, CX-06, DL-21 | S1-UI |

**S1 critical path:** CX-12 → OR-04 → OR-05 → OR-06/OR-08 → OR-10 → OR-11 → OR-13 (owner fixture green) ‖ IN-01 → IN-02 → IN-04 → IN-05 → DM-10 ‖ CX-13 → CX-14 → OR-22. **Gate = §4 S1 (11 checks).**

### 7.3 S2 — Second channels + physical ops

| ID | Task | exec | size | deps | grp |
|---|---|---|---|---|---|
| ACC-01 | ERPNext fit-test with the accountant (4 entities, currencies, taxes, intercompany, returns, COD, bank rec, simulated close) — decision issue, no code | owner+acct | M | DM-10 | S2-0 |
| OPS-01 | Ops confirms manufacturing process (one-step vs bulk→packaging), lot/expiry practice, opening-stock CSV, till procedure (A3) — decision issue | owner | S | — | S2-0 |
| CX-17 | WooCommerce storefront adapter (REST v3, guest `customer_id=0`, signature over raw bytes, availability publish, polling by default) | codex (sol) | L | CX-12 | S2-A |
| OR-23 | WooCommerce receive + hydrate + normalize on the same pipeline (zero Woo branches in `promoteCandidate`) | codex (sol) | M | OR-10, OR-20, CX-17 | S2-A |
| OR-24 | WooCommerce fixture matrix + failure suite | hermes | M | OR-23, OR-14 | S2-A |
| OR-25 | Manual order op for WhatsApp/IG DM sales (channel kind `whatsapp`): same candidate → validate → promote path, buyer snapshot from the chat, `source='manual'`, evidence = operator + message reference | codex (terra) | M | OR-10, OR-18 | S2-A |
| IN-18 | WooCommerce stock publish adapter on the same `inventory.publish` event | jules | S | IN-06, CX-17 | S2-A |
| CX-16 | Messaging adapters as per-brand connections (WhatsApp 360dialog / Meta Cloud, Resend, SMS) + templates | jules | M | CX-08, CX-07 | S2-A |
| IN-09 | Goods receipts (GRN) with supplier lots/expiry/initial state; PO lines by variant FK; Dr 1040 Cr 2010 in functional currency | codex (sol) | M | IN-02, DM-03, OPS-01 | S2-B |
| IN-10 | Variant inventory attributes (uom, lot_tracked, receive_into_state, shelf life) + drop duplicate `stock` counters + `units.ts` | claude | S | IN-08 | S2-B |
| IN-11 | Versioned BOM with UoM + overhead policy (policy change via approvals) | jules | M | IN-10, CX-10 | S2-B |
| IN-12 | Production orders: start / consume (lot-tied, FEFO) / output lot / QC release — always through WIP 1045; bulk = intermediate lot | codex (sol) | L | IN-11, IN-09, DM-03 | S2-B |
| IN-13 | Lot genealogy backward/forward + **mock-recall integration test** (gate) | codex (sol) | M | IN-12, IN-07 | S2-B |
| IN-14 | Write-offs + manual adjustments through approvals with posting (replaces direct `inventory.adjust`) | codex (terra) | M | IN-07, CX-10 | S2-B |
| IN-15 | Stocktaking re-homed onto lots/warehouses; functional-currency variance posting | jules | M | IN-02, IN-14 | S2-B |
| IN-17 | Return-into-quarantine primitive (re-home `returns.restock` onto `moveStock`) | codex (terra) | S | IN-02, IN-05 | S2-B |
| IN-27 | Inventory invariants suite + shared fixture builders (runs on every IN PR) | hermes | M | IN-05, IN-07 | S2-B |
| IN-16 | Web POS: tills, sessions, idempotent `completeSale`, refund to quarantine, till-close variance → 5040 | codex (sol) | L | IN-05, IN-14, DM-19a, CX-10 | S2-C |
| DM-19a | Payments-in table + `payment_applications` + shared settlement matcher (`applyPayment`, `allocateRemittance`) — pulled forward from S3 for POS tenders and COD remittance | codex (sol) | M | DM-03, CX-13 | S2-C |
| AN-09 | Report 3 — Stock availability, ageing, expiry, stockouts | jules | M | AN-01, IN-08 | S2-D |
| AN-10 | S2 work-event wiring + Report 7 — Fulfilment throughput/turnaround/errors + per-actor performance v1 | codex (terra) | M | AN-02, IN-05, IN-12 | S2-D |
| UI-07…12 | POS screen (tablet), Receive/GRN (phone, scan), Production order, Lots & recall trace, Stocktake, Manual-order composer | ui | M each | IN-16, IN-09, IN-12, IN-13, IN-15, OR-25 | S2-UI |

**S2 exit = §4 S2 gate** (Woo + manual + POS + production + mock recall + opening stock + invariants + ERPNext decision recorded).

### 7.4 S3 — B2B, purchasing, suppliers, money-in/out, parent ETA

| ID | Task | exec | size | deps | grp |
|---|---|---|---|---|---|
| OR-26 | B2B order + credit terms: customer credit limit/terms, `payment_status` on terms, invoice trigger at recognition point `invoiced`, destination shelf-life rule handoff | codex (sol) | M | OR-25, DM-19 | S3-A |
| DM-19 | AR subledger: `customer_invoices`, `credit_notes`, invoice lines, aging view per entity, gapless invoice/credit series | codex (sol) | M | DM-03, DM-04, DM-19a | S3-A |
| CX-18 | Paymob adapter: intention/capture/refund (approval-gated) / settlement import; webhook re-homed into the inbox | codex (sol) | M | CX-08, OR-01, DM-19a | S3-A |
| DM-24 | Bank/InstaPay payments + gateway settlement matching into the shared matcher; fees to the entity; unmatched → report 2 | codex (sol) | M | DM-19a, CX-18 | S3-A |
| IN-19 | Supplier bills + 3-way match with tolerances + GRNI (2015) + PPV (5050) | codex (sol) | L | IN-09, CX-10, DM-03 | S3-B |
| IN-20 | Landed-cost vouchers with on-hand/sold split + WAC update | codex (sol) | M | IN-19 | S3-B |
| IN-21 | Supplier payments + applications + AP aging | codex (terra) | M | IN-19 | S3-B |
| IN-26 | PO lifecycle hardening: approval by amount, fx snapshot, expected dates, supplier acknowledgement | jules | M | IN-09, CX-10 | S3-B |
| CX-20 | Scoped role assignments + supplier principal RLS predicate (`app.principal_kind`, `app.supplier_ids`) + supplier invite kind + DTO whitelists (absorbs DM-18) | claude | L | CX-03, CX-01 | S3-C |
| IN-22 | Supplier portal ops: PO inbox, acknowledge, ASN, GRN visibility, PO-flip bill, payment status | claude | L | IN-19, IN-21, CX-20 | S3-C |
| IN-23 | Multi-warehouse: transfers with lot lines, transit position, per-warehouse channel links, warehouse-scoped RLS | claude | M | IN-14, CX-20 | S3-C |
| IN-24 | Returns disposition + RTO intake (courier RTO event → return awaiting receipt) | codex (terra) | M | IN-17, IN-14, CX-14 | S3-D |
| IN-25 | Destination-specific minimum remaining shelf life (B2B customers, channels) | jules | S | IN-05, OR-26 | S3-D |
| CX-19 | Aramex courier adapter (second courier proves the interface) | jules | M | CX-14 | S3-D |
| DM-23 | ETA issuance for the **parent** entity: eInvoice (B2B) + eReceipt (B2C/POS) on the existing `packages/domain/eta.ts` + off-Workers CAdES signer host (cheapest always-on host; auth per CX-21) + document config per entity/registration/transaction type | codex (sol) + claude (signer host) | L | DM-19, IN-16, CX-21 | S3-E |
| CX-21 | ETA credentials as a per-entity `fiscal` connection + signer service auth contract | claude | S | CX-07 | S3-E |
| AN-11 | S3 cost/AR extensions: gateway fees, settlement mismatch rate, overdue collections | codex (terra) | S | AN-05, DM-24, DM-19 | S3-F |
| UI-13…18 | Invoices & AR, Supplier portal (external shell), Bills/3-way match, Transfers, Returns disposition, Payments/settlement reconciliation | ui | M each | DM-19, IN-22, IN-19, IN-23, IN-24, DM-24 | S3-UI |

**S3 exit = §4 S3 gate.**

### 7.5 S4 — Accounting workbench

| ID | Task | exec | size | deps | grp |
|---|---|---|---|---|---|
| DM-20 | Period close: soft-close checklist, hard close + closing entries, reopen by approval, FX revaluation of monetary balances | codex (sol) | M | DM-03, IN-12, DM-19 | S4-A |
| DM-21 | Consolidation: elimination entity + entries from `intercompany_documents`, report-time IAS 21 translation with CTA, unrealized-IC-profit check | codex (sol) | M | DM-09, DM-10, DM-20 | S4-A |
| AN-12 | Consolidated group contribution in Report 1 (IC elimination + presentation-currency FX) | codex (terra) | M | DM-21, AN-05 | S4-A |
| ACC-02 | Brand-entity ETA registration + per-entity signer credentials (accountant-gated; A2) | acct+claude | S | DM-23 | S4-B |
| ACC-03 | ERPNext adoption decision executed if ACC-01 said yes: one-way idempotent journal/document export, read-only close-status import; else close the gate | codex (sol) or none | L/0 | ACC-01, DM-20 | S4-B |
| UI-19…22 | Accountant workbench: close checklist, journals/trial balance/statements per entity, consolidation view, approvals for reopen/manual JE | ui | M each | DM-20, DM-21 | S4-UI |

**S4 exit = §4 S4 gate** (accountant closes a month for all four entities inside the system).

### 7.6 S5 — Analytics, social, public API/MCP, automation

| ID | Task | exec | size | deps | grp |
|---|---|---|---|---|---|
| AN-13 | Versioned event schema v1 (Worker, pixel, mu-plugin) | claude | S | — | S5-A |
| AN-14 | `events` monthly partitions + `irth_analytics` role/pool + maintenance + 90-day retention; drop legacy `storefront_*` | claude | M | AN-13 | S5-A |
| AN-15 | Worker `/collect/:siteKey` + Queue producer (validation, limits, abuse, consent) | codex (terra) | M | AN-13 | S5-A |
| AN-16 | Queue consumer + DLQ + batched idempotent insert + wrangler bindings | codex (terra) | M | AN-14, AN-15 | S5-A |
| AN-17 | Shopify Web Pixel app extension + `webPixelCreate` at activation (sandbox + consent honoured) | jules | M | AN-15, CX-12 | S5-A |
| AN-18 | WooCommerce mu-plugin (first-party cookie, snippet, WC hooks, consent filter) | jules | M | AN-15, CX-17 | S5-A |
| AN-19 | web-vitals capture (theme app embed + Woo enqueue) | jules | S | AN-15 | S5-A |
| AN-20 | Aggregates: `events_daily`, `funnel_daily`, `vitals_daily` (per-channel timezone) | jules | M | AN-16 | S5-A |
| AN-21 | Identity stitching rules (anonymous ↔ verified, conservative) | codex (terra) | M | AN-20, DM-06 | S5-A |
| AN-22 | Report 4 — Funnel by storefront/device/campaign + pixel-vs-orders drift | jules | M | AN-20 | S5-A |
| AN-23 | Report 5 — Repeat purchasing and cohorts | hermes | M | AN-01, DM-06 | S5-A |
| AN-24 | Workers Analytics Engine telemetry writer | jules | S | — | S5-A |
| AN-25 | Report 8 — Site speed + integration health (vitals, AE, DLQ, dead letters, stuck inbox, connector health) | hermes | M | AN-19, AN-24, CX-08 | S5-A |
| AN-26 | Session replay decision doc (rrweb plan) — deferred | hermes | S | — | S5-A |
| CX-23 | API keys via `@better-auth/api-key` (owner-managed, scoped, brand/entity-restricted, revocable, rate-limited) | jules | M | CX-01, CX-03 | S5-B |
| CX-22 | Public REST `/api/v1` + OpenAPI (deliberate subset) via `@hono/zod-openapi` | codex (sol) | L | CX-11, CX-23 | S5-B |
| CX-25 | Outbound webhooks: endpoints, signed deliveries via outbox, replay | jules | M | CX-22 | S5-B |
| CX-24 | MCP server at `/mcp` with `@better-auth/mcp` (OAuth 2.1, audience-bound) + 13 curated tools + caps + untrusted-content rule | codex (sol) | L | CX-10, CX-11, CX-06, CX-23 | S5-B |
| CX-26 | Outbound MCP client connections (allow-list, tools_hash pinning, test-call, AI-chat tools) | codex (terra) | M | CX-07, CX-24 | S5-B |
| IN-28 | Inventory ops exposed on REST/MCP (read subset + proposal writes) | jules | S | IN-14, CX-22, CX-24 | S5-B |
| CX-27 | Social: `SocialAdapter` + first-party **Meta** adapter (IG/FB publish + schedule, insights, comments/DM inbox tied to customer), content calendar ops; TikTok/YouTube manifests = `not_exposed_by_provider` | codex (sol) | L | CX-08, DM-06 | S5-C |
| OR-27 | Evidence archive to private R2 + purge per `retention_until`; audited raw access unchanged | jules | S | OR-01 | S5-C |
| CX-28 | Agent limits + automation caps in `org_settings` (refund/adjust/messages/publish) surfaced in Settings; no rules engine | jules | S | CX-24 | S5-C |
| UI-23…28 | Analytics dashboards (5 reports), Social calendar + inbox, API keys & agents settings, Connections › MCP, Evidence archive viewer, PWA install polish | ui | M each | AN-22/23/25, CX-27, CX-23/24, CX-26 | S5-UI |

**S5 exit = §4 S5 gate.** AN-13…AN-20 and CX-23 have no dependency on S2–S4 and may be scheduled in parallel as soon as S1 ships.

## 8. Connected delivery structure (G18) — one system of record, four executors

**System of record = GitHub Issues in `sheiko0777/irth-os`.** One issue = one task packet (§7 ID in the title). One epic issue per slice with tasks as native **sub-issues**; `depends_on` = native **issue dependencies** (`blocked_by`); executor/slice/domain/status = **labels**; one **milestone** per slice gate; one **GitHub Project (v2)** board "IRTH OS Delivery" as the owner's phone view (labels/milestones stay the source of truth). No external tracker, no coordination JSON, no second state store (ECC epic-* commands, github-project-management, claude-devfleet, hermes-imports are explicitly **not** adopted — each adds a state store Jules/Codex cannot read).

**Label vocabulary** (`docs/agents/triage-labels.md`): `exec:claude|codex|jules|hermes|owner|accountant|ui` · `slice:S0..S5` · `domain:DM|OR|IN|CX|AN|DL|UI` · `status:ready|blocked|in-review` · `needs:owner|accountant|schema` · `review:approved|changes-requested` · `schema:approved` · `jules` (Jules trigger) · `claude-code` (owner's merge trigger) · `intent`.

**Task packet template** (`docs/agents/task-packet.md`, also the issue form): Title `[ID] imperative` · Goal · Slice/Domain/Executor/Size · Context pointers (domain.md, slice epic, locked decisions, A1–A4) · Files (`new:` prefix) · Reuse (existing functions with paths) · Do-not-touch (+ "no migrations / no lockfile / no .env / no auth config" unless `exec:claude`) · Acceptance (checkable) · Tests (unit / integration on disposable Postgres / RLS coverage / Playwright, with paths) · Depends_on (→ blocked_by) · Report contract (PR body must carry the evidence row, gate output counts, deviations). One body serves every executor: Jules reads the issue as-is on the `jules` label; Codex gets it wrapped by `scripts/delivery/packet-to-brief.mjs` into `<task>/<verification_loop>/<action_safety>/<structured_output_contract>` with the real gate command (`node pnpm.cjs turbo lint typecheck test`) and a tier line; Hermes gets the issue URL + repo path; Claude runs it via `superpowers:subagent-driven-development`.

**Routing table (task type → executor)**
| Task type | Executor |
|---|---|
| Migrations, `packages/db/src/schema/**`, `withOrgContext`, RLS/tenancy gates, Better Auth, integrating others' PRs, every external-PR review | claude |
| Ledger posting paths, WAC/reservation/lot allocation, ingestion receive→hydrate→promote, connector adapters, state machines, reconciliation, COD/settlement matching | codex — **sol** default; **astra** only for RLS/race/security-critical; **terra** mechanical |
| Isolated PR-sized work with no migration and no real-Postgres dependency: admin screens over existing ops, CI yaml, scripts, unit tests, single-workspace refactors | jules (no migrations, no lockfile/.env/auth; unit tests only — integration/RLS run in CI on its PR) |
| Research, docs, fixture masking, test scaffolds, SQL report drafts, digests — never money paths or schema | hermes (files-to-Claude lane until the DL-12 probe proves it can open PRs) |
| Decisions, real fixtures, UAT, gate sign-off | owner / accountant |
| `apps/admin` presentation only; never `apps/admin/src/server/**` or `packages/**` (except emails) | ui (astra when available; fallback claude + design skills) |
Any task spanning two lanes is split; the schema half is always `exec:claude`.

**Branches, PRs, merge:** branch `<exec>/<slice>-<id>-<slug>` (Jules' generated names accepted; identity = PR title `type(scope): summary [ID]` + `Closes #n`). **Squash-only**, delete branch on merge. Required checks on `main`: `test`, `integration`, `secret-scan`, `migration-check` (DL-05), `schema-guard` (DL-06). The owner's `claude-code` label stays the **only** merge trigger, but now waits for green (today `required_status_checks` is null — a red PR can auto-merge; DL-04 fixes this, owner runs the documented `gh` commands).

**Review protocol (DL-13):** every non-Claude PR → fresh worktree checkout → verify-gate → `git diff origin/main...HEAD` to the `money-reviewer` + `tenancy-reviewer` agents → schema checklist if guarded paths touched → packet compliance (files ⊆ packet, Do-not-touch honoured, acceptance evidenced, evidence row present) → `gh pr review --approve|--request-changes` + `review:*` label. Two rounds of changes-requested → Claude takes the task. One human approval (the owner) is sufficient; no "second agent as approver".

**Conflict avoidance:** migrations only in `exec:claude` tasks (`needs:schema` otherwise) · `migration-check` (numbered above main's max, no edits/deletes, unique prefix) · `schema-guard` (guarded paths need `exec:claude`/`schema:approved`; `exec:ui` can't touch server code) · file ownership per parallel group declared in each slice epic and packet · one git worktree per dispatch (`E:/irth-wt/<branch>`), `E:/irth-os` = read-only main mirror, install before delegating (pnpm hazard), never manual git inside an agent's worktree.

**Evidence & gates:** `docs/delivery/S<n>.md` keeps the proven row format `ID | status | PR | commit | evidence/tests | migration | blocker | next`; `docs/implementation/STATUS.md` and `BASELINE.md` frozen with banners (BASELINE's "live, 3 tenants, 1000 orders/day" contradicts the locked "not in production"). A slice closes when its epic's gate checklist is satisfied — never by date.

**Daily ritual (DL-14):** a durable scheduled Claude routine at 09:00 Africa/Cairo sweeps open PRs by lane + CI, deploy health, blocked issues, Jules WIP vs cap, `needs:*` decisions, migration queue → refreshes the **irth-os Watch** artifact (`write_db`) → posts one digest on the active slice epic → appends evidence rows via a `claude/` PR. Owner controls from the phone: apply `jules` (Jules lane), comment `dispatch codex|hermes`, apply `claude-code` (merge), close decision issues with a comment.

**Automation security (DL-18):** public repo + label-triggered agents ⇒ `jules`/`exec:*`/`schema:approved`/`claude-code` applied only by owner or Claude; any mutating issue/label/comment-triggered workflow gates on `github.actor == 'sheiko0777'`; issue/PR text is untrusted data for every agent; no secrets/PII in issues or PRs (fixtures masked per DL-20); Jules/Codex environments get no `DATABASE_URL`.

**Jules lane facts:** triggered by the `jules` label; reads AGENTS.md + issue; Free tier = 15 tasks/day, 3 concurrent (cap enforced by the daily sync); cannot merge, run real-Postgres tests, or choose branch names. **Codex lane:** local `codex-delegate` relay in a pre-installed worktree; Codex never commits; Claude reviews, runs the gate, commits, opens the PR. Codex cloud `@codex review` optional (DL-19). **Hermes lane:** probe first (DL-12); research/docs/tests/fixtures only.

## 9. UI / design track (G19)

**Status:** the astra design brief (`docs/delivery/briefs/astra-ui-brief.md`, 10 sections: admin audit, stack, IA, design system, component inventory, Slice-1 screen program, data-viz rules, anti-generic guardrails, 15–30 build packets, refusals) is written and dispatch-ready; OpenAI's weekly cap blocks it until **2026-09-19 22:54**. Task **UI-00** = dispatch it then (`codex-companion.mjs task --fresh --model gpt-6-astra --cwd E:/irth-os-jules-land --prompt-file <brief>`), fold the result into `docs/agents/ui-track.md`, and derive UI-01…28 packets. Until then the direction below is the working contract so S1 server tasks (OR-16, OR-12, AN-07, CX-06) expose the right data shapes; astra may revise visuals, not data contracts.

**What exists and stays (verified in `apps/admin`):** Next 15.5 + React 19, Tailwind v4 (`@tailwindcss/postcss`), shadcn-style `components/ui` on Radix (dialog/label/popover/select/slot) + cva/clsx/tailwind-merge, lucide icons, next-intl locale routing `[locale]/(auth|dashboard)`, react-hook-form + zod 4, tRPC 11 + react-query 5, existing `StatusBadge`, `KpiCard`, `StatBox`, `EmptyState`, `ErrorState`, `FilterTabs`, `SearchField`, `Pagination`, `CommandPalette`, `NotificationPanel`, `PermissionGate`, `charts/`. **Missing:** charting lib, table primitives, Playwright, PWA, a real design-token layer, mobile navigation.

**Provisional decisions (astra to confirm):**
- Stack additions only: `recharts` (shadcn chart pattern, SVG, RTL-safe), `@tanstack/react-table` (headless; virtualize only when a list exceeds ~500 rows), `@playwright/test` (DL-08), `@serwist/next` for installable PWA (online-only — no offline writes), `web-vitals` (S5). No component-library swap, no Expo replacement.
- **Role shells over one component system:** owner (phone-first: bottom tab bar Home · Orders · Stock · Money · More; sheets for actions; sticky bottom action bar on records), ops/warehouse (phone/tablet: pick-pack-ship queue home, scan input), accountant (desktop: dense tables, compact density, close checklist home), POS (tablet kiosk shell, large targets), supplier portal (external minimal shell, own route group `(portal)`).
- **Tokens:** neutral with a slight warm bias (ivory-leaning surfaces in light, warm charcoal in dark — related to the brand's #F3EFE7/#111111 without copying the storefront), ONE accent (a deep gold/bronze derived from ≈#B0885E, tuned for AA contrast on both grounds), a separate semantic set (success/warning/critical/info), and a distinct **status palette** for the section vocabulary (`loaded`=neutral check, `not_applicable`=muted, `not_exposed_by_provider`=info, `permission_denied`=warning, `fetch_failed`=critical) and stock states (released/quarantined/expired/recalled/rejected). Light + dark via CSS tokens on `:root` + `[data-theme]` + `prefers-color-scheme`.
- **Type:** IBM Plex Sans Arabic + IBM Plex Sans (one family, Google Fonts, excellent Arabic legibility at 12–14px in dense tables, tabular numerals). **Digits policy:** Western Arabic numerals for all money/quantities/ids in both locales (`numberingSystem: 'latn'`); Arabic-Indic only in prose if ever. Currency always explicit (`EGP 1,234.50`), never a bare number.
- **RTL:** logical properties only (`ms-/me-/ps-/pe-`, `start/end`), mirrored icon list (back/forward, chevrons, progress), bidi isolation for mixed strings (`<bdi>`), tables keep numeric columns end-aligned in both directions.
- **Accessibility/perf:** WCAG 2.2 AA, visible focus, 44px targets, `prefers-reduced-motion` honoured; budget LCP ≤ 2.5s / INP ≤ 200ms on a mid-range Android over 4G; server components for lists, client islands for actions.
- **Anti-generic:** no cream+serif+terracotta, no purple gradients, no everything-is-a-card, no emoji markers, no centred dashboards; hierarchy from type and spacing, cards only for genuinely separate objects (an order, a lot), status encoded in form (pill/stripe) not only colour.
- **Data-viz (dataviz rules):** one scale per chart, no dual axes, tabular numerals, every report frame shows definition · source · freshness · coverage; "missing costs are not zero costs" rendered as an explicit *estimated/unknown* chip on the margin, never blank.

**Component inventory (the ~25 that carry the product):** Money · StatusPill (section + lifecycle + stock vocabularies) · SectionStatusBanner · DataTable (mobile card fallback, saved filters) · Timeline/Activity · EvidenceDrawer (raw webhook / fetched pages / revisions, permission-gated) · ApprovalSheet (propose → approve with reason) · ScopeSwitcher (entity/brand/warehouse) · ExceptionCard · StockLotBadge · LotPicker (FEFO suggestion, blocked states explained) · AddressCard · ContactCard (guest vs profile) · CommandPalette (exists) · Empty/Loading/Error (exist) · ReportFrame · ScanInput · PrintTemplates (pick list, packing slip, receipt) · BottomTabBar · StickyActionBar · Sheet · DensityToggle · ScopeChip.

**Slice-1 screen program (each ships with Playwright assertions on `data-testid="order-section-<name>"` / `-status`):** Order Desk (list + saved views incl. *needs attention* + blocked-only) · Order Workspace (11 sections, sticky action bar, unsupported actions disabled *with reason*) · Import-blocked resolver (blockers + next action + mapping controls) · Variant mapping resolver · Customer profile (group person, per-brand relationship, guest orders) · Product/variant + per-channel listing · Stock (on-hand by owner/location/lot, ATP) · Reserve → Pick → Pack → Ship (phone-first, scan) · Courier booking + tracking · COD remittance reconciliation · Approvals inbox · Audit viewer · Connections/health (per-section permission status) · Owner home (reports 2, 1, 6 + blocked-import counter) · Login/2FA/recovery.

UI packets UI-01…28 are listed per slice in §7; each depends on the server task that exposes its data and is reviewed like any external PR (screenshots mobile + desktop required).

## 10. Open questions (answer changes the plan) — with defaults

Each becomes a `decision` issue (`needs:owner` / `needs:accountant`) in S0; the default applies if unanswered by the time the dependent task starts.

| # | Question | Needed by | Default |
|---|---|---|---|
| Q1 | Exact legal entities (names, countries, functional currency); is the EUR entity a seller of stock or sales-only? | DM-01, DM-09, DM-21 | 4 entities: IRTH parent (EG, EGP, stock owner) + 3 brand entities (EG, EGP); EUR/SAR/AED as presentment currencies on channels until the accountant says otherwise |
| Q2 | Revenue recognition point per channel (COD at delivery; online at capture or shipment; B2B at invoice; POS at payment) | DM-10 | delivered for COD + online storefront; invoiced for B2B; paid for POS — stored per entity with channel override |
| Q3 | Transfer-price method parent→brands (cost-plus % vs price list) | DM-09 | cost-plus 20% wildcard row; flash title (A1) |
| Q4 | Has protected customer data (name/address/email/phone) been **selected** for the Shopify app, and is it a Dev-Dashboard app? Has `read_all_orders` been granted? Is the failed order older than 60 days? | OR-19, OR-13, CX-12 | OR-19 treats redaction as `permission_denied` + shows the Dev Dashboard action; request `read_all_orders` now; fixture test asserts `loaded` only after the owner confirms access |
| Q5 | Store tax setting (prices tax-inclusive?) and enabled presentment currencies (Markets) | OR-08 | validator reads `taxesIncluded` per order; EGP/EUR/SAR/AED supported, others block with `unsupported_currency` |
| Q6 | During S1, will the team still fulfil/refund inside Shopify, or only in IRTH OS? | OR-11, OR-22 | both shown; external fulfilments flagged as findings, never auto-applied to stock |
| Q7 | Custom/non-stock lines (gift wrap, tips, bundles): manual classification per line or a per-connection rule? | OR-07 | manual classification for first occurrences; allow-list only if it recurs |
| Q8 | Refund approval threshold; stock-adjustment value threshold | CX-10, CX-15 | 1,000 EGP refunds; 500 EGP cost for adjustments (org_settings) |
| Q9 | Bosta: address taxonomy (city/zone mapping), webhook HMAC algorithm, remittance file format | CX-14 | spike first (owner supplies one remittance file + API docs); address mapper is a config table |
| Q10 | WhatsApp provider per brand: 360dialog vs Meta Cloud API | CX-16 | keep 360dialog where it exists; same interface, different manifest |
| Q11 | Minimum remaining shelf life per destination (e.g. B2B ≥ 180 days)? | IN-05, IN-25 | 0 days everywhere; column exists |
| Q12 | Overhead policy for production cost (none / % of material / fixed per batch) | IN-12 | `none`, overhead shown as *not allocated* in margin |
| Q13 | Supplier bills: GRNI (2015) accrual vs direct AP at receipt | IN-19 | GRNI (the accountant can collapse it to direct-AP; task shrinks) |
| Q14 | Raw evidence retention (24 months?) and behaviour-event retention (90 days?) | OR-21, AN-14 | 24 months raw evidence; 90 days raw events, aggregates forever |
| Q15 | Consent banners: which storefront domains legally require one (EU entity store yes; Egyptian PDPL?) | AN-17, AN-18 | Shopify analytics-only permission (platform handles regions); Woo EU domain requires consent |
| Q16 | Cloudflare plan: Workers Paid? (Queues on Free = 10k ops/day) | AN-15 | assume Paid ($5/mo); confirm before AN-15 |
| Q17 | Headline "sales" on the owner home: accepted orders vs posted (recognized) sales | AN-07 | both, side by side, labelled |
| Q18 | Jules plan tier (Free 15/day·3 concurrent, Pro, Ultra) | DL-11, DL-14 | Free: cap 3 in-flight |
| Q19 | Codex cloud `@codex review` as a second reviewer? | DL-19 | not now; Claude review + owner label |
| Q20 | May Claude change repo settings (branch protection, merge methods) or does the owner run the documented commands? | DL-04 | owner runs them (5 minutes) |
| Q21 | Keep `claude-code` label as the only merge trigger for every lane, or let Claude auto-merge `review:approved` docs/tests-only PRs? | DL-04 | owner's label only; docs-only PRs batched |
| Q22 | BASELINE.md claims live production with 3 orgs / ~1000 orders/day — confirm stale | DL-15, DM-05 | stale; owner facts win; preserve existing dev rows via backfill anyway |
| Q23 | Wipe the current Neon app DB before S1 or preserve via backfill? | DM-05, IN-01 | preserve (safer); owner may truncate after the S1 gate |
| Q24 | Session replay mandatory at launch? | AN-26 | deferred; doc only |
| Q25 | Signer host for ETA CAdES (cheapest always-on: Oracle free tier / Hetzner CX22 / a Windows PC with the USB token) | DM-23 | decide at S3 start with the accountant; auth contract fixed by CX-21 regardless |

## 11. Verification — how each gate is exercised

**Standing gates on every PR (CI):** `node pnpm.cjs turbo lint typecheck test` · integration job on the shared disposable Neon branch (`apps/admin` + `apps/api` suites serially) incl. `rlsCoverage`, `schemaDrift`, `tenantIsolation`, `tenancyGate`, `moneyColumns` · `secret-scan` · `migration-check` · `schema-guard` · `e2e` (Playwright, required from the S1 gate on). Every packet's Tests bullets name the file that proves it.

**S0 gate:** fresh-DB and existing-dev-DB migration runs (`packages/db/scripts/migrate.mjs`), all gates green; `seedGroup()` used by ≥1 integration test; `gh label list`/milestones/board converge on a second bootstrap run; DL-05/DL-06 probe PRs proven red-then-green; Playwright smoke green in CI; `review-external-pr` dry-run on PR #339 recorded in `docs/delivery/S0.md`.

**S1 gate (owner UAT + accountant sign-off):** `apps/admin/src/__tests__/integration/ownerOrderRegression.test.ts` promotes the real (masked) order and asserts all 11 sections; `orderImportFailures.test.ts` (10 scenarios) green; `apps/admin/e2e/orders.spec.ts` four specs green; side-by-side comparison of the order in Shopify admin vs IRTH OS on the owner's phone; a webhook dropped on purpose imported by the 15-min scan; reservation → FEFO → Bosta sandbox booking → Shopify fulfilment write-back visible; COD remittance CSV matched; `orderRecognition.test.ts` + `multiEntityLedger.test.ts` green and the accountant reviews the parent/brand pair on the fixture; audit viewer shows the chain; owner home shows reports 2/1/6 with freshness + coverage.

**S2 gate:** Woo fixture promotes with zero provider branches (grep-asserted); manual order passes the same gate; `pos.test.ts` (idempotent completion, ATP gate, refund to quarantine, till variance); `production.test.ts` (WIP round-trip to zero, period-spanning batch, QC gate); **`mockRecall.test.ts` passes before any lot-tracked product is sold**; `openingStock.test.ts` + owner sample check of 10 SKUs; `inventoryInvariants.test.ts` on every IN PR; ACC-01 decision issue closed.

**S3 gate:** `threeWayMatch.test.ts`, `apAging.test.ts`, `landedCost.test.ts`, `supplierPortalScope.test.ts` (cross-supplier 404 by RLS + DTO whitelist snapshot), `transfers.test.ts`, `dispositions.test.ts`; Paymob sandbox settlement reconciled; parent e-invoice accepted on the ETA sandbox then production; supplier UAT (invite → acknowledge → ASN → bill → payment status).

**S4 gate:** `periodClose.test.ts`, `consolidation.test.ts` (4-entity fixture with one EUR entity: consolidated TB = 0, IC eliminated, rate change moves only BS + CTA); the accountant closes one real month for all four entities in the system and signs the evidence row.

**S5 gate:** pixel events from a real storefront visit appear in `events` within 60s and in `funnel_daily` next day with a coverage statement; `v1.*.test.ts` (scope, envelope) + a key created in Settings reads orders and is 403 on writes; `mcp.*.test.ts` + Claude Desktop connects via OAuth, lists 13 tools, and `irth_propose_refund` creates an approvals row; a scheduled Instagram post publishes and its insights render; IG/FB DMs appear in the inbox tied to the customer.

**Restore drill (any slice, DL-13/CX-07):** restore an encrypted backup to a scratch branch, re-enter the KEK, run the gates — recorded once per slice in `docs/delivery/S<n>.md`.

---
*Sources for every packet: `docs/delivery/packets/{DM,OR,IN,CX,AN,DL}.md` (committed by DL-00). Research provenance: sol review, astra critique, 9-agent synthesis — see §1.*
