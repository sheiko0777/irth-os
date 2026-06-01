## 2024-10-24 - Webhook Timing Attack Vulnerabilities
**Vulnerability:** Length-based timing attacks and standard string comparisons (`!==`) used in webhook endpoints (`bosta-webhook.ts`, `aramex-webhook.ts`).
**Learning:** `crypto.timingSafeEqual` throws an exception and leaks information if buffers are differing lengths, negating the timing safety. Standard equality comparisons leak byte-by-byte timing info.
**Prevention:** Always ensure both values being passed to `timingSafeEqual` are hashed to a constant length first (e.g., using `createHash('sha256')`).
