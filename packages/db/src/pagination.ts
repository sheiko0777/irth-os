// The Zod schema fragment for this (page/pageSize input) deliberately does
// NOT live here: packages/db depends on zod ^3.22.4, apps/admin depends on
// zod ^4.4.3, and a schema object built with one crosses to the other's
// z.object({...}) as a plain object it doesn't recognize as a schema. See
// apps/admin/src/server/pagination.ts, which composes that part locally.
// These two are plain functions — no zod involved, safe to share.

export function paginationOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

export function paginationMeta(page: number, pageSize: number, total: number) {
  return { total, page, pageSize };
}
