## 2024-06-15 - Timing Attack Vulnerability in Webhook Verification
**Vulnerability:** A length check (`sigBuf.length !== expBuf.length`) was used to short-circuit the comparison of webhook signatures before calling `crypto.timingSafeEqual()`.
**Learning:** Early length checks reintroduce timing attacks, as an attacker can deduce the correct length of the signature based on the response time.
**Prevention:** Always hash both values to a constant length (e.g., using `crypto.createHash('sha256')`) first, and then compare them directly using `timingSafeEqual()` without any preliminary length checks.
