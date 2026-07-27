# irth-os Production Deployment Phase Plan

This document outlines the systematic strategy for taking **irth-os** from local workspaces into a secure, robust, and highly available Cloudflare + Supabase production environment.

---

## Phase 1: Code Sanitization & Pre-Flight Hardening
Before provisioning production infrastructure, security vulnerabilities and code discrepancies identified during the codebase audit must be eliminated.

### 1.1 DB Schema & Multi-Tenancy Unification
- **The Issue**: Mixed types for `orgId` (some tables use `uuid` while others use `text`).
- **Task**: Convert all occurrences of `orgId` inside `packages/db/src/schema/*.ts` to use consistent `uuid` columns referenced against `organizations.id`.
- **Action**: Run `pnpm --filter @irth/db drizzle-kit generate` and apply the generated migrations to verify consistency.

### 1.2 RBAC Matrix Consolidation
- **The Issue**: Permissions matrix in `permissions.ts` only guards 3 resources (`products`, `categories`, `members`). Newer domain operations bypass formal RBAC schema definitions.
- **Task**: Expand the `PERMISSIONS` object in `packages/db/src/permissions.ts` to cover all transaction layers:
  - `orders`: `view` (all), `write` (owner/admin), `delete` (owner)
  - `coupons` / `campaigns`: `view` (all), `write` (owner/admin)
  - `inventory` / `stocktaking`: `view` (all), `write` (owner/admin)
  - `finance` / `etaInvoices`: `view` (owner/admin), `write` (owner)

### 1.3 Dependency & Lint Consolidation
- **Task**: Remove app-specific dependencies mistakenly hoisted to the root `package.json` (such as `@trpc/*`, `@hookform/resolvers`, etc.) and pin them explicitly under their respective workspaces.
- **Task**: Align `zod` library versions across the workspaces to use `^4.4.3` to avoid runtime type clashes.
- **Task**: Integrate a type-check task for `apps/api` and `apps/mobile` into `turbo.json`. Include `pnpm turbo type-check` as a non-bypassable CI script gating pull requests.

---

## Phase 2: Production Infrastructure Provisioning
Provisioning the underlying services on Cloudflare and Supabase.

### 2.1 Database Provisioning (Supabase PostgreSQL)
1. **Provision Enterprise Instance**: Spin up a multi-AZ production Supabase project located geographically close to the target market (e.g., EU-Central or ME-West if available, to reduce latency to Egypt).
2. **Enable Connection Pooling**: Secure a transaction-mode connection pooler URL (e.g., Supavisor port `6543`) to prevent Cloudflare Worker isolates from exhausting database connections.
3. **Run Production Migrations**: Run the Drizzle migration suite:
   ```bash
   pnpm --filter @irth/db drizzle-kit migrate
   ```

### 2.2 Cloudflare Infrastructure Setup
1. **Provision R2 Bucket**: Create a bucket named `irth-assets` in production to hold images, documents, and assets.
2. **Domain Registration**: Delegate the root domain (e.g., `irth.eg` or `irth.com`) to Cloudflare Nameservers to enforce global DNS proxying, SSL/TLS termination, and Edge WAF.
3. **Configure Edge Routing**:
   - `admin.irth.eg` pointing to Cloudflare Pages (Dashboard).
   - `api.irth.eg` pointing to Cloudflare Workers (Hono API).

---

## Phase 3: CI/CD Pipeline & GitHub Actions Setup
Integrate secure automatic delivery paths.

### 3.1 Environment Variable & Secret Injection
Configure secrets in the GitHub Repository under **Settings > Secrets and variables > Actions**:

| Secret Key | Description | Target Environment |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Auth token with Pages/Workers deploy permission | CI/CD Runner |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier | CI/CD Runner |
| `DATABASE_URL` | Transaction pooled Supabase connection string | `apps/api` / `packages/db` |
| `BETTER_AUTH_SECRET` | Secret key used to encrypt Auth cookies | `apps/api` |
| `PAYMOB_API_KEY` | Payment Integration Key | `apps/api` (Secret) |
| `BOSTA_API_KEY` | Shipping Courier API token | `apps/api` (Secret) |
| `ETA_CLIENT_SECRET` | Egyptian Tax Authority integration credentials | `apps/api` (Secret) |
| `RESEND_API_KEY` | Transactional email provider token | `apps/api` / `packages/emails` |

### 3.2 Establish `.github/workflows/ci.yml` (The PR Gate)
Create a robust validation action that ensures code is perfectly safe before merging into `main`:
```yaml
name: CI Gate

on:
  pull_request:
    branches: [main]

jobs:
  validate:
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
      - run: pnpm turbo lint type-check test
```

### 3.3 Establish `.github/workflows/deploy.yml` (The Deployment Engine)
Configure deployment on merges to `main`:
```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
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
      - run: pnpm turbo build
      
      # Deploy API Worker
      - name: Deploy API to Cloudflare Workers
        run: pnpm --filter @irth/api run deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          
      # Deploy Admin Dashboard
      - name: Deploy Admin to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy apps/admin/.next --project-name=irth-admin
```

---

## Phase 4: Production Handshake & Dry-Run Verification

### 4.1 Dry-Run System Verification
- **Health Checks**: Access `https://api.irth.eg/health` to verify Worker availability, DB pool responsiveness, and Hono routing.
- **Localization RTL Rendering**: Open `https://admin.irth.eg/ar` to confirm assets (Cairo font) load securely via CDN and Tailwind RTL properties align perfectly.
- **Tenant Onboarding Flow**: Perform an registration test. Verify that:
  1. Organization record is successfully generated with a secure UUID.
  2. Owner membership is injected.
  3. `auditLog` receives a transaction trace with corresponding changesets.

### 4.2 Webhook & Integration Handshake
- Register production webhook endpoints inside Paymob, Bosta, and ETA portals.
- Trigger test webhooks to ensure Hono's `verifyWebhook` middleware handles headers/signatures correctly and translates payouts to order transitions.

### 4.3 Zero-Downtime Rollback Plan
In the event of a catastrophic failure:
1. **Cloudflare Pages Rollback**: Revert to the previous deployment instantly inside the Cloudflare Dashboard with zero static asset downtime.
2. **Workers Rollback**: Deploy the last known-good tag via Wrangler CLI within seconds:
   ```bash
   wrangler rollback <DEPLOYMENT_ID>
   ```
3. **DB Migration Contingency**: Ensure every Drizzle migration schema change has a manual down-migration playbook in case destructive field drops fail.
