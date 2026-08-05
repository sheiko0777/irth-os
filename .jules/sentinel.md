## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2026-08-05 - Unhandled Exceptions in Webhook JSON Parsing
**Vulnerability:** External webhook endpoints (e.g., Paymob, Bosta) called `JSON.parse()` directly on raw request bodies without a `try/catch` block. This allows attackers to trigger unhandled exceptions (and potentially 500 server errors or stack trace leaks) by sending malformed JSON payloads.
**Learning:** The application framework (Hono) doesn't automatically catch synchronous exceptions thrown during raw body parsing if they aren't handled explicitly in the route logic.
**Prevention:** When parsing raw request bodies with `JSON.parse()` in webhook routes, always wrap the logic in a `try...catch` block and return a safe `400 Bad Request` generic response on failure.
