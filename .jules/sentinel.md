## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2024-06-22 - Weak Random Number Generation in Invite OTPs
**Vulnerability:** The `generateInviteOtp` function used `Math.random()` to generate the 6-digit OTP code for organization invites.
**Learning:** `Math.random()` is not cryptographically secure and its outputs can be predicted if the internal state of the PRNG is known. This makes the generated OTPs vulnerable to prediction/brute-forcing. Even if brute-force is mitigated by `otpAttempts`, a predicted OTP completely bypasses the security intent.
**Prevention:** Always use cryptographically secure random number generators (CSPRNG) such as `crypto.getRandomValues` or Node's `crypto.randomBytes` / `crypto.randomInt` for generating any security-sensitive tokens, passwords, or OTPs.

## 2025-02-24 - IDOR in Notifications Endpoint
**Vulnerability:** The notification endpoints in `apps/admin/src/server/routers/notifications.ts` (list, markRead, markAllRead, unreadCount) failed to scope queries to `userId`, allowing any member of an organization to access and modify notifications for all other users within the same organization.
**Learning:** While `ctx.withOrg` and `orgId` filters properly restrict access to the tenant level, user-specific resources like notifications must also be explicitly scoped with `eq(notifications.userId, ctx.userId)` to prevent horizontal privilege escalation (IDOR) within the organization.
**Prevention:** Always verify that endpoints serving user-specific data apply both the tenant filter (`orgId`) and the user filter (`userId`).

## 2025-02-24 - Weak Random Number Generation in Gift Card Codes
**Vulnerability:** The `generateCode` function in `apps/admin/src/server/routers/giftCards.ts` used `Math.random()` to generate characters for gift card codes.
**Learning:** `Math.random()` is not cryptographically secure, and its outputs can be predicted if the internal state of the PRNG is known or deduced over time. This makes financial artifacts like gift cards vulnerable to being guessed and stolen by malicious actors.
**Prevention:** Always use cryptographically secure pseudo-random number generators (CSPRNG) such as `crypto.getRandomValues` or Node's `crypto.randomBytes` / `crypto.randomInt` for generating security-sensitive, financial, or authentication codes.

## 2025-02-24 - Broken Access Control in Org Members List
**Vulnerability:** The `/orgs/:id/members` GET endpoint in `apps/api/src/routes/orgs.ts` lacked any RBAC middleware, allowing any member of an organization to list all other members, bypassing the `members.view` permission intended for owners and admins only.
**Learning:** Missing `requireRole` or `requirePermission` middleware on API routes leads to authorization bypasses, even if the tenant (`orgId`) filter is correctly applied. The API layer's RBAC matrix must precisely match the admin panel's trpc router matrix.
**Prevention:** Always apply the appropriate role or permission checking middleware (e.g., `requireRole` or `requirePermission`) to all endpoints exposing organization-level data, matching the security matrix in `packages/db/src/permissions.ts`.

## 2024-06-25 - Broken Access Control in API Orders Endpoints
**Vulnerability:** The `/`, `/:id` GET and `/` POST endpoints in `apps/api/src/routes/orders.ts` only checked for tenant isolation using `requireOrgId()`, lacking any RBAC middleware. This allowed any organization member (even those without 'orders' 'view' or 'write' permissions) to view all orders and create new ones.
**Learning:** Checking for `orgId` presence provides tenant isolation but does not provide authorization. All API endpoints exposing or modifying resources must explicitly require the appropriate permissions using `requirePermission(resource, action)`.
**Prevention:** Always replace generic `requireOrgId()` guards with `requirePermission(resource, action)` when the endpoint accesses a resource mapped in the RBAC matrix (`packages/db/src/permissions.ts`), ensuring the API layer's security matches the tRPC routers.

## 2024-10-18 - Authorization Bypass in Activity Log
**Vulnerability:** The `GET /activity` endpoint in `apps/api/src/routes/notifications.ts` used `requireOrgId()` to enforce tenant isolation but lacked any RBAC middleware (such as `requireRole('owner', 'admin')`).
**Learning:** Tenant isolation (`requireOrgId`) prevents users from reading cross-tenant data, but it does not prevent horizontal privilege escalation. Any authenticated user in an organization could read its entire audit history (`activityLog`).
**Prevention:** Sensitive organization endpoints, especially those dealing with audit logs, financial records, or configuration, must always have role-based authorization explicitly enforced (e.g., `requireRole('owner', 'admin')`) in addition to tenant scoping.

## 2025-02-24 - Missing Authorization Guard on Products API Endpoints
**Vulnerability:** The API endpoints for viewing products in `apps/api/src/routes/products.ts` (`GET /`, `GET /:id`, `GET /:id/variants`) only used the `requireOrgId()` middleware, meaning any authenticated member of the organization could access them regardless of their specific permissions.
**Learning:** `requireOrgId()` only enforces tenant isolation, preventing cross-organization access. It does not enforce role-based access control (RBAC) within the organization itself. If an endpoint requires a specific permission per the matrix in `packages/db/src/permissions.ts`, it must use `requirePermission()`.
**Prevention:** Always use `requirePermission(resource, action)` instead of `requireOrgId()` for endpoints that expose or manipulate resources mapped in the authorization matrix.

