export type Role = 'owner' | 'admin' | 'member';

export const PERMISSIONS = {
  products: {
    view: ['owner', 'admin', 'member'] as Role[],
    write: ['owner', 'admin'] as Role[],
    delete: ['owner'] as Role[],
  },
  categories: {
    view: ['owner', 'admin', 'member'] as Role[],
    write: ['owner', 'admin'] as Role[],
    delete: ['owner'] as Role[],
  },
  members: {
    view: ['owner', 'admin'] as Role[],
    invite: ['owner', 'admin'] as Role[],
    changeRole: ['owner'] as Role[],
    // Owner-only, matching changeRole's bar — removing someone permanently is
    // at least as sensitive as changing their role.
    remove: ['owner'] as Role[],
  },
  orders: {
    view: ['owner', 'admin', 'member'] as Role[],
    write: ['owner', 'admin'] as Role[],
    delete: ['owner'] as Role[],
  },
  coupons: {
    view: ['owner', 'admin', 'member'] as Role[],
    write: ['owner', 'admin'] as Role[],
    delete: ['owner'] as Role[],
  },
  campaigns: {
    view: ['owner', 'admin', 'member'] as Role[],
    write: ['owner', 'admin'] as Role[],
    delete: ['owner'] as Role[],
  },
  inventory: {
    view: ['owner', 'admin', 'member'] as Role[],
    write: ['owner', 'admin'] as Role[],
    delete: ['owner'] as Role[],
  },
  returns: {
    view: ['owner', 'admin', 'member'] as Role[],
    write: ['owner', 'admin'] as Role[],
    delete: ['owner'] as Role[],
  },
  purchasing: {
    view: ['owner', 'admin', 'member'] as Role[],
    write: ['owner', 'admin'] as Role[],
    delete: ['owner'] as Role[],
  },
  finance: {
    view: ['owner', 'admin'] as Role[],
    write: ['owner', 'admin'] as Role[],
    delete: ['owner'] as Role[],
  },
  customers: {
    view: ['owner', 'admin', 'member'] as Role[],
    write: ['owner', 'admin'] as Role[],
    delete: ['owner'] as Role[],
  },
  courier: {
    view: ['owner', 'admin', 'member'] as Role[],
    write: ['owner', 'admin'] as Role[],
    delete: ['owner'] as Role[],
  },
} as const;

export type Resource = keyof typeof PERMISSIONS;

// The actions actually declared for a given resource. Exported so every
// consumer — PermissionGate.tsx (client), requirePermission (server, both
// apps/admin and apps/api) — shares ONE definition instead of each
// redefining it. PermissionGate.tsx used to keep its own private copy of
// this exact type after an untyped `action` string silently denied every
// role for `categories` — moving it here means a new caller gets the same
// compile-time guard for free instead of reintroducing the bug's shape.
export type ActionFor<R extends Resource> = keyof (typeof PERMISSIONS)[R];

export function can<R extends Resource>(role: Role, resource: R, action: ActionFor<R>): boolean {
  // Optional-chained on PERMISSIONS[resource] deliberately: the generic
  // signature only guarantees a valid resource/action at compile time. A
  // value computed at runtime (e.g. a dynamic string cast past the type
  // system) can still name a resource PERMISSIONS has no entry for, and
  // indexing straight into `undefined` would throw instead of denying —
  // "fails closed" has to mean returns false, not crashes.
  const allowed = (PERMISSIONS[resource] as Record<string, Role[]> | undefined)?.[action as string];
  return allowed ? allowed.includes(role) : false;
}
