## 2025-01-09 - Cross-Tenant IDOR via Unverified Relational Fields in tRPC
**Vulnerability:** tRPC endpoints (e.g., `productsRouter.create` and `productsRouter.update`) allowed users to associate their entities with related records (e.g., `categoryId`) belonging to other organizations. While input schemas validated the UUID format, they failed to ensure the referenced category belonged to the authenticated user's `orgId`.
**Learning:** Input schema validation (like Zod's `.uuid()`) is insufficient for cross-tenant isolation. Accepting relational foreign keys without querying the database allows an attacker to map their resources to another tenant's resources, leading to potential data leakage or integrity violations.
**Prevention:** Always validate user-provided relational fields (foreign keys) by querying the database to ensure the referenced entity belongs to the authenticated tenant (`orgId`) before performing inserts or updates.

## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.
