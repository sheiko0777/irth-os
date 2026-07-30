## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2025-02-28 - IDOR Vulnerability via Cross-Tenant Foreign Key Linking
**Vulnerability:** Relational foreign keys (e.g. `parentId` in categories) created by user input were blindly inserted without validating if the referenced entity belonged to the authenticated organization (`orgId`). This permitted IDOR, where users could link objects across different tenants.
**Learning:** Input validation schemas alone (e.g. `z.string().uuid()`) are insufficient for cross-tenant isolation.
**Prevention:** Always validate user-provided relational fields by querying the database to ensure the referenced entity belongs to the authenticated tenant (`orgId`) prior to performing inserts or updates.
