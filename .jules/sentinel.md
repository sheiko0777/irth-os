## 2024-06-04 - Timing Attack Vulnerability in Webhook Verification
**Vulnerability:** Comparing webhook tokens or HMAC signatures using standard string equality (`===` or `!==`) exposes the application to timing attacks, allowing an attacker to deduce the correct token/signature character by character.
**Learning:** Found in the Aramex webhook token verification, where the incoming token was compared directly to the environment variable. Built-in JS operators short-circuit, causing execution time to vary depending on how many characters match.
**Prevention:** Always use `crypto.timingSafeEqual()` for comparing security-sensitive strings. Before comparing, ensure both sides are hashed to a constant length (e.g., using `crypto.createHash('sha256')`) to prevent length-based timing leaks.
