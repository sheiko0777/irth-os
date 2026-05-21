## 2024-05-21 - Timing Attack Vulnerability in Webhook Signature Verification

**Vulnerability:** Found a timing attack vulnerability in how webhook HMAC signatures were verified for both Bosta and Paymob webhooks. The code used a simple `!==` string comparison (`if (calculatedHmac !== hmacHeader)`) to compare the calculated HMAC against the one provided in the header.
**Learning:** String comparison operators compare strings character by character and return early as soon as a mismatch is found. This early exit leaks the time taken to evaluate the condition, allowing attackers to incrementally guess the valid signature by measuring response times.
**Prevention:** Always use a constant-time comparison function, such as `crypto.timingSafeEqual` in Node.js, to compare sensitive values like HMACs, passwords, and tokens.
