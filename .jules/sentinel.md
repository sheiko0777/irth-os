## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.
## 2024-07-03 - Unhandled Exceptions in JSON.parse
**Vulnerability:** Raw `JSON.parse` operations in webhook endpoints (`apps/api/src/routes/webhooks/paymob.ts` and `bosta.ts`) lacked try-catch blocks. If a third-party service or attacker sent an invalid JSON payload, it would throw an unhandled exception, potentially crashing the server or exposing internal stack traces via default error handlers.
**Learning:** Defensive programming means never trusting external input to be validly formatted, even from expected webhooks. Uncaught exceptions in Node.js routes can lead to DoS or info disclosure.
**Prevention:** Always wrap `JSON.parse` with `try...catch` when parsing raw request text, and explicitly return a `400 Bad Request` upon failure.
