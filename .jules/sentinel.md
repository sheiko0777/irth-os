
## 2024-06-04 - Insecure Token Comparison
**Vulnerability:** Comparing webhook signatures or tokens using standard equality operators (`!==`) or exposing length information by checking buffer length prior to using `timingSafeEqual`.
**Learning:** This exposes the system to timing attacks, allowing an attacker to deduce the token or signature one byte/character at a time based on response times. Furthermore, checking lengths before a constant time comparison leaks information about the expected length.
**Prevention:** Always hash the expected and received tokens to a constant length (e.g., using `crypto.createHash('sha256')`) and compare the resulting hashes using `crypto.timingSafeEqual()`.
