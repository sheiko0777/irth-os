## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2024-06-25 - Unhandled Exception in Webhook Payloads
**Vulnerability:** The Paymob webhook manually read `c.req.text()` and passed it into `JSON.parse()` without a `try...catch` block. Malformed JSON payloads would throw an unhandled exception, causing the server to crash or return a generic 500 Internal Server Error.
**Learning:** Raw parsing inside webhook routes inherently runs outside the framework's schema validation middlewares, introducing an unhandled exception risk if standard input assumptions fail.
**Prevention:** When parsing raw request bodies with `JSON.parse()` in webhook routes (e.g., Paymob, Bosta, Aramex), always wrap the parsing logic in a `try...catch` block to handle invalid JSON payloads gracefully and return a 400 Bad Request.
