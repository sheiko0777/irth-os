## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2024-11-21 - IDOR on Relational Foreign Keys (Categories Router)
**Vulnerability:** The `create` category endpoint in `apps/admin/src/server/routers/categories.ts` allowed setting a `parentId` but did not check if the referenced parent category belonged to the same `orgId`. A malicious user could link their category to another organization's category.
**Learning:** Zod schema validation (e.g., `.uuid()`) alone does not guarantee database row ownership. Cross-tenant isolation requires explicitly verifying foreign key references against the authenticated tenant's ID.
**Prevention:** To prevent IDOR vulnerabilities, always validate user-provided relational fields (e.g., `parentId`, `productId`) by querying the database to ensure the referenced entity belongs to the authenticated tenant (`orgId`) before performing inserts or updates.
