## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2026-08-10 - Unhandled Exceptions in Webhook JSON Parsing
**Vulnerability:** In multiple webhook endpoints (e.g., `paymob.ts`, `bosta.ts`), raw request bodies were parsed using `JSON.parse()` without a `try...catch` block. This allowed attackers to send invalid JSON payloads, causing unhandled exceptions and resulting in 500 Internal Server Errors, which is a Denial of Service (DoS) risk.
**Learning:** Webhook endpoints receiving payloads from external sources must always treat the input as untrusted. Failing to catch parsing errors leaks internal failure states or disrupts the service unnecessarily.
**Prevention:** When parsing raw request bodies with `JSON.parse()` in webhook routes, always wrap the parsing logic in a `try...catch` block to handle invalid JSON payloads gracefully and return a 400 Bad Request.
