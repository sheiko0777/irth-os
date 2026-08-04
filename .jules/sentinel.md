## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2024-08-04 - IDOR Vulnerability via Relational Foreign Keys
**Vulnerability:** A standard IDOR and privilege escalation vulnerability was discovered in category creation, where a user could provide a `parentId` belonging to a different tenant/organization. Simple schema validation (e.g., `z.string().uuid()`) was insufficient to verify ownership.
**Learning:** Relational foreign keys representing parent or associated entities are common vectors for IDOR if they are inserted without cross-checking the entity's tenant context (`orgId`). Input validation checks only format, not relationship access.
**Prevention:** Always validate user-provided relational fields (foreign keys, e.g., `parentId`) by explicitly querying the database to ensure the referenced entity belongs to the authenticated tenant (`ctx.orgId`) before performing inserts or updates.
