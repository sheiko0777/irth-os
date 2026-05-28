## 2025-02-23 - Prevent length-based timing leaks during HMAC verification
**Vulnerability:** Comparing cryptographic signatures using `sigBuf.length !== expBuf.length` before calling `timingSafeEqual`.
**Learning:** Checking lengths prior to `timingSafeEqual` introduces a timing side-channel since the comparison short-circuits. Attackers can iterate through lengths to find the correct length based on response timing.
**Prevention:** Hash both the received signature and the expected signature to a constant length using `crypto.createHash('sha256')` (or similar) before passing them to `timingSafeEqual`.
