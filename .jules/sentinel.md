## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2024-06-25 - Missing Role-Based Access Control on Sensitive Endpoints
**Vulnerability:** Several sensitive endpoints, such as updating order statuses, creating shipments, and viewing activity logs, were missing authorization checks (`requireRole` middleware). This allowed users with only a 'member' role to access and manipulate resources that should be restricted to 'owner' or 'admin' roles.
**Learning:** Endpoints that modify the state of critical entities (like order status updates or creating third-party shipments) or access sensitive organization-wide audit trails must have explicit role-based access control.
**Prevention:** Always apply the `requireRole('owner', 'admin')` (or equivalent depending on the required privilege) middleware to routes that handle sensitive operations or data to enforce proper Role-Based Access Control.
