# irth-os — Phased Development Plan

MVP tag: `v0.1-mvp` (current commit)

---

## Phase 1 — MVP (test & stabilize first)

**Goal:** Login → create org → add products → receive orders → ship.

| Module | Router | Pages | Status |
|--------|--------|-------|--------|
| Platform Admin | `platformAdmin` | `/platform-admin` | ✅ done |
| Auth (invite flow) | — | `/login` `/join` | ✅ done |
| Dashboard | `dashboard` | `/` | ✅ done |
| Orders | `orders` | `/orders` `/orders/[id]` `/orders/[id]/print` | ✅ done |
| Products | `products` | `/products` `/products/new` `/products/[id]/edit` | ✅ done |
| Categories | `categories` | `/categories` | ✅ done |
| Customers | `customers` | `/customers` `/customers/[id]` | ✅ done |
| Inventory | `inventory` | `/inventory` | ✅ done |
| Settings | `settings` `members` | `/settings` `/settings/members` | ✅ done |

**Done when:** Platform admin creates org → owner joins via invite → adds products → receives & ships an order.

---

## Phase 2 — Operations

| Module | Router | Pages |
|--------|--------|-------|
| Stocktaking (جرد) | `stocktaking` | `/stocktaking` |
| Returns (مرتجعات) | `returns` | `/returns` `/returns/[id]` |
| Purchasing + Suppliers | `purchasing` | `/purchasing` `/purchasing/suppliers` |
| Shipping Zones | `shipping` | `/shipping` |

---

## Phase 3 — Commerce Tools

| Module | Router | Pages |
|--------|--------|-------|
| Coupons | `coupons` | `/coupons` |
| Campaigns | `campaigns` | `/campaigns` |
| Pricelists | `pricelists` | `/pricelists` |
| Gift Cards | `giftCards` | `/gift-cards` |
| Customer Segments | `customerSegments` | `/customer-segments` |

---

## Phase 4 — Analytics & Finance

| Module | Router | Pages |
|--------|--------|-------|
| Analytics | `analytics` | `/analytics` |
| Finance + AI Query | `finance` | `/finance` |

---

## Phase 5 — Integrations & Compliance

| Module | Router | Pages |
|--------|--------|-------|
| Courier Settlement (Bosta) | `courier` | `/courier` |
| ETA E-Invoices | `eta` | `/eta` |
| Notifications (WhatsApp/email) | `notifications` | `/notifications` |
| Integrations Config | `integrations` | `/integrations` |

---

## Rules per phase

1. **Finish + test one phase before starting next**
2. **Each module = one router file + one page folder** — never mix
3. **DB changes = new migration file only** — never edit existing migrations
4. **No new dependencies without reason** — reuse existing stack
5. **Feature flags** via `org_feature_flags.enabled_screens` — hide unfinished phases per org

---

## Current stack (frozen for MVP)

- Next.js 15.3 + React 19 + TypeScript strict
- tRPC v11 (protectedProcedure, platformAdminProcedure)
- Drizzle ORM + Supabase PostgreSQL
- Better Auth (sessions, org membership)
- Tailwind + CSS vars (`--t1/t2/t3` `--gold` `--emerald` `--crimson` `--surface` `--rim1/rim2`)
- pnpm monorepo: `apps/admin` `apps/api` `apps/mobile` `packages/db`
