# irth-os Mind Map

Below is a comprehensive structural and conceptual mind map of **irth-os**, mapped out by functional layers, core architectural concepts, and dependencies.

```
                                  [ irth-os Monorepo ]
                                           │
         ┌─────────────────────────────────┼─────────────────────────────────┐
         │                                 │                                 │
  [ apps/ (Applications) ]         [ packages/ (Library Core) ]     [ Deploy & Infra ]
         │                                 │                                 │
         ├── admin/ (Next.js 15)           ├── db/ (Drizzle ORM)             ├── Wrangler (.toml)
         │    ├── tRPC Client              │    ├── Schema (14 Tables)       │    ├── wrangler.toml
         │    ├── Cairo Font (RTL)         │    │    ├── orgId Scoping       │    └── Account Identifiers
         │    ├── next-intl (ar.json)      │    │    └── UUID vs Text        ├── GitHub Actions
         │    └── [locale] Routing         │    ├── RBAC Permissions         │    └── deploy.yml
         │                                 │    │    └── can(role, res, act) └── Cloudflare Services
         ├── api/ (Hono.js Worker)         │    └── withAudit Middleware          ├── CF Workers (API)
         │    ├── Better Auth 1.2          │                                      ├── CF Pages (Admin)
         │    ├── authContext.ts           ├── emails/ (Resend)                   └── CF R2 Assets
         │    ├── requireRole.ts           │    └── react-email templates
         │    ├── Webhook Verification     │
         │    └── Routing Endpoints        ├── types/ (Shared Types)
         │                                 │
         └── mobile/ (Expo Router)         └── utils/ (Shared Helpers)
              ├── Expo 52 / React Native
              ├── i18next Locale
              └── (Needs Db/Types sync)
```

---

## 1. Frontend Layer (`apps/admin`)
- **Framework**: Next.js 15+ (App Router), deployed via Cloudflare Pages.
- **State & Data Fetching**: tRPC Client communicating with the Hono.js API, coupled with React Query.
- **Internationalization (i18n)**: `next-intl` routing using `[locale]`. RTL direction (`dir="rtl"`) powered by Cairo font (primary language: Arabic `ar.json`, English fallback stub `en.json`).
- **Styling**: Tailwind CSS configured with RTL support (`tailwindcss-rtl` or native logical properties).

## 2. API & Authentication Layer (`apps/api`)
- **Runtime**: Hono.js running on lightweight V8 isolates via Cloudflare Workers.
- **Authentication**: Better Auth (v1.2+) with the multi-tenant Organization plugin.
- **Middleware Chain**:
  - `cors` and `securityHeaders` for browser hygiene.
  - `rateLimit` (pre-configured limiters).
  - `authContext` to derive active `userId`, `orgId`, and `role` securely from sessions. **Strict safety rule**: Client headers (`org_id` / `user_id`) are discarded.
  - `requireRole` to guard endpoints using RBAC.
  - `audit` middleware to record events securely using database transaction contexts.
  - `verifyWebhook` specifically configured to validate secure incoming payload signatures (e.g., Paymob, Bosta, ETA) bypassing session auth.

## 3. Core Database Layer (`packages/db`)
- **ORM & Client**: Drizzle ORM configured with `postgres` driver connected to Supabase PostgreSQL.
- **Database Migrations**: Managed via Drizzle Kit (`drizzle.config.ts`), generating SQL files under `packages/db/drizzle`.
- **Database Schema**:
  - Multi-tenant architecture using the `baseColumns` pattern, forcing an `orgId` column on nearly all records.
  - Core Modules:
    - *Auth/Tenancy*: `organizations`, `orgMembers`, `orgInvites`.
    - *Catalog*: `categories`, `products`, `productVariants`.
    - *Orders*: `orders`, `orderItems`, `shipmentTracking`.
    - *Infrastructure*: `auditLog`, `activityLog`, `notifications`.
    - *Extended ERP*: `couriers`, `etaInvoices`, `inventory`, `orgSettings`, `outbox`, `pricelists`, `purchasing`, `returns`, `shippingZones`, `stocktaking`, `customers`, `coupons`, `campaigns`.
- **RBAC Engine**: Matrix configured in `permissions.ts` that enforces programmatic permissions based on `owner`, `admin`, and `member` roles.

## 4. Mobile Client Layer (`apps/mobile`)
- **Framework**: React Native with Expo 52 and File-based navigation (`expo-router`).
- **State Management**: `@tanstack/react-query` + standard hooks.
- **Form Handling**: `react-hook-form` + `@hookform/resolvers` + `zod` schema validation.
- **Locale Integration**: Configured with `i18next` for runtime translations.

## 5. Deployment & CI/CD Pipeline
- **Monorepo Manager**: Turborepo (`turbo.json`) orchestration ensuring dependencies build in strict topological order (`^build`).
- **Package Manager**: `pnpm@10.30.3` pinning workspace configurations (`pnpm-workspace.yaml`).
- **Cloudflare Ecosystem**:
  - **Workers**: API endpoints served serverlessly.
  - **Pages**: Next.js App Router deployed statically or through edge SSR.
  - **R2 Buckets**: Asset storage bound to `R2` inside `wrangler.toml`.