## 2026-09-14 - Authorization Bypass in API Shipping Endpoint
**Vulnerability:** The `/api/shipping/create` POST endpoint in `apps/api/src/routes/shipping.ts` only used the `requireOrgId()` middleware, allowing any authenticated member of the organization to access it regardless of their specific permissions.
**Learning:** `requireOrgId()` only enforces tenant isolation, preventing cross-organization access. It does not enforce role-based access control (RBAC) within the organization itself. Endpoints mapping to specific resources in the authorization matrix (`packages/db/src/permissions.ts`) must explicitly use `requirePermission()`.
**Prevention:** Always use `requirePermission(resource, action)` instead of `requireOrgId()` for endpoints that expose or manipulate resources mapped in the authorization matrix.

## 2024-06-25 - Redundant Inline Authorization Checks in Shopify Routes
**Vulnerability:** The API endpoints for the Shopify integration (`/connect`, `/status`, `/locations`, `/location`) in `apps/api/src/routes/shopify.ts` were utilizing manual inline authorization checks (`if (!can(role, ...))`) instead of the centralized `requirePermission` middleware. While not an immediate vulnerability, this pattern increases the risk of accidental bypasses or inconsistent access control if the inline checks are forgotten during future modifications.
**Learning:** Manual inline checks require developers to remember to add and correctly implement them in every relevant route, which is prone to error. Using route-level middleware enforces access control systematically and makes it visibly apparent.
**Prevention:** Always use route-level middleware like `requirePermission` to enforce authorization in Hono API routes. Remove any redundant inline checks when the middleware is applied to simplify the code and prevent duplicate logic.

## 2025-02-24 - Broken Access Control in API Org Members Endpoint
**Vulnerability:** The `/orgs/:id/members`, `/orgs/:id/invite`, and `/orgs/members/:memberId/role` endpoints in `apps/api/src/routes/orgs.ts` utilized `requireRole` instead of the centralized `requirePermission` middleware. This bypassed the authorization matrix defined in `packages/db/src/permissions.ts`.
**Learning:** Using `requireRole` directly instead of checking against the established `requirePermission(resource, action)` skips the centralized role definition mechanism for resources. This means that if permission definitions change in `permissions.ts`, the API routes would silently remain out of sync. Furthermore, relying only on `requireRole` can inadvertently overlook tenant isolation if `requireOrgId` is skipped.
**Prevention:** Always secure API endpoints mapping to resources defined in the authorization matrix with a combination of `requireOrgId()` and `requirePermission(resource, action)` instead of relying solely on `requireRole(...)`.
## 2024-06-25 - Missing Authorization Guard on API Endpoints
**Vulnerability:** Several Hono API endpoints (`categories`, `orders`, `products`, `shipping`) only checked for tenant isolation via `requirePermission` or relied on `requireRole` directly. The `requireOrgId()` middleware was completely omitted on `products`, `categories`, and `shipping` routes.
**Learning:** `requireOrgId()` establishes necessary tenant isolation and sets context parameters. Omitting it completely circumvents the primary defense-in-depth perimeter, potentially exposing cross-tenant data. `requirePermission` must be composed sequentially *after* `requireOrgId()`. Also, directly using `requireRole` skips the centralized RBAC matrix.
**Prevention:** Always use `requireOrgId()` sequentially before `requirePermission()` on Hono API endpoints, and ensure endpoints mapped to the authorization matrix explicitly use `requirePermission` rather than raw `requireRole` checks.

## 2025-03-01 - Missing Tenant Isolation in Products and Orders Routes
**Vulnerability:** The `requirePermission` checks in the `products` and `orders` routes were un-isolated (not composed with `requireOrgId()`), allowing requests to potentially bypass tenant-level restrictions or crash on incomplete context, leading to a breakdown of both authorization and isolation.
**Learning:** `requirePermission` does not guarantee isolation on its own; it requires standard role context to function properly, but tenant scoping and isolation must be deliberately enforced first.
**Prevention:** Always compose `requireOrgId()` followed by `requirePermission(resource, action)` to guarantee robust tenant isolation combined with granular authorization control.

## 2025-02-24 - Missing Authorization Guard on Categories API Endpoints
**Vulnerability:** The API endpoints for interacting with categories in `apps/api/src/routes/categories.ts` only used the `requirePermission()` middleware, meaning any authenticated user could access them regardless of their organization, leading to a cross-tenant data leak if they supply a different `orgId` as `requireOrgId()` was missing. The same issue was found in `apps/api/src/routes/orders.ts` and `apps/api/src/routes/shipping.ts`. Furthermore, `apps/api/src/routes/products.ts` utilized `requireRole` instead of the centralized `requirePermission` middleware, bypassing the authorization matrix defined in `packages/db/src/permissions.ts`, and completely lacked `requireOrgId()`.
**Learning:** `requirePermission()` only checks for role permissions, but it relies on `requireOrgId()` to extract the `orgId` from the context (via `c.get('orgId')`) and enforce tenant isolation. Without `requireOrgId()`, the endpoint is vulnerable to cross-tenant attacks. Also, using `requireRole` directly instead of checking against the established `requirePermission(resource, action)` skips the centralized role definition mechanism.
**Prevention:** Always use `requireOrgId()` before `requirePermission(resource, action)` for endpoints that expose or manipulate resources mapped in the authorization matrix to ensure both tenant isolation and role-based access control are properly enforced. Never rely solely on `requireRole(...)`.
