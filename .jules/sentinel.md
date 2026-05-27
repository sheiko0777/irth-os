
## 2025-02-28 - Timing Safe String Comparison
**Vulnerability:** Aramex webhook endpoint was vulnerable to timing attacks due to the use of standard string comparison (`!==`) when verifying authentication tokens (`X-Aramex-Token`).
**Learning:** Node's `crypto.timingSafeEqual` cannot be used directly with variables of differing lengths, which would expose the original string comparison. Standard comparison is vulnerable to timing attacks. Both sides must be hashed to a constant length before comparing.
**Prevention:** Always first hash sensitive comparison strings to a constant length (e.g. using `crypto.createHash('sha256')`) and then use `crypto.timingSafeEqual()` rather than standard operators.
