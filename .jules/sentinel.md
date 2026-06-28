## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2024-06-28 - Cross-Tenant IDOR in Relational Fields (tRPC)
**Vulnerability:** The admin tRPC routers for `products` and `categories` accepted foreign keys (`categoryId`, `parentId`) in mutations without verifying they belonged to the authenticated tenant (`ctx.orgId`). Input validation merely verified UUID format. This allowed an authenticated user to attach their resources to another organization's categories by providing a known or brute-forced UUID.
**Learning:** Zod schema validation (e.g. `.uuid()`) is insufficient for cross-tenant isolation in multi-tenant architectures.
**Prevention:** Always validate user-provided relational fields (foreign keys) by querying the database to ensure the referenced entity belongs to the authenticated tenant (`orgId`) before performing inserts or updates.
