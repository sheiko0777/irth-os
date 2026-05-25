## 2024-05-25 - Timing Attack Vulnerability in Webhook Verification
**Vulnerability:** Length-based timing leak in webhook signature verification.
**Learning:** Comparing buffers directly with `timingSafeEqual` or using early length checks before comparing buffers allows an attacker to deduce the length of the expected signature or token via timing side-channels.
**Prevention:** Always hash both inputs (e.g., using `createHash('sha256')`) to a constant length before comparing them with `timingSafeEqual`.
