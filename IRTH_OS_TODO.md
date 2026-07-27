# 🛠️ irth-os Code Refactoring & Production Todo List

This document serves as the unified checklist of structural schema changes, manual code fixes, dependency alignments, and CI/CD pipelines needed to bring **irth-os** into a fully secure and robust production state.

---

## 🗄️ 1. Database Schema Unification (`packages/db`)
All domain schemas have been refactored to replace incorrect `text` identifiers with unified `uuid` columns mapped directly to active organizational accounts. 

### Applied Code Upgrades:
- [x] **`campaigns.ts`**: Upgraded `orgId` column definition:
  ```typescript
  orgId: uuid("org_id").notNull().references(() => organizations.id)
  ```
- [x] **`inventory.ts`**: Upgraded `orgId` column definition:
  ```typescript
  orgId: uuid("org_id").notNull().references(() => organizations.id)
  ```
- [x] **`orgSettings.ts`**: Upgraded `orgId` column definition:
  ```typescript
  orgId: uuid("org_id").notNull().references(() => organizations.id)
  ```
- [x] **`outbox.ts`**: Upgraded `orgId` column definition:
  ```typescript
  orgId: uuid("org_id").notNull().references(() => organizations.id)
  ```
- [x] **`pricelists.ts`**: Upgraded `orgId` column definition:
  ```typescript
  orgId: uuid("org_id").notNull().references(() => organizations.id)
  ```
- [x] **`shippingZones.ts`**: Upgraded `orgId` column definition:
  ```typescript
  orgId: uuid("org_id").notNull().references(() => organizations.id)
  ```
- [x] **`stocktaking.ts`**: Upgraded `orgId` column definition:
  ```typescript
  orgId: uuid("org_id").notNull().references(() => organizations.id)
  ```

### Next Steps for Database:
- [ ] Run database migration scripts to generate new schema diffs:
  ```bash
  pnpm --filter @irth/db drizzle-kit generate
  ```
- [ ] Review the generated SQL migration file under `packages/db/drizzle/` to verify it alters columns from `text` to `uuid` safely without losing data.
- [ ] Execute dry-run migrations against a staging database instance.

---

## 🔐 2. RBAC Permissions Matrix Expansion (`packages/db`)
The RBAC security layer has been successfully expanded to programmatic limits.

### Applied Security Upgrades:
- [x] **`permissions.ts`**: Expanded the matrix from **3 resources** to **12 core modules** to protect ERP modules.
  ```typescript
  export const PERMISSIONS = {
    products: { ... },
    categories: { ... },
    members: { ... },
    orders: {
      view: ['owner', 'admin', 'member'],
      write: ['owner', 'admin'],
      delete: ['owner'],
    },
    coupons: {
      view: ['owner', 'admin', 'member'],
      write: ['owner', 'admin'],
      delete: ['owner'],
    },
    campaigns: {
      view: ['owner', 'admin', 'member'],
      write: ['owner', 'admin'],
      delete: ['owner'],
    },
    inventory: {
      view: ['owner', 'admin', 'member'],
      write: ['owner', 'admin'],
      delete: ['owner'],
    },
    returns: {
      view: ['owner', 'admin', 'member'],
      write: ['owner', 'admin'],
      delete: ['owner'],
    },
    purchasing: {
      view: ['owner', 'admin', 'member'],
      write: ['owner', 'admin'],
      delete: ['owner'],
    },
    finance: {
      view: ['owner', 'admin'],
      write: ['owner'],
      delete: ['owner'],
    },
    customers: {
      view: ['owner', 'admin', 'member'],
      write: ['owner', 'admin'],
      delete: ['owner'],
    },
    courier: {
      view: ['owner', 'admin', 'member'],
      write: ['owner', 'admin'],
      delete: ['owner'],
    },
  } as const;
  ```

---

## ⚙️ 3. API & Middleware Hardening (`apps/api`)
- [ ] **Manual Fix**: Open `apps/api/package.json` and add a `typecheck` validation script:
  ```json
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  }
  ```
- [ ] **Security Sanitization**: Ensure the Cloudflare `account_id` in `apps/api/wrangler.toml` is removed or loaded strictly via environment variables during CI runs.
- [ ] **Dependency Realignment**: Move hoisted packages (such as `@trpc/server`, `zod`, and `drizzle-orm`) out of the root `package.json` and pin them directly in `apps/api/package.json`.

---

## 🖥️ 4. Admin Dashboard (`apps/admin`)
- [ ] **Localisation Coverage**: Populate `apps/admin/messages/en.json` with matching translation keys to support complete Arabic-English localization toggles.
- [ ] **Type-Safety Checks**: Run a local check to fix any remaining `tsc` compilation warnings:
  ```bash
  pnpm --filter @irth/admin run build
  ```

---

## 📱 5. Mobile App Alignment (`apps/mobile`)
- [ ] **Shared Dependency Coupling**: Link `apps/mobile` workspace to local `@irth/types` inside the monorepo workspace.
- [ ] **CI Tasks Integration**: Register mobile typecheck command into Turborepo:
  - Add `"typecheck": "tsc --noEmit"` in `apps/mobile/package.json`.
  - Update `turbo.json` task orchestration to run `typecheck` recursively.

---

## 🚀 6. CI/CD & Deploy Engine
- [ ] **Establish GitHub Action Gate**: Save a clean `.github/workflows/ci.yml` pipeline workflow:
  ```yaml
  name: CI Pipeline

  on:
    pull_request:
      branches: [main]

  jobs:
    test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: pnpm/action-setup@v3
          with:
            version: 10.30.3
        - uses: actions/setup-node@v4
          with:
            node-version: 20
            cache: 'pnpm'
        - run: pnpm install --frozen-lockfile
        - run: pnpm turbo lint typecheck test
  ```
- [ ] **Set Secrets**: Configure production API keys for Paymob, Bosta, Resend, ETA Client, and Supabase pooled connection strings inside GitHub repository secrets.
