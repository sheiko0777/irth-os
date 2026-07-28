/**
 * Rule-based intent matcher for the in-app assistant.
 * Pure function + data table so it is unit-testable outside React.
 */

export type ChatIntent =
  | { type: 'help'; query: '' }
  | { type: 'nav'; query: string }
  | { type: 'search'; query: string }
  | { type: 'unknown'; query: string };

/** Ordered — first match wins. Keywords are substring checks on lowercased input. */
const NAV_RULES: Array<{ route: string; keywords: string[] }> = [
  { route: 'orders',        keywords: ['طلب', 'order'] },
  { route: 'products',      keywords: ['منتج', 'product'] },
  { route: 'customers',     keywords: ['عميل', 'customer'] },
  { route: 'inventory',     keywords: ['مخزون', 'inventor'] },
  { route: 'categories',    keywords: ['فئة', 'categor'] },
  { route: 'analytics',     keywords: ['تقرير', 'analytic', 'احصاء'] },
  { route: 'returns',       keywords: ['ارجاع', 'return'] },
  { route: 'shipping',      keywords: ['شحن', 'shipping'] },
  { route: 'pricelists',    keywords: ['سعر', 'pricelist'] },
  { route: 'stocktaking',   keywords: ['جرد', 'stocktak'] },
  { route: 'courier',       keywords: ['تسوية', 'courier'] },
  { route: 'notifications', keywords: ['اشعار', 'notif'] },
];

const SEARCH_TRIGGERS = ['ابحث', 'بحث', 'search'];
const SEARCH_STRIP = /ابحث عن|بحث عن|search for|بحث/gi;

export function matchIntent(text: string): ChatIntent {
  const t = text.trim().toLowerCase();

  if (t.includes('مساعدة') || t === 'help') return { type: 'help', query: '' };

  for (const rule of NAV_RULES) {
    if (rule.keywords.some((k) => t.includes(k))) {
      return { type: 'nav', query: rule.route };
    }
  }

  if (SEARCH_TRIGGERS.some((k) => t.includes(k))) {
    const q = text.replace(SEARCH_STRIP, '').trim();
    return { type: 'search', query: q };
  }

  return { type: 'unknown', query: text };
}
