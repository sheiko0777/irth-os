## 2025-02-12 - Prevent Timing Attacks in Webhook Verifications
**Vulnerability:** Length-based timing leaks in `bosta-webhook.ts` and token timing side-channels in `aramex-webhook.ts`.
**Learning:** Comparing security tokens (e.g., Aramex header token) using strict equality (`!==`) or comparing signature lengths directly introduces timing side channels, allowing an attacker to progressively guess valid tokens/signatures by measuring response times.
**Prevention:** Always compare webhook secrets or authentication tokens using `crypto.timingSafeEqual()`. If comparing inputs of potentially variable lengths, first hash both sides (e.g., using `crypto.createHash('sha256')`) to fixed-length strings/buffers before running the constant-time comparison to prevent length-based leaks.
