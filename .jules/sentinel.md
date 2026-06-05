## 2024-06-05 - Timing attack in Aramex webhook token validation
**Vulnerability:** Aramex webhook token comparison was using a standard strict equality check (`!==`), which exposed it to timing attacks.
**Learning:** Standard string equality operators leak timing information because they return early on the first non-matching character, allowing an attacker to deduce the token length and content.
**Prevention:** Always use `crypto.timingSafeEqual` after hashing both the expected token and provided header token with a cryptographic hash function (like SHA-256) to ensure constant length and comparison time.
