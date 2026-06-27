## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2024-06-27 - Authorization Bypass on Sensitive API Routes
**Vulnerability:** Found sensitive API routes (e.g., `ordersRoute.patch('/:id/status')` and `shippingRoute.post('/create')`) that modified critical data or triggered physical actions without checking if the user had sufficient privileges (e.g., admin or owner role).
**Learning:** Relying only on `orgId` verification and authentication ensures tenancy isolation, but fails to prevent low-privileged users (like normal members or customers) from accessing administrative endpoints.
**Prevention:** To restrict access to sensitive API endpoints (e.g., status updates or privilege modifications) in Hono routes, apply the `requireRole` middleware (e.g., `requireRole('owner', 'admin')`) imported from `../middlewares/requireRole` to implement proper Role-Based Access Control.
