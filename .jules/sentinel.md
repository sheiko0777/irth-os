## 2025-02-14 - Fix Timing Attacks in Webhooks
**Vulnerability:** Found length-based and time-based timing vulnerabilities in webhook verification. Webhooks were using early-length checks and simple string comparison (`!==`) for tokens/signatures, allowing timing attacks to guess the valid token.
**Learning:** `timingSafeEqual` throws if the buffer lengths don't match, and checking length beforehand leaks information. Also string comparison operators are vulnerable to time-based guessing.
**Prevention:** When using `crypto.timingSafeEqual`, both sides must first be hashed to a constant length (e.g., using `crypto.createHash('sha256')`) to prevent length-based timing leaks and securely compare values in constant time.
