## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2024-06-30 - Unhandled Exceptions on Invalid Webhook Payloads
**Vulnerability:** Calling `JSON.parse(bodyRaw)` on raw request bodies in webhooks (`paymob.ts`, `bosta.ts`) without a `try...catch` block could cause the server to crash or return a 500 Internal Server Error when receiving invalid JSON. Since this happens before HMAC validation or processing, unauthenticated attackers could spam malformed requests and exhaust resources or pollute logs.
**Learning:** Raw payload parsing must be done defensively. An exception thrown in a route handler before normal validation will bubble up, and depending on the framework configuration, could lead to denial of service or poor error reporting.
**Prevention:** Always wrap `JSON.parse()` on user-supplied input in a `try...catch` block and return a structured 400 Bad Request error if parsing fails, rather than throwing an unhandled exception.
