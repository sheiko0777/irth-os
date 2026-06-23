## 2025-02-23 - IDOR in Foreign Keys (Cross-Tenant)
**Vulnerability:** User-provided relational fields (e.g., `parentId` in categories, `categoryId` in products) were not validated against the authenticated tenant (`orgId`) before inserts or updates, allowing users to reference entities belonging to other organizations.
**Learning:** Input schema validation (e.g., Zod's `.uuid()`) only checks the format of the ID but cannot enforce cross-tenant isolation.
**Prevention:** Always query the database to verify that the referenced entity's `orgId` matches the current session's `orgId` before accepting user-provided foreign keys.
