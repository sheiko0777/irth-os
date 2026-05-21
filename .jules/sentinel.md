## 2026-05-21 - [Timing Attacks on HMAC signature verification]
**Vulnerability:** Found insecure string comparison for HMAC signature verification (`!==`) in webhook endpoints (`paymob.ts` and `bosta.ts`). This allows for theoretical timing attacks.
**Learning:** Standard string equality operators fail fast, making them vulnerable to timing attacks when verifying cryptographic signatures.
**Prevention:** Always use constant-time comparison methods like `crypto.timingSafeEqual` for verifying HMAC signatures and secrets. Ensure buffers are of the same length before comparison to avoid runtime exceptions.
