## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2024-06-21 - Denial of Service in Webhooks via unhandled JSON.parse
**Vulnerability:** Unhandled JSON.parse() in webhook endpoints (Paymob, Bosta) leading to unhandled exception crashes and potential Denial of Service.
**Learning:** Raw request body strings were parsed with JSON.parse without try...catch. When given invalid JSON payloads by attackers or malformed webhooks, the node process might throw an unhandled exception or return an internal 500 server error, creating a DoS vector.
**Prevention:** Always wrap JSON.parse in a try...catch block when parsing raw user/webhook input, and return a 400 Bad Request securely on failure.
