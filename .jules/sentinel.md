## 2024-05-18 - Webhook Timing Attacks
**Vulnerability:** Aramex and Bosta webhooks were vulnerable to timing attacks during signature verification.
**Learning:** Standard string comparisons (`!==`) or early length checks (`a.length !== b.length`) before `timingSafeEqual` leak the secret's length or content, allowing attackers to brute-force the signature.
**Prevention:** Always use `crypto.timingSafeEqual` for comparing secrets, and ensure both inputs are hashed to a constant length (e.g., using SHA-256) *before* comparison to avoid both length-based and content-based timing leaks.
