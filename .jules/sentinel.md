## 2024-05-24 - Timing Attacks in Webhook Token Verification
**Vulnerability:** Webhook tokens were being compared using standard equality operators (`===` or `!==`).
**Learning:** Standard string comparison operators fail fast upon finding the first non-matching character, which exposes the comparison to timing attacks where an attacker can guess the token character by character based on response times.
**Prevention:** Always hash both values to a constant length (e.g., using SHA-256) and compare them using `crypto.timingSafeEqual()` from `node:crypto` or `crypto.subtle.verify()`.
