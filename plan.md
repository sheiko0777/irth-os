1. **Remove Promise.all wrapping tx.select() calls in `apps/admin/src/server/routers/accounts.ts`**
   - The memory ".jules/bolt.md" warns: "Never use `Promise.all` with `tx.select()` or mutations inside a transaction. Keep queries sequential, or pull independent reads outside the transaction if they don't need its consistency guarantee."
   - In `apps/admin/src/server/routers/accounts.ts` at line 219, there's `const [brandRows, supplierRows, pricelistRows] = await ctx.withOrg((tx) => Promise.all([...tx.select()...]))`.
   - Also around line 252 inside `setScopes` mutation, there's `const [foundBrands, foundSuppliers, foundPricelists] = await Promise.all([...tx.select()...])`.
   - I will change these to be sequential `await`s.
2. **Remove Promise.all wrapping tx.select() calls in `apps/admin/src/server/routers/inventory.ts`**
   - In `apps/admin/src/server/routers/inventory.ts` at line 36, there's `const [items, tally] = await ctx.withOrg((tx) => Promise.all([...tx.select()...]))`.
   - I will change this to sequential `await`s.
