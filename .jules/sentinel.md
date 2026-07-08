## 2024-06-21 - Privilege Escalation in Organization Invites
**Vulnerability:** The invite endpoint `apps/api/src/routes/orgs.ts` allowed the `role` field to be any arbitrary string due to insufficient schema validation (`z.string()`), and did not prevent `admin` users from inviting new users with the `owner` role.
**Learning:** `requireRole('owner', 'admin')` allows admins into the endpoint, but does not implicitly restrict them from acting on equal or higher privilege tiers. Zod schemas must explicitly restrict enum-like string inputs (e.g. `z.enum(['owner', 'admin', 'member'])`).
**Prevention:** Always use `z.enum` for role-based string fields. For endpoints shared by multiple roles, explicitly check the caller's role against the target role being modified or created to enforce a proper role hierarchy.

## 2024-06-25 - Unhandled Exception in JSON Parsing
**Vulnerability:** Webhook endpoints (e.g., Paymob, Bosta) parsed raw request bodies using `JSON.parse()` without a `try...catch` block. Malformed JSON payloads could cause unhandled exceptions leading to `500 Internal Server Error` and potential Denial of Service (DoS) if heavily spammed.
**Learning:** External webhook providers do not guarantee well-formed JSON or the application might receive malicious probes. Always assume the worst for external inputs.
**Prevention:** Wrap all `JSON.parse()` calls handling raw incoming HTTP payloads in a `try...catch` block. Catch parsing errors gracefully and return a `400 Bad Request` to avoid uncaught application-level exceptions.
