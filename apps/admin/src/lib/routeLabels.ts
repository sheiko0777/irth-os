import { buildNavGroups } from './navigation';

/**
 * Legacy overrides to preserve exact string matches for routes where
 * the hand-maintained map historically drifted from navigation.ts.
 */
const LEGACY_OVERRIDES: Record<string, string> = {
  finance: 'المالية والتقارير',
  stocktaking: 'الجرد',
  'platform-admin': 'إدارة المنصة',
};

/**
 * Canonical dashboard route → Arabic label map.
 * Derived from the single source of truth in navigation.ts.
 * Consumed by Header breadcrumbs and the ChatBot navigator — do not
 * redeclare route label maps in components.
 */
export const routeLabels: Record<string, string> = { ...LEGACY_OVERRIDES };

for (const group of buildNavGroups('ar')) {
  for (const item of group.items) {
    const parts = item.href.split('/').filter(Boolean);
    if (parts.length > 1) {
      const segment = parts[parts.length - 1];
      if (!routeLabels[segment]) {
        routeLabels[segment] = item.label;
      }
    }
  }
}

export function routeLabel(segment: string): string {
  return routeLabels[segment] ?? segment;
}
