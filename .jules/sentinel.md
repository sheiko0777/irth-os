## 2025-02-14 - Timing Attack via Standard String Comparison
**Vulnerability:** The `aramex-webhook.ts` file used the standard strict inequality operator (`!==`) to compare the incoming webhook token against the expected secret token.
**Learning:** Standard string equality checks characters sequentially, returning early upon the first mismatch. This creates a timing difference that an attacker can measure to guess the secret character by character.
**Prevention:** Always use constant-time comparison methods for secrets, signatures, and tokens. Hash both the expected and provided values to a constant length (e.g., using `crypto.createHash('sha256')`) and compare them using `crypto.timingSafeEqual()`.
