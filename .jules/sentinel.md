## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2026-08-02 - Unhandled Exceptions during Webhook JSON Parsing
**Vulnerability:** Raw webhook payloads parsed with `JSON.parse()` without a `try...catch` block caused unhandled exceptions when encountering malformed or malicious JSON. This resulted in a 500 Internal Server Error, potentially leading to a Denial of Service (DoS) and exposing stack traces/internals.
**Learning:** Relying on the underlying framework to handle malformed body payloads is dangerous when performing manual body reading (e.g., using `c.req.text()`) followed by manual `JSON.parse()`.
**Prevention:** When parsing raw request bodies with `JSON.parse()` in webhook routes, always wrap the parsing logic in a `try...catch` block to handle invalid JSON gracefully and return a 400 Bad Request error.
