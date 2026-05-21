## 2024-05-21 - [Timing Attack Vulnerability in Webhook Verification]

**Vulnerability:** HMAC signatures for webhooks (Paymob, Bosta) were being compared using standard string equality (`!==`). This allows attackers to potentially guess the signature character by character based on the time it takes the comparison to fail.
**Learning:** Standard string equality comparisons terminate early as soon as a character doesn't match. In security-critical contexts like signature verification, this exposes the system to timing attacks.
**Prevention:** Always use `crypto.timingSafeEqual` when comparing cryptographic signatures, hashes, or tokens to ensure the comparison takes a constant amount of time regardless of whether or where the mismatch occurs. Since `crypto.timingSafeEqual` requires `Buffer`, `Uint8Array`, or `DataView`, strings need to be converted before comparison.
