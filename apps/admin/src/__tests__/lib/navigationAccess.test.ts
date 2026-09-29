/** PR-1e: every screen names the permission it needs, and the nav follows it. */
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@irth/db/src/permissions';
import { buildNavGroups, filterNavGroups, screenRequirement } from '@/lib/navigation';

describe('screen requirements', () => {
  it('maps a screen to its permission, deepest match first', () => {
    expect(screenRequirement('ar', '/ar')).toBe('dashboard.view');
    expect(screenRequirement('ar', '/ar/orders/123')).toBe('orders.view');
    expect(screenRequirement('ar', '/ar/settings/members')).toBe('members.view');
    expect(screenRequirement('ar', '/ar/settings/roles')).toBe('roles.view');
    expect(screenRequirement('ar', '/ar/settings')).toBe('settings.view');
    expect(screenRequirement('ar', '/ar/customer-segments')).toBe('customers.view');
    expect(screenRequirement('ar', '/ar/notifications')).toBeUndefined();
  });

  it('every nav entry that needs a permission names one the matrix declares', () => {
    const declared = new Set(Object.entries(PERMISSIONS).flatMap(([r, a]) => Object.keys(a).map((x) => `${r}.${x}`)));
    const items = buildNavGroups('ar').flatMap((g) => g.items);
    const unknown = items.filter((i) => i.requires && !declared.has(i.requires)).map((i) => i.href);
    expect(unknown).toEqual([]);
    // Everything except the self-service entries is gated.
    const ungated = items.filter((i) => !i.requires).map((i) => i.href).sort();
    expect(ungated).toEqual(['/ar/intelligence', '/ar/notifications']);
  });

  it('filters entries and drops empty groups', () => {
    const only = filterNavGroups(buildNavGroups('ar'), (p) => p === 'inventory.view');
    expect(only.flatMap((g) => g.items.map((i) => i.href))).toEqual([
      '/ar/notifications', '/ar/intelligence', '/ar/inventory', '/ar/stocktaking',
    ]);
  });
});
