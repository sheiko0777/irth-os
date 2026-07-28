export type OrgPlan = 'starter' | 'growth' | 'enterprise';

export type OrgConfig = {
  id: string;
  orgId: string;
  plan: string;
  isActive: boolean;
  enabledScreens: string[] | null;
  disabledScreens: string[] | null;
  maxUsers: number | null;
  notes: string | null;
};

export type OrgRow = {
  id: string;
  name: string;
  slug: string;
  brand: string;
  memberCount: number;
  config: OrgConfig | null;
};

export const ALL_SCREENS = [
  { slug: 'orders', label: 'الطلبات' },
  { slug: 'customers', label: 'العملاء' },
  { slug: 'customer-segments', label: 'شرائح العملاء' },
  { slug: 'products', label: 'المنتجات' },
  { slug: 'categories', label: 'التصنيفات' },
  { slug: 'inventory', label: 'المخزون' },
  { slug: 'stocktaking', label: 'جرد المخزون' },
  { slug: 'purchasing', label: 'المشتريات' },
  { slug: 'returns', label: 'المرتجعات' },
  { slug: 'finance', label: 'المالية' },
  { slug: 'analytics', label: 'التحليلات' },
  { slug: 'coupons', label: 'الكوبونات' },
  { slug: 'pricelists', label: 'قوائم الأسعار' },
  { slug: 'campaigns', label: 'الحملات' },
  { slug: 'gift-cards', label: 'بطاقات الهدايا' },
  { slug: 'loyalty', label: 'نقاط الولاء' },
  { slug: 'corporate-accounts', label: 'حسابات الشركات' },
  { slug: 'flash-sales', label: 'العروض المؤقتة' },
  { slug: 'audit-log', label: 'سجل النشاط' },
  { slug: 'courier', label: 'الشحن والتسوية' },
  { slug: 'shipping', label: 'مناطق الشحن' },
  { slug: 'eta', label: 'الفواتير الإلكترونية' },
  { slug: 'integrations', label: 'التكاملات' },
  { slug: 'notifications', label: 'الإشعارات' },
  { slug: 'settings', label: 'الإعدادات' },
];

export const STARTER = ['orders', 'customers', 'products', 'inventory', 'settings'];
export const GROWTH = [...STARTER, 'customer-segments', 'categories', 'stocktaking', 'returns', 'finance', 'analytics', 'coupons', 'campaigns', 'shipping', 'notifications'];
export const ENTERPRISE = ALL_SCREENS.map((s) => s.slug);

export const PLAN_SCREENS: Record<OrgPlan, string[]> = { starter: STARTER, growth: GROWTH, enterprise: ENTERPRISE };

export function planOf(config: OrgConfig | null): OrgPlan {
  const p = config?.plan;
  if (p === 'growth' || p === 'enterprise') return p;
  return 'starter';
}

export function toSlug(name: string) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 50);
}
