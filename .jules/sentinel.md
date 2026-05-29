## 2024-05-29 - Token verification timing attacks
**Vulnerability:** Timing attacks on token verification where normal string comparison (`!==`) was used (e.g., `headerToken !== token`), leaking token characters via early exit.
**Learning:** Normal string equality operators compare characters sequentially and exit on the first mismatch, allowing attackers to guess tokens character by character by measuring response times.
**Prevention:** Always use `crypto.timingSafeEqual` to verify tokens or HMAC signatures. To prevent length-based timing leaks, both sides must first be hashed to a constant length (e.g., using `crypto.createHash('sha256')`) before comparison.
