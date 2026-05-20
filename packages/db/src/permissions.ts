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
} as const;

export function can(role: Role, resource: keyof typeof PERMISSIONS, action: string): boolean {
  const allowed = (PERMISSIONS[resource] as Record<string, Role[]>)[action];
  return allowed ? allowed.includes(role) : false;
}
