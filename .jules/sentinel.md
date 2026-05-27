## 2025-05-24 - High: Fix length-based timing leak in Bosta webhook verification
**Vulnerability:** Length-based timing leak and unhandled exception risk in webhook signature verification (`sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)`).
**Learning:** Returning early on a length mismatch creates a side-channel timing attack vector. Additionally, passing mismatched lengths to `timingSafeEqual` directly crashes the Node.js process (unhandled exception).
**Prevention:** Always ensure constant-length comparison by taking a uniform-length hash (e.g., `createHash('sha256')`) of both sides before passing them to `timingSafeEqual`.
