## 2025-02-23 - Prevent Webhook Timing Attacks
**Vulnerability:** Observable Timing Discrepancy (CWE-208) in Aramex webhook authentication due to standard string equality (`!==`) comparison of secrets.
**Learning:** Standard string equality operators leak timing information because they exit early on the first mismatched character. An attacker can exploit this to deduce the secret one character at a time.
**Prevention:** Never use standard equality operators to compare webhook tokens, API keys, or other secrets. Always hash both values to a constant length (e.g., SHA-256) and use `crypto.timingSafeEqual()` for comparison. Ensure both strings are hashed to prevent length-based timing leaks.
