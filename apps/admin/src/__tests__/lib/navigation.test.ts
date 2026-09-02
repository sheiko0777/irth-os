import { describe, expect, it } from 'vitest';
import { buildNavGroups, filterNavGroupsByScreens, type NavGroup } from '@/lib/navigation';

function hrefs(groups: NavGroup[]): string[] {
  return groups.flatMap((group) => group.items.map((item) => item.href));
}

describe('filterNavGroupsByScreens', () => {
  it('keeps every nav item for an unrestricted org', () => {
    const groups = buildNavGroups('ar');

    expect(filterNavGroupsByScreens(groups, {
      unrestricted: true,
      enabledScreens: null,
      disabledScreens: null,
    })).toEqual(groups);
  });

  it('treats the no-feature-row signal as unrestricted, not empty enabled screens', () => {
    const groups = buildNavGroups('ar');
    const noRowSignal = { unrestricted: true, enabledScreens: null, disabledScreens: null } as const;

    expect(hrefs(filterNavGroupsByScreens(groups, noRowSignal))).toEqual(hrefs(groups));
  });

  it('keeps only enabled screens plus always-visible items for a restricted org', () => {
    const filtered = filterNavGroupsByScreens(buildNavGroups('ar'), {
      unrestricted: false,
      enabledScreens: ['orders', 'settings'],
      disabledScreens: [],
    });

    expect(hrefs(filtered)).toEqual([
      '/ar',
      '/ar/orders',
      // No `screen` tag (not yet in platformPlans.ts's ALL_SCREENS) — always
      // visible regardless of enabledScreens, same as home.
      '/ar/intelligence',
      '/ar/settings',
      '/ar/settings/members',
    ]);
  });

  it('lets disabled screens win even when the screen is enabled', () => {
    const filtered = filterNavGroupsByScreens(buildNavGroups('ar'), {
      unrestricted: false,
      enabledScreens: ['orders', 'settings'],
      disabledScreens: ['orders'],
    });

    expect(hrefs(filtered)).toEqual(['/ar', '/ar/intelligence', '/ar/settings', '/ar/settings/members']);
  });

  it('drops groups with no visible items', () => {
    const filtered = filterNavGroupsByScreens(buildNavGroups('ar'), {
      unrestricted: false,
      enabledScreens: ['orders'],
      disabledScreens: [],
    });

    expect(filtered.map((group) => group.label)).toEqual(['عام']);
  });
});
