// Arabic labels for the permission matrix on the roles screen. Client-safe:
// the matrix itself comes from the import-free permissions module, never from
// the '@irth/db' barrel (see lib/permissions.ts for why).
//
// Every resource and action declared in packages/db/src/permissions.ts must
// have a label here; permissionCatalog.test.ts fails the build otherwise, so a
// new screen cannot ship without appearing on the roles screen.
import { PERMISSIONS, type Resource } from '@irth/db/src/permissions';

export const RESOURCE_LABELS: Record<Resource, string> = {
  dashboard: 'الرئيسية',
  orders: 'الطلبات',
  customers: 'العملاء وشرائحهم',
  products: 'المنتجات',
  categories: 'التصنيفات',
  inventory: 'المخزون والجرد',
  pricelists: 'قوائم الأسعار',
  purchasing: 'المشتريات والموردون',
  returns: 'المرتجعات',
  coupons: 'الكوبونات',
  giftCards: 'كروت الهدايا',
  campaigns: 'الحملات',
  finance: 'المالية والتقارير المالية',
  analytics: 'التحليلات',
  eta: 'الفواتير الإلكترونية',
  courier: 'الشحن والتسوية',
  shipping: 'مناطق الشحن',
  integrations: 'التكاملات',
  settings: 'الإعدادات',
  members: 'الأعضاء',
  roles: 'الأدوار والصلاحيات',
  audit: 'سجلات الرقابة',
  sensitive: 'حقول حساسة',
};

/** Shared names; a resource-specific entry in ACTION_OVERRIDES wins. */
const ACTION_LABELS: Record<string, string> = {
  view: 'عرض',
  write: 'إضافة وتعديل',
  delete: 'حذف',
  export: 'تصدير',
  count: 'تسجيل الجرد',
  invite: 'دعوة',
  changeRole: 'تغيير الدور',
  remove: 'إزالة',
  connect: 'ربط',
  manage: 'إدارة',
  recover: 'إعادة المحاولة',
  submit: 'إرسال',
  create: 'إنشاء حساب',
  resetPassword: 'إعادة تعيين كلمة السر',
  suspend: 'إيقاف وتفعيل',
};

const ACTION_OVERRIDES: Partial<Record<Resource, Record<string, string>>> = {
  integrations: { manage: 'تغيير إعدادات الربط', recover: 'إعادة إرسال الأحداث الفاشلة' },
  roles: { manage: 'إنشاء وتعديل وحذف الأدوار' },
  eta: { submit: 'إرسال للمصلحة' },
  sensitive: { cost: 'رؤية التكلفة والهامش', supplierPrice: 'رؤية أسعار الموردين', customerContact: 'رؤية بيانات تواصل العملاء' },
};

export function actionLabel(resource: Resource, action: string): string {
  return ACTION_OVERRIDES[resource]?.[action] ?? ACTION_LABELS[action] ?? action;
}

export function hasActionLabel(resource: Resource, action: string): boolean {
  return Boolean(ACTION_OVERRIDES[resource]?.[action] ?? ACTION_LABELS[action]);
}

export const PRINCIPAL_KIND_LABELS = {
  staff: 'موظف',
  delivery_rep: 'مندوب توصيل',
  sales_rep: 'مندوب مبيعات',
  supplier: 'مورد',
} as const;

/** Resources in display order, each with its declared actions. */
export function catalog(): Array<{ resource: Resource; actions: string[] }> {
  return (Object.keys(RESOURCE_LABELS) as Resource[]).map((resource) => ({
    resource,
    actions: Object.keys(PERMISSIONS[resource]),
  }));
}
