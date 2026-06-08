## 2025-02-14 - Prevent Timing Attacks on Webhook Secret Verification
**Vulnerability:** Comparing webhook API keys or tokens using standard string equality (`!==` or `===`) allows an attacker to deduce the token length and contents character-by-character through timing variations (returning early when characters mismatch).
**Learning:** Node.js V8 optimizations cause string comparisons to terminate early upon the first differing character, creating a measurable timing difference proportional to the number of matching characters.
**Prevention:** Always compare sensitive strings by first hashing them to equal length using a constant-length hashing algorithm like `SHA-256`, and then comparing those hashes using a constant-time comparison function such as `crypto.timingSafeEqual`.
