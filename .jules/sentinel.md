## 2024-05-29 - Fixed Timing Attack Vulnerability in Webhooks

**Vulnerability:** Found timing attack vulnerabilities during webhook payload verification in `apps/api/src/routes/webhooks/aramex-webhook.ts` and `apps/api/src/routes/webhooks/bosta-webhook.ts`. The implementation incorrectly relied on standard short-circuit string/buffer comparison operators or leaked the required length during length checks.
**Learning:** Comparing sensitive secrets like webhook signatures using simple equality (e.g., `!==`) stops after finding the first unmatched character. Similarly, comparing lengths explicitly (`sigBuf.length !== expBuf.length`) makes it possible to guess the required payload length or causes an error when sizes mismatched.
**Prevention:** Always compare secure hashes and tokens by hashing them first to a guaranteed constant size (e.g., using `crypto.createHash('sha256')`) and then comparing them side-by-side using `crypto.timingSafeEqual`.
