import {
  Home, ShoppingCart, Users, UsersRound, Bell,
  Box, FolderOpen, Warehouse, ClipboardList, ShoppingBag, RotateCcw,
  DollarSign, PieChart, Tag, List, Megaphone, Gift,
  Truck, MapPin, FileText, Plug2,
  Settings, UserCog,
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
};
export type NavGroup = { label: string; items: NavItem[] };

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
        { href: `/${locale}/orders`, label: 'الطلبات', icon: ShoppingCart, keywords: 'orders' },
        { href: `/${locale}/customers`, label: 'العملاء', icon: Users, keywords: 'customers' },
        { href: `/${locale}/customer-segments`, label: 'شرائح العملاء', icon: UsersRound, keywords: 'segments' },
        { href: `/${locale}/notifications`, label: 'الإشعارات', icon: Bell, keywords: 'notifications' },
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
      label: 'الإعدادات',
      items: [
        { href: `/${locale}/settings`, label: 'الإعدادات', icon: Settings, keywords: 'settings' },
        { href: `/${locale}/settings/members`, label: 'الأعضاء', icon: UserCog, keywords: 'members team users' },
      ],
    },
  ];
}
