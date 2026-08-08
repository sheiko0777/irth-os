## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.
## 2024-06-25 - Unhandled JSON.parse in Webhooks
**Vulnerability:** The webhook endpoints for Paymob and Bosta parsed incoming request bodies using `JSON.parse()` without a `try...catch` block.
**Learning:** Sending malformed JSON to these endpoints would result in an unhandled exception, causing a 500 Internal Server Error, polluting logs, and potentially causing denial of service or application instability.
**Prevention:** Always wrap `JSON.parse()` calls on raw request payloads in a `try...catch` block to handle invalid JSON gracefully and return a 400 Bad Request.
