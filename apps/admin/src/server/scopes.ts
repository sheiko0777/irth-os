import { inArray, type AnyColumn, type SQL } from 'drizzle-orm';
import type { Context } from './trpc';

/**
 * The explicit half of data scoping (PR-1e): a WHERE condition limiting a
 * query to the member's brands or suppliers, or undefined when they are not
 * limited. 0076's RLS policies enforce the same inside ctx.withOrg; this is
 * the second layer CLAUDE.md rule 3 asks for, so a query is correct on its
 * own and does not rely on the database catching it.
 */
export function brandScope(ctx: Pick<Context, 'access'>, column: AnyColumn): SQL | undefined {
  const ids = ctx.access.scopes.brand;
  return ids.length > 0 ? inArray(column, [...ids]) : undefined;
}

export function supplierScope(ctx: Pick<Context, 'access'>, column: AnyColumn): SQL | undefined {
  const ids = ctx.access.scopes.supplier;
  return ids.length > 0 ? inArray(column, [...ids]) : undefined;
}
