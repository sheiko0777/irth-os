/**
 * Canonical dashboard route → Arabic label map.
 * Consumed by Header breadcrumbs and the ChatBot navigator — do not
 * redeclare route label maps in components.
 */
export const routeLabels: Record<string, string> = {
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

export function routeLabel(segment: string): string {
  return routeLabels[segment] ?? segment;
}
