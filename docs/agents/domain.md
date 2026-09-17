# Delivery map — prefixes, slices, routing, sizes

Read this before taking any task from the tracker. The plan of record is
`docs/superpowers/specs/2026-09-17-irth-os-bos-design.md`; full task packets are
under `docs/delivery/packets/`.

## Task ID prefixes

| Prefix              | Domain                                                                | Packet file                   |
| ------------------- | --------------------------------------------------------------------- | ----------------------------- |
| `DM-nn`             | Data model, tenancy, multi-entity, ledger, costing                    | `docs/delivery/packets/DM.md` |
| `OR-nn`             | Order ingestion, storefront parity, exceptions, reconciliation        | `docs/delivery/packets/OR.md` |
| `IN-nn`             | Inventory, lots/FEFO, manufacturing, POS, purchasing, supplier portal | `docs/delivery/packets/IN.md` |
| `CX-nn`             | Connectors/adapters, public API, MCP, auth, roles, approvals, audit   | `docs/delivery/packets/CX.md` |
| `AN-nn`             | Analytics, reports, observability                                     | `docs/delivery/packets/AN.md` |
| `DL-nn`             | Delivery system (this tracker, CI gates, review protocol)             | `docs/delivery/packets/DL.md` |
| `UI-nn`             | Design track (`docs/delivery/briefs/astra-ui-brief.md`)               | plan §9                       |
| `ACC-nn` / `OPS-nn` | Accountant / operations decisions (no code)                           | plan §7                       |

Where a packet and the plan disagree, the plan wins (plan §3 and §7.0 list the applied merges).

## Slices and gates (one line each — full gates in plan §4)

| Slice | Outcome                                                               | Gate in one line                                                                                                                                                                                                                        |
| ----- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S0    | Foundation minimum + this delivery system                             | all migrations apply on fresh and existing DBs; RLS/schema/tenancy gates green; `seedGroup()` fixture; tracker live; Playwright smoke in CI                                                                                             |
| S1    | The owner's real Shopify order end-to-end                             | order shows all 11 parity sections matching the Shopify admin; Import-blocked path works; reservation → FEFO lot → Bosta booking → fulfilment write-back → COD remittance → recognition posting → margin; audit chain; Playwright green |
| S2    | WooCommerce, manual DM orders, web POS, receiving, manufacturing-lite | same pipeline for Woo (no provider branches); idempotent POS sale + refund to quarantine; production through WIP; mock-recall test passes; opening stock loaded                                                                         |
| S3    | B2B, purchasing/AP, supplier portal, money-in/out, parent ETA         | invoice + terms + aging; supplier portal scoped by RLS; 3-way match; gateway settlement reconciled; parent e-invoice accepted                                                                                                           |
| S4    | Accounting workbench                                                  | accountant closes a month for all four entities in-system; consolidated TB balances with eliminations + CTA                                                                                                                             |
| S5    | Analytics, social, public API + MCP, automation caps                  | pixel → funnel report with coverage; scoped API key; MCP proposals land in approvals; Meta publish + inbox                                                                                                                              |

## Routing table (task type → executor)

| Task type                                                                                                                                                                        | Executor                         | Notes                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Migrations, `packages/db/src/schema/**`, `packages/db/src/index.ts` (`withOrgContext`), RLS/tenancy gates, Better Auth config, integrating others' PRs, every external-PR review | `exec:claude`                    | The schema half of any task is always Claude's                                                             |
| Ledger posting paths, WAC/reservation/lot allocation, ingestion receive → hydrate → promote, connector adapters, state machines, reconciliation, settlement matching             | `exec:codex`                     | Tier: `gpt-5.6-sol` default; `gpt-6-astra` only for RLS/race/security-critical; `gpt-5.6-terra` mechanical |
| Isolated PR-sized work with no migration and no real-Postgres dependency: admin screens over existing ops, CI yaml, scripts, unit tests, single-workspace refactors              | `exec:jules`                     | No migrations, lockfile, `.env`, auth config. Unit tests only; integration/RLS run in CI on the PR         |
| Research, docs, fixture masking, test scaffolds, SQL report drafts                                                                                                               | `exec:hermes`                    | Never money paths or schema; files-to-Claude until the DL-12 probe proves PRs                              |
| Decisions, real fixtures, UAT, gate sign-off                                                                                                                                     | `exec:owner` / `exec:accountant` | Decision issues carry a default that applies if unanswered                                                 |
| `apps/admin` presentation only                                                                                                                                                   | `exec:ui`                        | Never `apps/admin/src/server/**` or `packages/**` (except `packages/emails`)                               |

## Sizes

`S` ≤ half a day of agent work · `M` ≤ 2 days · `L` ≤ 5 days. Anything larger is split before it is published.

## Locked decisions and owner facts

Plan §1 (owner facts A1–A4 and rounds 1–4), §2 (architecture shape), §3 (conflict resolutions). Short form:

- Option B: keep the proven kernel (ledger, WAC, RLS, outbox, idempotency, numbering); rebuild the shell. Modular monolith; no generators, no workflow engine, no permission builder, no Postiz, no BI product.
- Unit of delivery = one complete business transaction; S1 = the owner's real failed order.
- A1 parent ships directly for every brand (flash title; monthly intercompany invoice). A2 only the parent is ETA-registered. A3 design two-stage manufacturing, single-step is the degenerate case. A4 the real order is the S1 regression fixture (masked in repo).
- Currencies EGP + EUR + SAR + AED from day one; one group-level customer with per-brand relationships.

## Domain documentation (consumer rules)

Before exploring a topic, read `CONTEXT-MAP.md` and the `CONTEXT.md` / `docs/adr/` of the app or package involved, if they exist; proceed silently if they do not. Use the glossary's vocabulary; if your output contradicts an ADR, say so explicitly instead of overriding it silently.
