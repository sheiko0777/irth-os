import { describe, it, expect } from 'vitest';
import { routeLabel, routeLabels } from '../../lib/routeLabels';

const EXPECTED_LEGACY_MAP = {
  orders:        'الطلبات',
  products:      'المنتجات',
  inventory:     'المخزون',
  customers:     'العملاء',
  purchasing:    'المشتريات',
  integrations:  'التكاملات',
  finance:       'المالية والتقارير',
  analytics:     'التحليلات',
  coupons:       'الكوبونات',
  categories:    'التصنيفات',
  notifications: 'الإشعارات',
  settings:      'الإعدادات',
  members:       'الأعضاء',
  eta:           'الفواتير الإلكترونية',
  courier:       'الشحن والتسوية',
  returns:       'المرتجعات',
  campaigns:     'الحملات',
  stocktaking:   'الجرد',
  pricelists:    'قوائم الأسعار',
  shipping:      'مناطق الشحن',
  'gift-cards':  'بطاقات الهدايا',
  'customer-segments': 'شرائح العملاء',
  'platform-admin':    'إدارة المنصة',
};

describe('routeLabels', () => {
  it('resolves the intelligence route to its exact navigation.ts label without fallback', () => {
    // This is the specific bug we are fixing: 'intelligence' should resolve to 'ذكاء إرث'
    expect(routeLabel('intelligence')).toBe('ذكاء إرث');
  });

  it('preserves all 23 exact legacy route labels to prevent regressions', () => {
    const keys = Object.keys(EXPECTED_LEGACY_MAP) as (keyof typeof EXPECTED_LEGACY_MAP)[];

    // Make sure we are actually checking exactly 23 hardcoded keys
    expect(keys.length).toBe(23);

    for (const key of keys) {
      expect(routeLabel(key)).toBe(EXPECTED_LEGACY_MAP[key]);
    }
  });

  it('exported routeLabels object has all keys from legacy map plus derived ones', () => {
    for (const [key, value] of Object.entries(EXPECTED_LEGACY_MAP)) {
      expect(routeLabels[key]).toBe(value);
    }
    // Also has intelligence
    expect(routeLabels['intelligence']).toBe('ذكاء إرث');
  });
});
