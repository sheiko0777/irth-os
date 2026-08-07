## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2024-08-07 - Unhandled Exceptions on Invalid Webhook JSON Payloads
**Vulnerability:** The Paymob and Bosta webhook endpoints used `JSON.parse(c.req.text())` or similar without a `try...catch` block.
**Learning:** If an external service or an attacker sends a malformed JSON body to these webhooks, `JSON.parse` will throw an unhandled exception. This can result in a 500 Internal Server Error and potentially leak internal stack traces to the caller, while also causing noise in monitoring systems or degrading API stability.
**Prevention:** Always wrap `JSON.parse` in a `try...catch` block when handling unvalidated payloads from the network, and return a 400 Bad Request error cleanly upon failure.
