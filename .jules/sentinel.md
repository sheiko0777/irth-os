## 2024-05-24 - Webhook Secret and Token Timing Attacks
**Vulnerability:** Comparing webhook HMAC signatures or authorization tokens using standard equality operators (`!==`) or `timingSafeEqual` preceded by a length check.
**Learning:** Checking string lengths before a constant-time comparison or using `!==` exposes the application to timing attacks, allowing attackers to incrementally guess valid tokens or signatures by measuring response times.
**Prevention:** Never use standard equality operators for cryptographic comparisons. Always hash both values to a constant length first (e.g., using `crypto.createHash('sha256')`), then compare them directly using `crypto.timingSafeEqual()`. Do not short-circuit the comparison with early length checks.
