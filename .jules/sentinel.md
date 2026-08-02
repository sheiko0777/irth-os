## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2024-08-02 - Unhandled Promise Rejection via Malformed JSON Payload in Webhooks
**Vulnerability:** Webhook endpoints in `apps/api/src/routes/webhooks/paymob.ts` and `apps/api/src/routes/webhooks/bosta.ts` were calling `JSON.parse(bodyRaw)` directly without a `try-catch` block.
**Learning:** If an attacker or a faulty third-party webhook sends malformed, non-JSON data, `JSON.parse()` throws a synchronous exception which could lead to an unhandled exception causing server crashes (DoS) or 500 Internal Server Errors leaking stack traces.
**Prevention:** Always wrap raw body parsing with `JSON.parse()` in a `try...catch` block, particularly in webhook routes, to handle invalid JSON payloads gracefully and return a sanitized 400 Bad Request error.
