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

export function can(role: Role, resource: keyof typeof PERMISSIONS, action: string): boolean {
  const allowed = (PERMISSIONS[resource] as Record<string, Role[]>)[action];
  return allowed ? allowed.includes(role) : false;
}
