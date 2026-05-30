## 2025-05-30 - Prevent Timing Attacks in Token Comparisons
**Vulnerability:** A standard string comparison (`!==`) was used to compare authentication tokens in webhooks (e.g., Aramex webhook).
**Learning:** Using standard comparison operators for secrets exposes the application to side-channel timing attacks, as the time taken to evaluate the comparison varies based on where the mismatch occurs. Even if tokens are the same length, character-by-character timing variation can theoretically allow an attacker to guess the token over many requests.
**Prevention:** Always hash tokens/signatures to a consistent length (e.g., using `crypto.createHash('sha256')`) and then use `crypto.timingSafeEqual` (or `crypto.subtle.verify`) for comparison to guarantee constant-time execution.
