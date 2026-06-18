## 2025-02-14 - Fix timing attack vulnerabilities in webhooks
**Vulnerability:** Several webhook handlers were susceptible to timing attacks due to their token and signature comparison implementations. Specifically:
1. `aramex-webhook.ts` used a standard equality operator (`!==`) to compare webhook tokens.
2. `bosta-webhook.ts` used an early length check (`sigBuf.length !== expBuf.length`) before calling `crypto.timingSafeEqual()`, completely short-circuiting the constant-time benefit.

**Learning:** Timing safe comparisons must not only use `crypto.timingSafeEqual()`, but the inputs must be uniform in length. Standard equality and early length checks leak the length of the string, which attackers can exploit.

**Prevention:** To prevent this, always hash both strings (the received one and the expected one) to a constant length first, like SHA-256, and then compare the two hashes directly using `crypto.timingSafeEqual()`. Do not perform early length checks.
