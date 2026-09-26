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
    // PR-1d: create an account directly (username + temporary password) and
    // reset a member's password — the same bar as inviting someone. What role
    // the new account may get is further limited by canDelegate below.
    create: ['owner', 'admin'] as Role[],
    resetPassword: ['owner', 'admin'] as Role[],
    // Suspend or reactivate a member — owner-only, like remove.
    suspend: ['owner'] as Role[],
    changeRole: ['owner'] as Role[],
    // Owner-only, matching changeRole's bar — removing someone permanently is
    // at least as sensitive as changing their role.
    remove: ['owner'] as Role[],
  },
  orders: {
    view: ['owner', 'admin', 'member'] as Role[],
    write: ['owner', 'admin'] as Role[],
    delete: ['owner'] as Role[],
    export: ['owner', 'admin', 'member'] as Role[],
    // PR-2a: assign orders to a delivery rep.
    assign: ['owner', 'admin'] as Role[],
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
    export: ['owner', 'admin', 'member'] as Role[],
    // Record a stocktake scan — every role could before PR-1b.
    count: ['owner', 'admin', 'member'] as Role[],
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
    export: ['owner', 'admin', 'member'] as Role[],
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
    // Retry a failed outbox event, and read/replay the dead-letter queue.
    recover: ['owner', 'admin'] as Role[],
  },

  // PR-1b: every procedure now names a resource.action. The entries below
  // cover the routers that used to gate on a role tier (protectedProcedure =
  // every role, adminProcedure = owner+admin, ownerProcedure = owner), and each
  // role list reproduces that tier exactly — permissionParity.test.ts holds the
  // before/after proof. `export` and `count` likewise match what every role
  // could already do; a custom role or a per-person revoke can now take them away.
  dashboard: {
    view: ['owner', 'admin', 'member'] as Role[],
  },
  analytics: {
    view: ['owner', 'admin', 'member'] as Role[],
  },
  audit: {
    view: ['owner', 'admin'] as Role[],
  },
  eta: {
    view: ['owner', 'admin', 'member'] as Role[],
    submit: ['owner', 'admin'] as Role[],
  },
  giftCards: {
    view: ['owner', 'admin', 'member'] as Role[],
    write: ['owner', 'admin'] as Role[],
    delete: ['owner'] as Role[],
  },
  pricelists: {
    view: ['owner', 'admin', 'member'] as Role[],
    write: ['owner', 'admin'] as Role[],
    delete: ['owner'] as Role[],
  },
  settings: {
    view: ['owner', 'admin', 'member'] as Role[],
    write: ['owner', 'admin'] as Role[],
  },
  shipping: {
    view: ['owner', 'admin', 'member'] as Role[],
    write: ['owner', 'admin'] as Role[],
    delete: ['owner'] as Role[],
  },
  // PR-1c: the roles screen. `manage` (create, edit, copy, delete a custom
  // role) is owner-only by default: whoever holds it can write any permission
  // into a role, their own included, so it is as strong as ownership. The
  // owner can still grant it to someone deliberately.
  roles: {
    view: ['owner', 'admin'] as Role[],
    manage: ['owner'] as Role[],
  },
  // PR-1e: fields, not screens. Without the permission the server removes
  // the fields from every response (see redaction in apps/admin's trpc.ts),
  // it never refuses the request. Owner decision: cost and supplier prices
  // are hidden from موظف by default; customer contact stays visible to all.
  sensitive: {
    cost: ['owner', 'admin'] as Role[],
    supplierPrice: ['owner', 'admin'] as Role[],
    customerContact: ['owner', 'admin', 'member'] as Role[],
  },
  // PR-2a: a delivery rep's own work — the orders assigned to them. Every
  // procedure behind these also filters to the caller's member id, so holding
  // them never shows anyone else's deliveries. No system role but the owner
  // has them: a rep gets them from a custom role of kind delivery_rep.
  deliveries: {
    view: ['owner'] as Role[],
    update: ['owner'] as Role[],
    collect: ['owner'] as Role[],
  },
  // PR-2a: rep cash custody. `handover` is the rep's own end-of-day handover;
  // `confirm` is the cashier counting it; `writeOff` books a shortage as a
  // loss and stays owner-only by default.
  repCash: {
    view: ['owner', 'admin'] as Role[],
    handover: ['owner'] as Role[],
    confirm: ['owner', 'admin'] as Role[],
    writeOff: ['owner'] as Role[],
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
// This is what authorizes every request (PR-1b): createContext and the API's
// authContext resolve it once per request, and requirePermission checks
// canAccess(). can(role, …) remains for callers that only hold a role.
// accessControl.test.ts proves the two agree for every system role.
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
  /**
   * An account created with a temporary password (PR-1d) holds no permission
   * until its owner sets their own password — only the self-service
   * procedures work, which is how they change it.
   */
  readonly mustChangePassword: boolean;
  /** "resource.action" keys. Empty for a suspended member. */
  readonly perms: ReadonlySet<string>;
  /**
   * Data scopes (PR-1e): the brands and suppliers this member is limited to.
   * An empty list means unrestricted for that kind. Enforced twice — by RLS
   * through withOrgContext's settings, and by an explicit WHERE in the code.
   */
  readonly scopes: MemberScopes;
  /**
   * org_members.id (PR-2a). Null for a synthetic access (tests, system work).
   * With principalKind it tells 0077's policies whose orders a delivery rep
   * may see.
   */
  readonly memberId: string | null;
}

