import { z } from 'zod';

// Lives here, not in @irth/db, on purpose: packages/db depends on zod ^3.22.4
// while apps/admin depends on zod ^4.4.3 — two incompatible major versions.
// A schema object built with db's z crosses the package boundary as a plain
// object to admin's z.object({...}), which rejects it ("expected a Zod
// schema") since v4 doesn't recognize a v3 schema instance's shape. Sharing
// the pure offset/meta math (packages/db/src/pagination.ts) is safe; sharing
// an actual Zod schema fragment across this specific boundary is not.
export function paginationInputSchema(defaultPageSize = 20, maxPageSize?: number) {
  return {
    page: z.number().min(1).default(1),
    pageSize: maxPageSize
      ? z.number().min(1).max(maxPageSize).default(defaultPageSize)
      : z.number().default(defaultPageSize),
  };
}
