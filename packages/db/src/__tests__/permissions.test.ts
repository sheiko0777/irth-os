import { describe, expect, it } from 'vitest';
import { can, canAssignRole, PERMISSIONS, type Resource, type Role } from '../permissions';

describe('can', () => {
  it('matches the matrix for every declared resource and action', () => {
    for (const resource of Object.keys(PERMISSIONS) as Resource[]) {
      const actions = PERMISSIONS[resource] as Record<string, readonly string[]>;
      for (const action of Object.keys(actions)) {
        const allowedRoles = actions[action];
        for (const role of ['owner', 'admin', 'member'] as const) {
          expect(can(role, resource, action as never)).toBe(allowedRoles.includes(role));
        }
      }
    }
  });

  it('fails closed on an unknown resource', () => {
    // Cast past the type system deliberately — this covers a resource key
    // that does not exist in PERMISSIONS at all, which the compile-time
    // guard cannot catch for a value computed at runtime (e.g. from a
    // dynamic string).
    expect(can('owner', 'not_a_resource' as unknown as Resource, 'view' as never)).toBe(false);
  });

  it('fails closed on an unknown action for a real resource', () => {
    // Same deliberate cast: a runtime-only typo in the action name must deny
    // every role rather than throw or silently allow.
    expect(can('owner', 'products', 'bogus' as never)).toBe(false);
    expect(can('member', 'members', 'delete' as never)).toBe(false);
  });

  it('rejects a bogus action at compile time', () => {
    // @ts-expect-error 'bogus' is not a key of PERMISSIONS.products — can()'s
    // generic signature must reject it rather than widening to `string`.
    can('owner', 'products', 'bogus');
  });
});

describe('canAssignRole', () => {
  it.each([
    ['owner', 'owner', true],
    ['owner', 'admin', true],
    ['owner', 'member', true],
    ['admin', 'owner', false],
    ['admin', 'admin', true],
    ['admin', 'member', true],
    ['member', 'owner', false],
    ['member', 'admin', false],
    ['member', 'member', false],
  ] as const)('%s assigning %s returns %s', (actorRole, targetRole, allowed) => {
    expect(canAssignRole(actorRole, targetRole)).toBe(allowed);
  });

  it('fails closed on unknown runtime roles', () => {
    for (const role of ['owner', 'admin', 'member'] as const) {
      expect(canAssignRole('unknown' as Role, role)).toBe(false);
      expect(canAssignRole(role, 'unknown' as Role)).toBe(false);
    }
  });
});

import { allPermissionKeys, canAccess, effectiveAccess, permissionsForRole } from '../permissions';

function everyPair(): Array<[Resource, string]> {
  return (Object.keys(PERMISSIONS) as Resource[]).flatMap((resource) =>
    Object.keys(PERMISSIONS[resource]).map((action) => [resource, action] as [Resource, string]));
}

describe('effectiveAccess — system roles are exactly the matrix', () => {
  it.each(['owner', 'admin', 'member'] as const)('%s: canAccess agrees with can() on every declared pair', (role) => {
    const access = effectiveAccess({ systemKey: role });
    for (const [resource, action] of everyPair()) {
      expect(canAccess(access, resource, action as never), `${role} ${resource}.${action}`).toBe(can(role, resource, action as never));
    }
  });

  it('permissionsForRole lists exactly what can() allows', () => {
    for (const role of ['owner', 'admin', 'member'] as const) {
      const list = permissionsForRole(role);
      for (const [resource, action] of everyPair()) {
        expect((list[resource] ?? []).includes(action)).toBe(can(role, resource, action as never));
      }
    }
  });

  it('the owner holds every declared pair and nothing undeclared', () => {
    const owner = effectiveAccess({ systemKey: 'owner' });
    expect(owner.perms.size).toBe(allPermissionKeys().length);
    expect(canAccess(owner, 'products', 'bogus' as never)).toBe(false);
  });
});

describe('effectiveAccess — custom roles and per-person overrides', () => {
  const warehouseKeeper = { inventory: ['view', 'write'], products: ['view'] };

  it('a custom role grants exactly its list', () => {
    const access = effectiveAccess({ systemKey: null, rolePermissions: warehouseKeeper });
    expect(canAccess(access, 'inventory', 'write')).toBe(true);
    expect(canAccess(access, 'products', 'view')).toBe(true);
    expect(canAccess(access, 'products', 'write')).toBe(false);
    expect(canAccess(access, 'finance', 'view')).toBe(false);
  });

  it('grant adds and revoke removes, revoke winning over both', () => {
    const access = effectiveAccess({
      systemKey: null,
      rolePermissions: warehouseKeeper,
      overrides: { grant: { orders: ['view'], finance: ['view'] }, revoke: { inventory: ['write'], finance: ['view'] } },
    });
    expect(canAccess(access, 'orders', 'view')).toBe(true);
    expect(canAccess(access, 'inventory', 'write')).toBe(false);
    expect(canAccess(access, 'finance', 'view')).toBe(false);
  });

  it('overrides apply on top of a system role too', () => {
    const member = effectiveAccess({ systemKey: 'member', overrides: { revoke: { customers: ['view'] }, grant: { orders: ['write'] } } });
    expect(canAccess(member, 'customers', 'view')).toBe(false);
    expect(canAccess(member, 'orders', 'write')).toBe(true);
  });

  it('the owner cannot be restricted by overrides', () => {
    const owner = effectiveAccess({ systemKey: 'owner', overrides: { revoke: { members: ['remove'] } } });
    expect(canAccess(owner, 'members', 'remove')).toBe(true);
  });

  it('a suspended member can do nothing, owner or not', () => {
    for (const systemKey of ['owner', 'admin', null] as const) {
      const access = effectiveAccess({ systemKey, rolePermissions: warehouseKeeper, status: 'suspended' });
      expect(access.suspended).toBe(true);
      expect(access.isOwner).toBe(false);
      for (const [resource, action] of everyPair()) expect(canAccess(access, resource, action as never)).toBe(false);
    }
  });

  it('stored pairs the matrix does not declare grant nothing', () => {
    const access = effectiveAccess({
      systemKey: null,
      rolePermissions: { not_a_resource: ['view'], products: ['bogus', 'view'], orders: 'view' as unknown as string[] },
    });
    expect([...access.perms]).toEqual(['products.view']);
  });
});
