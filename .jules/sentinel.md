## 2025-02-28 - Timing Attack Vulnerability in Webhook Verification
**Vulnerability:** Aramex webhook token comparison was using the standard inequality operator `!==`.
**Learning:** Standard operators short-circuit, which allows an attacker to discover the secret webhook token byte-by-byte using a timing attack.
**Prevention:** Always use `node:crypto`'s `timingSafeEqual()` alongside `createHash('sha256')` to hash both sides prior to comparison, guaranteeing constant length and constant time execution.
