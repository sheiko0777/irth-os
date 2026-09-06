# Baseline — IRTH OS Implementation Plan

**Reviewed commit (per the plan):** `6dcf2df40b44e6b9b71979775eac1c393afd9a37`
**Current `origin/main` HEAD at Phase 0 completion:** `6dcf2df40b44e6b9b71979775eac1c393afd9a37` — identical. No reconciliation needed; the plan's finding evidence is current, not stale.

## Phase 0 business decisions (owner-confirmed, 2026-09-05)

| Question | Answer |
|---|---|
| Sales channels | **Multiple** — Shopify + marketplace (Noon/Amazon-class) + physical/in-person (POS) + wholesale/B2B direct + social commerce (Instagram/TikTok/WhatsApp). Not Shopify-only. |
| Currency at launch | **Multi-currency required**: EGP + USD + EUR + Gulf currencies (AED/SAR/etc.). Not the plan's EGP-only conservative default. |
| Authoritative ledger during migration/pilot | **IRTH OS is authoritative.** Shopify is the storefront, not the books. |
| Inventory complexity needed now (not later) | **All three**: batches/expiry/FEFO/recall tracking, bundles/kits (component consumption), wholesale credit terms/partner portals. |
| ETA e-invoice/e-receipt | **Mandatory now** — not deferrable to Phase 5. Official signing/certification is a real, external-approval-gated dependency (F16). |
| Approval authority | Role-based (owner/admin + manager-type staff), **no amount thresholds defined yet** — enforce via existing RBAC (`can()`/`requirePermission`), thresholds to follow once defined. |
| Scale | ~1000 orders/day, 450 active SKUs, 3 live tenants/orgs already, 2 warehouses, 50-100 staff users. **This is a live production system with real concurrent volume today — not pre-launch.** |
| Outage/data-loss tolerance | No incident history to calibrate against — using the plan's suggested defaults: 99.9% monthly availability, RPO ≤ 15 min, RTO ≤ 2 hr (placeholders to formalize later, not measured guarantees). |
| Multi-tenant/multi-org | Already live with multiple orgs today (not a future concern — F08's legacy-fallback scoping and F18's RLS enforcement are live risks right now). |
| Long-term architecture goal (owner's own words) | System must stay flexible under growth/load, support adding/editing/removing stores/brands/members/staff, and connect to external analytics + e-commerce platforms, collecting data from connected sites/platforms. This matches the plan's own Section 4 provider-adapter architecture — no conflict with sequencing below. |

## Sequencing decision

**Owner chose: core P0 correctness fixes (F01-F09) first, against today's Shopify+EGP-primary baseline.** Multi-channel, full multi-currency/FX, ETA-mandatory certification, and wholesale/partner-portal scope become an explicit follow-on phase (informally "Phase 0.5"), planned once the core correctness work lands — not squeezed into the same increment. This still uses the plan's shared-adapter architecture so the later expansion doesn't require rework.

## Environment limits discovered this session

- **`E:\irth-os`'s local pnpm store is corrupted** — several packages (`typescript`, `vitest`, likely others) resolve to empty directories under `node_modules/.pnpm/`, despite valid-looking symlinks. `tsc --noEmit` and `vitest run` both fail locally with `MODULE_NOT_FOUND` on totally unrelated files, confirming this is pre-existing environment damage, not something introduced by this session's changes. **Not fixed as part of this work** — a `pnpm install --force` is the likely remedy but is a separate, slow (10-30 min per prior notes), risky-to-interrupt operation outside this task's scope. CI (fresh install on GitHub Actions) is unaffected and is the real verification for every change until this is repaired locally.
- **`apps/api` has no real-Postgres integration test suite** — unlike `apps/admin` (`test:integration` against a disposable Neon branch via `TEST_DATABASE_URL`), `apps/api`'s `test` script (`vitest run`) is fully mocked, no real Postgres. The plan requires real-PostgreSQL regression tests for financial/stock fixes where constraints/locks/RLS/transactions matter; F01's fix here is tested against the actual decision logic with a focused mock (proven to reproduce the exact defect and its fix), not real Postgres. **Flagged as a follow-up**, not solved in this pass — closing it properly means mirroring `apps/admin`'s integration harness for `apps/api`, plus wiring a corresponding CI job, which is its own scoped piece of work.