/** What withOrgContext needs from an access to narrow a transaction to it. */
export function transactionSettings(access: EffectiveAccess) {
  return {
    brand: access.scopes.brand,
    supplier: access.scopes.supplier,
    memberId: access.memberId,
    principalKind: access.principalKind,
  };
}

export interface MemberScopes {
  readonly brand: readonly string[];
  readonly supplier: readonly string[];
}

export const NO_SCOPES: MemberScopes = { brand: [], supplier: [] };

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
  mustChangePassword?: boolean;
  scopes?: MemberScopes;
  memberId?: string | null;
}): EffectiveAccess {
  const principalKind = input.principalKind ?? 'staff';
  const suspended = input.status === 'suspended';
  const mustChangePassword = input.mustChangePassword === true;
  // The owner is never scoped: they see the whole org.
  const scopes = input.systemKey === 'owner' ? NO_SCOPES : input.scopes ?? NO_SCOPES;
  const isOwner = input.systemKey === 'owner' && !suspended;
  const memberId = input.memberId ?? null;

  if (suspended) return { isOwner: false, principalKind, suspended, mustChangePassword, scopes, memberId, perms: new Set() };
  if (isOwner) return { isOwner, principalKind, suspended, mustChangePassword, scopes, memberId, perms: new Set(allPermissionKeys()) };

  const base = input.systemKey ? permissionsForRole(input.systemKey) : input.rolePermissions;
  const perms = new Set(knownPairs(base));
  for (const k of knownPairs(input.overrides?.grant)) perms.add(k);
  for (const k of knownPairs(input.overrides?.revoke)) perms.delete(k);
  return { isOwner, principalKind, suspended, mustChangePassword, scopes, memberId, perms };
}

export function canAccess<R extends Resource>(access: EffectiveAccess, resource: R, action: ActionFor<R>): boolean {
  // The owner's set already holds every declared pair, so membership alone
  // decides — and an undeclared action fails closed for everyone, owner
  // included, exactly as can() does.
  if (access.suspended || access.mustChangePassword) return false;
  return access.perms.has(key(resource, String(action)));
}

/** The "resource.action" keys a stored list names, keeping only declared pairs. */
export function permissionKeys(list: PermissionListInput | undefined): string[] {
  return knownPairs(list);
}

// ---------------------------------------------------------------------------
// Delegation (PR-1d): nobody hands out authority they do not hold.
//
// Generalises canAssignRole from three fixed roles to any role or override:
// an actor may give someone a permission set only if it is a subset of their
// own. The owner role itself is the owner's alone to give. And an actor may
// only change a member whose current authority they already cover — an admin
// cannot edit the owner, or someone granted more than the admin has.
// ---------------------------------------------------------------------------

/** May `actor` give someone exactly these permissions (a role's list, or grants)? */
export function canDelegate(actor: EffectiveAccess, perms: Iterable<string>, opts: { ownerRole?: boolean } = {}): boolean {
  if (actor.suspended || actor.mustChangePassword) return false;
  if (actor.isOwner) return true;
  if (opts.ownerRole) return false;
  for (const p of perms) if (!actor.perms.has(p)) return false;
  return true;
}

/** May `actor` manage `target` at all — change their role, overrides or status? */
export function covers(actor: EffectiveAccess, target: EffectiveAccess): boolean {
  if (actor.suspended || actor.mustChangePassword) return false;
  if (actor.isOwner) return true;
  if (target.isOwner) return false;
  return canDelegate(actor, target.perms) && withinScopes(actor.scopes, target.scopes);
}

/**
 * Is `inner` no wider than `outer`? For each kind: an unrestricted outer
 * allows anything; a restricted outer allows only a non-empty subset (an
 * empty inner would mean "unrestricted", which is wider).
 */
export function withinScopes(outer: MemberScopes, inner: MemberScopes): boolean {
  for (const kind of ['brand', 'supplier'] as const) {
    if (outer[kind].length === 0) continue;
    if (inner[kind].length === 0) return false;
    if (!inner[kind].every((id) => outer[kind].includes(id))) return false;
  }
  return true;
}
