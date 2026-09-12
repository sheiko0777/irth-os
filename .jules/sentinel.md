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
