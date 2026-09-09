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
