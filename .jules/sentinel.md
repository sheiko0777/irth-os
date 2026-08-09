## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2024-08-09 - Unhandled JSON Parsing in Webhooks
**Vulnerability:** External webhook endpoints (`apps/api/src/routes/webhooks/paymob.ts`, `apps/api/src/routes/webhooks/bosta.ts`) parsed raw body strings using `JSON.parse()` without a `try...catch` block.
**Learning:** Sending malformed JSON to these endpoints would cause an unhandled exception, potentially crashing the server or resulting in generic 500 Internal Server Errors, opening up minor Denial of Service (DoS) vectors.
**Prevention:** Always wrap `JSON.parse()` calls on externally provided data in a `try...catch` block and return a safe HTTP 400 Bad Request error if parsing fails, preventing internal exceptions from bubbling up.
