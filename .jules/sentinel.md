## 2025-02-24 - Timing Attacks on Arbitrary Length Tokens
**Vulnerability:** Comparing an expected token and a provided header token using standard equality operators (e.g. `headerToken !== token`) causes early return if characters don't match, or if lengths don't match. This variable execution time leaks the token length and contents via timing attacks.
**Learning:** Even simple webhook tokens or API keys sent in headers need constant-time string comparison. Node.js `crypto.timingSafeEqual` requires identical buffer lengths to work.
**Prevention:** To safely compare arbitrary length secrets in constant time without leaking length, hash both strings to a constant-length digest (e.g. SHA-256) first, then compare the hashes using `crypto.timingSafeEqual()`.
