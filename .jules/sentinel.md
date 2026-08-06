## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2024-08-06 - Unhandled JSON parsing in webhooks
**Vulnerability:** Webhook handlers (`paymob`, `bosta`) parsed raw JSON using `JSON.parse` without a `try...catch` block. Sending invalid JSON to these endpoints caused a 500 Internal Server Error due to unhandled exceptions, leading to information leakage in logs and potential denial-of-service risks.
**Learning:** `JSON.parse()` throws an exception if the string is not valid JSON. Express/Hono default error handlers might catch it, but relying on them can expose internal details or cause the worker/server to crash if uncaught.
**Prevention:** Always wrap `JSON.parse()` in a `try...catch` block and explicitly return a `400 Bad Request` with a secure error message.
