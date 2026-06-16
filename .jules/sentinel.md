## 2025-02-28 - Timing Attacks via Length Checks
**Vulnerability:** Early length check (`a.length !== b.length`) before calling `crypto.timingSafeEqual` reintroduces timing attack vulnerability.
**Learning:** Comparing lengths or strings directly before a constant-time comparison leaks information about the length of the expected signature, enabling an attacker to discover the correct length.
**Prevention:** Always hash both the actual and expected signatures to a constant length (e.g., using `crypto.createHash('sha256')`) and then compare the hashed outputs directly. Do not use early return strategies like checking length first.
