## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2024-06-26 - Insecure Direct Object Reference (IDOR) on Foreign Keys
**Vulnerability:** In `apps/admin/src/server/routers/categories.ts` and `apps/admin/src/server/routers/products.ts`, users could specify `parentId` and `categoryId` values without the server verifying if the referenced category belonged to their organization (`orgId`), enabling cross-tenant data relationships.
**Learning:** Input schema validation (e.g., Zod's `.uuid()`) only checks the format, not ownership. When accepting relational IDs (foreign keys) from user input, we must query the database to explicitly confirm that the referenced entity exists within the caller's tenant scope.
**Prevention:** Always validate user-provided relational fields (foreign keys, e.g., `parentId` or `categoryId`) by querying the database to ensure the referenced entity belongs to the authenticated tenant (`orgId`) before performing inserts or updates.
