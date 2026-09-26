import {
  Home, ShoppingCart, Users, UsersRound, Bell,
  Box, FolderOpen, Warehouse, ClipboardList, ShoppingBag, RotateCcw,
  DollarSign, PieChart, Tag, List, Megaphone, Gift,
  Truck, MapPin, FileText, Plug2,
  Settings, UserCog, BrainCircuit, ShieldCheck, KeyRound,
} from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  /**
   * Latin-script synonyms for the command palette. Operators type in whichever
   * keyboard layout is active; "orders" must find الطلبات without switching.
   */
  keywords?: string;
  /**
   * The "resource.action" a member needs to see this entry (PR-1e). Hiding
   * it is UX only — the page and its procedures refuse on their own.
   * Absent = everyone (the caller's own notifications, the assistant).
   */
  requires?: string;
};
export type NavGroup = { label: string; items: NavItem[] };

/** Screen → permission, keyed by the path after the locale. */
const REQUIRES: Record<string, string> = {
  '': 'dashboard.view',
  orders: 'orders.view',
  customers: 'customers.view',
  'customer-segments': 'customers.view',
  products: 'products.view',
  categories: 'categories.view',
  inventory: 'inventory.view',
  stocktaking: 'inventory.view',
  purchasing: 'purchasing.view',
  returns: 'returns.view',
  finance: 'finance.view',
  analytics: 'analytics.view',
  coupons: 'coupons.view',
  pricelists: 'pricelists.view',
  campaigns: 'campaigns.view',
  'gift-cards': 'giftCards.view',
  courier: 'courier.view',
  shipping: 'shipping.view',
  eta: 'eta.view',
  integrations: 'integrations.view',
  settings: 'settings.view',
  'settings/members': 'members.view',
  'settings/roles': 'roles.view',
  audit: 'audit.view',
};

function withRequirement(locale: string, item: NavItem): NavItem {
  const path = item.href.slice(`/${locale}`.length).split('?')[0].replace(/^\//, '');
  return { ...item, requires: REQUIRES[path] };
}

/**
 * The permission a screen needs, from its URL — the deepest matching entry,
 * so /settings/members needs members.view, not settings.view. Undefined for
 * screens anyone may open.
 */
export function screenRequirement(locale: string, pathname: string): string | undefined {
  const path = pathname.slice(`/${locale}`.length).replace(/^\//, '').replace(/\/$/, '');
  if (path === '') return REQUIRES[''];
  const match = Object.keys(REQUIRES)
    .filter((k) => k !== '' && (path === k || path.startsWith(`${k}/`)))
    .sort((a, b) => b.length - a.length)[0];
  return match === undefined ? undefined : REQUIRES[match];
}

/** Only the entries this member may open; groups left empty are dropped. */
export function filterNavGroups(groups: NavGroup[], allowed: (permission: string) => boolean): NavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.requires || allowed(i.requires)) }))
    .filter((g) => g.items.length > 0);
}

/**
 * The single source of navigation truth. Sidebar and CommandPalette both
 * consume this — before it existed the sidebar carried its own inline copy,
 * which is exactly how a palette and a nav drift apart one route at a time.
 */
export function buildNavGroups(locale: string): NavGroup[] {
  const groups: NavGroup[] = [
    {
      label: 'عام',
      items: [
        { href: `/${locale}`, label: 'الرئيسية', icon: Home, keywords: 'home dashboard' },
        { href: `/${locale}/orders`, label: 'الطلبات', icon: ShoppingCart, keywords: 'orders' },
        { href: `/${locale}/customers`, label: 'العملاء', icon: Users, keywords: 'customers' },
        { href: `/${locale}/customer-segments`, label: 'شرائح العملاء', icon: UsersRound, keywords: 'segments' },
        { href: `/${locale}/notifications`, label: 'الإشعارات', icon: Bell, keywords: 'notifications' },
        { href: `/${locale}/intelligence`, label: locale === 'ar' ? 'ذكاء إرث' : 'IRTH Intelligence', icon: BrainCircuit, keywords: 'ai assistant intelligence chatbot' },
      ],
    },
    {
      label: 'المخزون والمنتجات',
      items: [
        { href: `/${locale}/products`, label: 'المنتجات', icon: Box, keywords: 'products' },
        { href: `/${locale}/categories`, label: 'التصنيفات', icon: FolderOpen, keywords: 'categories' },
        { href: `/${locale}/inventory`, label: 'المخزون', icon: Warehouse, keywords: 'inventory stock' },
        { href: `/${locale}/stocktaking`, label: 'جرد المخزون', icon: ClipboardList, keywords: 'stocktaking count' },
        { href: `/${locale}/purchasing`, label: 'المشتريات', icon: ShoppingBag, keywords: 'purchasing po suppliers' },
        { href: `/${locale}/returns`, label: 'المرتجعات', icon: RotateCcw, keywords: 'returns rma' },
      ],
    },
    {
      label: 'المالية والتقارير',
      items: [
        { href: `/${locale}/finance`, label: 'المالية', icon: DollarSign, keywords: 'finance money' },
        { href: `/${locale}/analytics`, label: 'التحليلات', icon: PieChart, keywords: 'analytics reports' },
        { href: `/${locale}/analytics?tab=carts`, label: 'سلات الشراء وسلوك العملاء', icon: ShoppingCart, keywords: 'carts abandoned behavior pixel shopify سلات متروكة زوار عملاء' },
        { href: `/${locale}/coupons`, label: 'الكوبونات', icon: Tag, keywords: 'coupons discount' },
        { href: `/${locale}/pricelists`, label: 'قوائم الأسعار', icon: List, keywords: 'pricelists pricing' },
        { href: `/${locale}/campaigns`, label: 'الحملات', icon: Megaphone, keywords: 'campaigns marketing' },
        { href: `/${locale}/gift-cards`, label: 'بطاقات الهدايا', icon: Gift, keywords: 'gift cards' },
      ],
    },
    {
      label: 'العمليات',
      items: [
        { href: `/${locale}/courier`, label: 'الشحن والتسوية', icon: Truck, keywords: 'courier shipping cod' },
        { href: `/${locale}/shipping`, label: 'مناطق الشحن', icon: MapPin, keywords: 'zones rates' },
        { href: `/${locale}/eta`, label: 'الفواتير الإلكترونية', icon: FileText, keywords: 'eta invoices tax' },
        { href: `/${locale}/integrations`, label: 'التكاملات', icon: Plug2, keywords: 'integrations webhooks' },
      ],
    },
    {
      label: 'الإعدادات والرقابة',
      items: [
        { href: `/${locale}/settings`, label: 'الإعدادات', icon: Settings, keywords: 'settings' },
        { href: `/${locale}/settings/members`, label: 'الأعضاء', icon: UserCog, keywords: 'members team users' },
        { href: `/${locale}/settings/roles`, label: 'الأدوار والصلاحيات', icon: KeyRound, keywords: 'roles permissions access أدوار صلاحيات' },
        { href: `/${locale}/audit`, label: 'سجلات الرقابة والنشاط', icon: ShieldCheck, keywords: 'audit logs activity history security رقابة سجلات حركات' },
      ],
    },
  ];
  return groups.map((g) => ({ ...g, items: g.items.map((i) => withRequirement(locale, i)) }));
}
