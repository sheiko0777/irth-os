## 2025-01-20 - Webhook signature length timing attack
**Vulnerability:** Early return on signature length check before constant-time comparison in webhook signature verification.
**Learning:** Checking `a.length !== b.length` before `timingSafeEqual(a, b)` re-introduces timing attacks because an attacker can figure out the valid length of a signature by looking at the response time.
**Prevention:** Always hash the expected and received signatures to a constant length (like sha256) and pass those hashes directly into `timingSafeEqual`, without performing any length checks.
