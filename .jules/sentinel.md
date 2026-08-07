## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2026-08-07 - Unhandled JSON.parse Exceptions in Webhooks
**Vulnerability:** Several webhook routes (e.g., Paymob, Bosta) parsed incoming request bodies directly with `JSON.parse()` without a `try...catch` block. This allowed an attacker to send invalid JSON payloads, causing an unhandled exception and a 500 Internal Server Error, potentially leading to denial of service or information leakage.
**Learning:** External data should never be trusted. Built-in parsing functions like `JSON.parse()` can throw exceptions when provided with malformed input, crashing the current execution context or returning a 500 error instead of a graceful 400 Bad Request.
**Prevention:** When parsing raw request bodies with `JSON.parse()` in any route, always wrap the parsing logic in a `try...catch` block to handle invalid JSON payloads gracefully and return a 400 Bad Request rather than throwing an unhandled exception.
