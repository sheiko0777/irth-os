## 2024-05-22 - Prevent IP spoofing via X-Forwarded-For
**Vulnerability:** Rate limiter used X-Forwarded-For as a fallback before CF-Connecting-IP, allowing spoofed IPs if the app bypassed CF.
**Learning:** Always use CF-Connecting-IP first for Cloudflare deployments. When parsing X-Forwarded-For, use a configured `TRUSTED_PROXY_COUNT` to securely identify the true client IP from the right-hand side of the list.
**Prevention:** Always rely on secure, edge-provided headers (like `CF-Connecting-IP`) over easily spoofable headers (`X-Forwarded-For`). Use a trusted proxy strategy.

## 2024-05-22 - Eliminate timingSafeEqual length leaks
**Vulnerability:** Comparing HMAC signatures with `timingSafeEqual` leaked the length of the expected signature by using `sigBuf.length !== expBuf.length`.
**Learning:** `timingSafeEqual` will throw if lengths don't match, and checking length beforehand introduces a timing vulnerability.
**Prevention:** Hash both sides of the comparison (e.g. `createHash('sha256')`) so both buffers are exactly the same length before calling `timingSafeEqual`.

## 2024-05-22 - Avoid error message leakage in API responses
**Vulnerability:** API routes returned raw error messages via `error instanceof Error ? error.message : String(error)`.
**Learning:** Leaking raw errors to clients can expose database internals, stack traces, and sensitive business logic in production.
**Prevention:** Implement a global `handleError` wrapper that logs full errors server-side and returns a generic "internal_server_error" message in production environments.
