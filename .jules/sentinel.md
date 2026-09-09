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
