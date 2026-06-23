## 2025-03-09 - IDOR in Relational Fields
**Vulnerability:** IDOR in creating entities with relational fields (e.g. `parentId`, `categoryId`). A user could pass the ID of an entity belonging to another organization.
**Learning:** Input schema validation (e.g. `z.uuid()`) alone is insufficient for multi-tenant isolation.
**Prevention:** Always explicitly query the database to verify the relational field exists AND belongs to the authenticated user's `orgId` before performing inserts/updates.
