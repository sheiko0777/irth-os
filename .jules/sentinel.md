## 2024-06-07 - Webhook Secret Timing Attack
**Vulnerability:** Aramex webhook token comparison using standard string equality operator `!==`.
**Learning:** Standard string comparisons can exit early, allowing attackers to incrementally brute-force tokens or secrets by measuring the time each request takes.
**Prevention:** Always use constant-time comparison methods like `crypto.timingSafeEqual()` for tokens and secrets, and hash strings of variable or differing length to a constant length first.
