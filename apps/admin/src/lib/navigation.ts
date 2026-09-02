import {
  Home, ShoppingCart, Users, UsersRound, Bell,
  Box, FolderOpen, Warehouse, ClipboardList, ShoppingBag, RotateCcw,
  DollarSign, PieChart, Tag, List, Megaphone, Gift,
  Truck, MapPin, FileText, Plug2,
  Settings, UserCog, BrainCircuit,
} from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  /** Canonical screen slug from platformPlans.ts. Items without one are always visible. */
  screen?: string;
  /**
   * Latin-script synonyms for the command palette. Operators type in whichever
   * keyboard layout is active; "orders" must find الطلبات without switching.
   */
  keywords?: string;
};
export type NavGroup = { label: string; items: NavItem[] };

export type ScreenAccess = {
  unrestricted: boolean;
  enabledScreens: string[] | null;
  disabledScreens: string[] | null;
};

export function filterNavGroupsByScreens(
  groups: NavGroup[],
  screens: ScreenAccess | null | undefined,
): NavGroup[] {
  if (!screens || screens.unrestricted) return groups;

  const enabledScreens = new Set(screens.enabledScreens ?? []);
  const disabledScreens = new Set(screens.disabledScreens ?? []);

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!item.screen) return true;
        return enabledScreens.has(item.screen) && !disabledScreens.has(item.screen);
      }),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * The single source of navigation truth. Sidebar and CommandPalette both
 * consume this — before it existed the sidebar carried its own inline copy,
 * which is exactly how a palette and a nav drift apart one route at a time.
 */
export function buildNavGroups(locale: string): NavGroup[] {
  return [
    {
      label: 'عام',
      items: [
        { href: `/${locale}`, label: 'الرئيسية', icon: Home, keywords: 'home dashboard' },
        { href: `/${locale}/orders`, label: 'الطلبات', icon: ShoppingCart, screen: 'orders', keywords: 'orders' },
        { href: `/${locale}/customers`, label: 'العملاء', icon: Users, screen: 'customers', keywords: 'customers' },
        { href: `/${locale}/customer-segments`, label: 'شرائح العملاء', icon: UsersRound, screen: 'customer-segments', keywords: 'segments' },
        { href: `/${locale}/notifications`, label: 'الإشعارات', icon: Bell, screen: 'notifications', keywords: 'notifications' },
        // No `screen` — not yet in platformPlans.ts's ALL_SCREENS, so it's
        // unrestricted by the feature-flag gating (task 7) until someone
        // adds an 'intelligence' plan slug.
        { href: `/${locale}/intelligence`, label: locale === 'ar' ? 'ذكاء إرث' : 'IRTH Intelligence', icon: BrainCircuit, keywords: 'ai assistant intelligence chatbot' },
      ],
    },
    {
      label: 'المخزون والمنتجات',
      items: [
        { href: `/${locale}/products`, label: 'المنتجات', icon: Box, screen: 'products', keywords: 'products' },
        { href: `/${locale}/categories`, label: 'التصنيفات', icon: FolderOpen, screen: 'categories', keywords: 'categories' },
        { href: `/${locale}/inventory`, label: 'المخزون', icon: Warehouse, screen: 'inventory', keywords: 'inventory stock' },
        { href: `/${locale}/stocktaking`, label: 'جرد المخزون', icon: ClipboardList, screen: 'stocktaking', keywords: 'stocktaking count' },
        { href: `/${locale}/purchasing`, label: 'المشتريات', icon: ShoppingBag, screen: 'purchasing', keywords: 'purchasing po suppliers' },
        { href: `/${locale}/returns`, label: 'المرتجعات', icon: RotateCcw, screen: 'returns', keywords: 'returns rma' },
      ],
    },
    {
      label: 'المالية والتقارير',
      items: [
        { href: `/${locale}/finance`, label: 'المالية', icon: DollarSign, screen: 'finance', keywords: 'finance money' },
        { href: `/${locale}/analytics`, label: 'التحليلات', icon: PieChart, screen: 'analytics', keywords: 'analytics reports' },
        { href: `/${locale}/coupons`, label: 'الكوبونات', icon: Tag, screen: 'coupons', keywords: 'coupons discount' },
        { href: `/${locale}/pricelists`, label: 'قوائم الأسعار', icon: List, screen: 'pricelists', keywords: 'pricelists pricing' },
        { href: `/${locale}/campaigns`, label: 'الحملات', icon: Megaphone, screen: 'campaigns', keywords: 'campaigns marketing' },
        { href: `/${locale}/gift-cards`, label: 'بطاقات الهدايا', icon: Gift, screen: 'gift-cards', keywords: 'gift cards' },
      ],
    },
    {
      label: 'العمليات',
      items: [
        { href: `/${locale}/courier`, label: 'الشحن والتسوية', icon: Truck, screen: 'courier', keywords: 'courier shipping cod' },
        { href: `/${locale}/shipping`, label: 'مناطق الشحن', icon: MapPin, screen: 'shipping', keywords: 'zones rates' },
        { href: `/${locale}/eta`, label: 'الفواتير الإلكترونية', icon: FileText, screen: 'eta', keywords: 'eta invoices tax' },
        { href: `/${locale}/integrations`, label: 'التكاملات', icon: Plug2, screen: 'integrations', keywords: 'integrations webhooks' },
      ],
    },
    {
      label: 'الإعدادات',
      items: [
        { href: `/${locale}/settings`, label: 'الإعدادات', icon: Settings, screen: 'settings', keywords: 'settings' },
        { href: `/${locale}/settings/members`, label: 'الأعضاء', icon: UserCog, screen: 'settings', keywords: 'members team users' },
      ],
    },
  ];
}
