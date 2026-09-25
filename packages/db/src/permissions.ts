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
  // External connections (Shopify today). `view` covers status/location
  // listing — read-only, no reason to keep from a member. `connect` gates
  // starting/redoing the OAuth flow itself and `manage` gates changing an
  // already-connected shop's config (e.g. inventory location) — split from
  // `connect` since re-pointing an active integration's settings is a step
  // riskier than the initial connect a trusted admin would normally do.
  integrations: {
    view: ['owner', 'admin', 'member'] as Role[],
    connect: ['owner', 'admin'] as Role[],
    manage: ['owner'] as Role[],
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

// Deny unknown runtime roles as well as actors without assignment permission.
export function canAssignRole(actorRole: Role, targetRole: Role): boolean {
  if (targetRole === 'owner') return actorRole === 'owner';
  if (targetRole === 'admin' || targetRole === 'member') {
    return actorRole === 'owner' || actorRole === 'admin';
  }
  return false;
}

// ---------------------------------------------------------------------------
// Effective access (0074, owner decision A5)
//
// A member's authority = their role's permission list, plus any per-person
// grants, minus any per-person revokes. System roles (owner/admin/member) have
// no stored list — theirs is exactly the matrix above, derived here — so moving
// the checks onto roles changes nothing for anyone on a system role.
//
// NOT YET USED FOR AUTHORIZATION: requirePermission still calls can(role, …).
// The next step switches it to canAccess(); the integration test
// accessControl.test.ts proves the two agree for every system role today.
//
// Kept import-free for the same reason as the rest of this file: the admin's
// browser bundle deep-imports it.
// ---------------------------------------------------------------------------

export type PrincipalKindName = 'staff' | 'delivery_rep' | 'sales_rep' | 'supplier';

/** {resource: [action, ...]} as stored on a custom role or in overrides. */
export type PermissionListInput = Readonly<Record<string, readonly string[]>>;

export interface EffectiveAccess {
  /** The owner holds every permission and cannot be restricted by overrides. */
  readonly isOwner: boolean;
  readonly principalKind: PrincipalKindName;
  readonly suspended: boolean;
  /** "resource.action" keys. Empty for a suspended member. */
  readonly perms: ReadonlySet<string>;
}

const key = (resource: string, action: string) => `${resource}.${action}`;

/** Only pairs the matrix declares survive: a stored typo or a removed action grants nothing. */
function knownPairs(list: PermissionListInput | undefined): string[] {
  if (!list) return [];
  const out: string[] = [];
  for (const [resource, actions] of Object.entries(list)) {
    const declared = PERMISSIONS[resource as Resource] as Record<string, readonly Role[]> | undefined;
    if (!declared || !Array.isArray(actions)) continue;
    for (const action of actions) {
      if (typeof action === 'string' && Object.prototype.hasOwnProperty.call(declared, action)) {
        out.push(key(resource, action));
      }
    }
  }
  return out;
}

/** Every declared resource.action — what the owner holds. */
export function allPermissionKeys(): string[] {
  return Object.entries(PERMISSIONS).flatMap(([resource, actions]) =>
    Object.keys(actions).map((action) => key(resource, action)));
}

/** A system role's permissions, as a list, derived from the matrix above. */
export function permissionsForRole(role: Role): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(PERMISSIONS)) {
    const granted = Object.entries(actions as Record<string, readonly Role[]>)
      .filter(([, roles]) => roles.includes(role))
      .map(([action]) => action);
    if (granted.length > 0) out[resource] = granted;
  }
  return out;
}

export function effectiveAccess(input: {
  systemKey: Role | null;
  rolePermissions?: PermissionListInput;
  overrides?: { grant?: PermissionListInput; revoke?: PermissionListInput };
  principalKind?: PrincipalKindName;
  status?: 'active' | 'suspended';
}): EffectiveAccess {
  const principalKind = input.principalKind ?? 'staff';
  const suspended = input.status === 'suspended';
  const isOwner = input.systemKey === 'owner' && !suspended;

  if (suspended) return { isOwner: false, principalKind, suspended, perms: new Set() };
  if (isOwner) return { isOwner, principalKind, suspended, perms: new Set(allPermissionKeys()) };

  const base = input.systemKey ? permissionsForRole(input.systemKey) : input.rolePermissions;
  const perms = new Set(knownPairs(base));
  for (const k of knownPairs(input.overrides?.grant)) perms.add(k);
  for (const k of knownPairs(input.overrides?.revoke)) perms.delete(k);
  return { isOwner, principalKind, suspended, perms };
}

export function canAccess<R extends Resource>(access: EffectiveAccess, resource: R, action: ActionFor<R>): boolean {
  // The owner's set already holds every declared pair, so membership alone
  // decides — and an undeclared action fails closed for everyone, owner
  // included, exactly as can() does.
  if (access.suspended) return false;
  return access.perms.has(key(resource, String(action)));
}
