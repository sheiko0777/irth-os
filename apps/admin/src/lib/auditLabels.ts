/**
 * Audit Log Action and Entity Arabic Translation & Formatting Dictionary.
 */

export type AuditCategory = 'create' | 'update' | 'delete' | 'reconciliation' | 'security' | 'other';

export interface ActionMeta {
  labelAr: string;
  category: AuditCategory;
  badgeClass: string;
}

const ACTION_MAP: Record<string, { labelAr: string; category: AuditCategory }> = {
  // Products & Catalog
  CREATE_PRODUCT: { labelAr: 'إضافة منتج جديد', category: 'create' },
  UPDATE_PRODUCT: { labelAr: 'تعديل بيانات منتج', category: 'update' },
  DELETE_PRODUCT: { labelAr: 'حذف منتج', category: 'delete' },
  UPDATE_BIN_LOCATION: { labelAr: 'تحديث موقع الرف والتخزين', category: 'update' },

  // Inventory & Warehouse
  BATCH_ADJUST_STOCK: { labelAr: 'تسوية كميات مخزون (يدوي/مسح)', category: 'update' },
  STOCK_IN: { labelAr: 'استلام وإضافة مخزون', category: 'create' },
  STOCK_OUT: { labelAr: 'صرف وسحب مخزون', category: 'delete' },
  STOCKTAKING_SESSION_CREATE: { labelAr: 'بدء جلسة جرد مخزني', category: 'create' },
  STOCKTAKING_RECONCILIATION: { labelAr: 'اعتماد وتسوية الجرد الفعلي', category: 'reconciliation' },

  // Orders & Sales
  CREATE_ORDER: { labelAr: 'إنشاء طلب جديد', category: 'create' },
  UPDATE_ORDER_STATUS: { labelAr: 'تغيير حالة طلب', category: 'update' },
  CANCEL_ORDER: { labelAr: 'إلغاء طلب', category: 'delete' },
  CONFIRM_ORDER: { labelAr: 'تأكيد طلب', category: 'update' },
  ORDER_DELIVERED: { labelAr: 'تسليم طلب للعميل', category: 'update' },

  // Purchasing & Suppliers
  CREATE_PURCHASE_ORDER: { labelAr: 'إنشاء أمر شراء', category: 'create' },
  UPDATE_PURCHASE_ORDER: { labelAr: 'تعديل أمر شراء', category: 'update' },
  RECEIVE_PURCHASE_ORDER: { labelAr: 'استلام بضاعة أمر شراء', category: 'create' },

  // Returns
  CREATE_RETURN: { labelAr: 'إنشاء طلب إرجاع', category: 'create' },
  APPROVE_RETURN: { labelAr: 'الموافقة على إرجاع', category: 'update' },

  // Members & Permissions
  INVITE_MEMBER: { labelAr: 'إرسال دعوة عضو جديد', category: 'security' },
  ACCEPT_INVITE: { labelAr: 'قبول دعوة الانضمام', category: 'security' },
  UPDATE_MEMBER_ROLE: { labelAr: 'تعديل صلاحيات العضو', category: 'security' },
  REMOVE_MEMBER: { labelAr: 'إزالة عضو من المنشأة', category: 'delete' },
  REVOKE_INVITE: { labelAr: 'إلغاء دعوة عضو', category: 'delete' },

  // Coupons & Pricing
  CREATE_COUPON: { labelAr: 'إنشاء كود خصم / كوبون', category: 'create' },
  UPDATE_COUPON: { labelAr: 'تعديل بيانات كوبون', category: 'update' },
  DELETE_COUPON: { labelAr: 'حذف كود خصم', category: 'delete' },

  // Settings & Integrations
  UPDATE_SETTINGS: { labelAr: 'تحديث إعدادات المنشأة', category: 'update' },
  UPDATE_ORG_SETTINGS: { labelAr: 'تحديث إعدادات المنشأة', category: 'update' },
  CONNECT_INTEGRATION: { labelAr: 'ربط تكامل جديد', category: 'security' },
  DISCONNECT_INTEGRATION: { labelAr: 'فصل تكامل', category: 'delete' },
};

const TABLE_MAP: Record<string, string> = {
  products: 'المنتجات',
  product_variants: 'متغيرات المنتجات',
  categories: 'التصنيفات',
  inventory_items: 'أصناف المخزون',
  inventory_movements: 'حركات المخزون',
  orders: 'الطلبات',
  order_items: 'أصناف الطلبات',
  order_returns: 'طلبات الإرجاع',
  purchase_orders: 'أوامر الشراء',
  suppliers: 'الموردين',
  org_members: 'فريق العمل والأعضاء',
  org_invites: 'دعوات الانضمام',
  org_settings: 'إعدادات المنشأة',
  coupons: 'الكوبونات والخصومات',
  gift_cards: 'بطاقات الهدايا',
  campaigns: 'الحملات التسويقية',
  stocktaking_sessions: 'جلسات الجرد',
  shipping_zones: 'مناطق الشحن',
  integrations: 'التكاملات والربط',
};

export function getActionMeta(action: string): ActionMeta {
  const normalized = action.toUpperCase().trim();
  const known = ACTION_MAP[normalized];

  if (known) {
    return {
      labelAr: known.labelAr,
      category: known.category,
      badgeClass: getCategoryBadgeClass(known.category),
    };
  }

  // Fallback heuristic based on prefix
  if (normalized.startsWith('CREATE') || normalized.startsWith('INSERT') || normalized.startsWith('ADD')) {
    return {
      labelAr: `إضافة (${action})`,
      category: 'create',
      badgeClass: getCategoryBadgeClass('create'),
    };
  }
  if (normalized.startsWith('UPDATE') || normalized.startsWith('EDIT') || normalized.startsWith('CHANGE')) {
    return {
      labelAr: `تعديل (${action})`,
      category: 'update',
      badgeClass: getCategoryBadgeClass('update'),
    };
  }
  if (normalized.startsWith('DELETE') || normalized.startsWith('REMOVE') || normalized.startsWith('CANCEL') || normalized.startsWith('REVOKE')) {
    return {
      labelAr: `حذف / إلغاء (${action})`,
      category: 'delete',
      badgeClass: getCategoryBadgeClass('delete'),
    };
  }
  if (normalized.includes('RECONCILE') || normalized.includes('ADJUST')) {
    return {
      labelAr: `تسوية (${action})`,
      category: 'reconciliation',
      badgeClass: getCategoryBadgeClass('reconciliation'),
    };
  }

  return {
    labelAr: action,
    category: 'other',
    badgeClass: getCategoryBadgeClass('other'),
  };
}

export function getTableLabelAr(tableName: string): string {
  return TABLE_MAP[tableName.toLowerCase()] || tableName;
}

function getCategoryBadgeClass(category: AuditCategory): string {
  switch (category) {
    case 'create':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'update':
      return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'delete':
      return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
    case 'reconciliation':
      return 'bg-purple-500/15 text-purple-400 border-purple-500/30';
    case 'security':
      return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    default:
      return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30';
  }
}
