import { z } from 'zod';
import { PERMISSIONS, type PermissionList, type Resource } from '@irth/db';

/**
 * A {resource: [action]} list from a client — a custom role's permissions or a
 * member's grants/revokes. Limited to what the matrix declares: an unknown
 * pair is rejected, not silently dropped, and the result is canonical.
 */
export const permissionListSchema = z
  .record(z.string().max(40), z.array(z.string().max(40)).max(20))
  .superRefine((list, ctx) => {
    if (Object.keys(list).length > Object.keys(PERMISSIONS).length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'too many resources' });
      return;
    }
    for (const [resource, actions] of Object.entries(list)) {
      const declared = PERMISSIONS[resource as Resource] as Record<string, unknown> | undefined;
      for (const action of actions) {
        if (!declared || !Object.prototype.hasOwnProperty.call(declared, action)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown permission ${resource}.${action}` });
        }
      }
    }
  })
  .transform(canonical);

/** Sorted, de-duplicated, empty resources dropped — so equal lists compare and audit equal. */
function canonical(list: Record<string, string[]>): PermissionList {
  const out: PermissionList = {};
  for (const resource of Object.keys(list).sort()) {
    const actions = [...new Set(list[resource])].sort();
    if (actions.length > 0) out[resource] = actions;
  }
  return out;
}


/** The Postgres error code behind a Drizzle error, if any. */
export function pgCode(err: unknown): string | undefined {
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause;
  const code = cause?.code ?? (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}
