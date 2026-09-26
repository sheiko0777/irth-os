import type { EffectiveAccess } from './permissions';

/**
 * Sensitive fields (PR-1e, owner decision A5): a member without the matching
 * `sensitive.*` permission never receives these values — they are removed on
 * the server from every procedure's response, so no screen, export or direct
 * API call can show them. The request itself is not refused.
 *
 * Keys are removed, not zeroed or nulled: a cost of 0 reads as "free" and a
 * null reads as "unknown", and both would be wrong.
 *
 * Rules match by key name, optionally only under some procedure paths — a
 * key like `totalAmountMinor` is a supplier price on a purchase order but the
 * customer's total on a sales order.
 */
interface Rule {
  permission: 'sensitive.cost' | 'sensitive.supplierPrice' | 'sensitive.customerContact';
  keys: readonly string[];
  /** Procedure path prefixes the rule applies under; every path when absent. */
  paths?: readonly string[];
}

export const REDACTION_RULES: readonly Rule[] = [
  {
    permission: 'sensitive.cost',
    keys: ['costMinor', 'averageCostMinor', 'lineCostMinor', 'totalCostMinor', 'varianceValueMinor', 'cogsMinor', 'marginMinor', 'grossMarginMinor'],
  },
  { permission: 'sensitive.supplierPrice', keys: ['unitCostMinor'] },
  { permission: 'sensitive.supplierPrice', keys: ['totalAmountMinor'], paths: ['purchasing.'] },
  {
    permission: 'sensitive.customerContact',
    keys: ['phone', 'email', 'address', 'shippingAddress', 'billingAddress', 'buyer', 'customerPhone', 'customerEmail', 'customerAddress'],
    paths: ['orders.', 'deliveries.', 'customers.', 'customerSegments.', 'returns.', 'bulk.exportOrders', 'bulk.exportCustomers', 'dashboard.getRecentOrders'],
  },
];

/** The keys this member may not see under this procedure path. Empty = nothing to do. */
export function hiddenKeys(access: EffectiveAccess, path: string): Set<string> {
  const hidden = new Set<string>();
  for (const rule of REDACTION_RULES) {
    if (access.perms.has(rule.permission)) continue;
    if (rule.paths && !rule.paths.some((p) => path.startsWith(p))) continue;
    for (const k of rule.keys) hidden.add(k);
  }
  return hidden;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * A copy of `value` without the hidden keys, at any depth. Arrays and plain
 * objects are walked; everything else — Date, bigint, strings, class
 * instances — is passed through untouched, so superjson still serialises it.
 */
export function redact<T>(value: T, hidden: ReadonlySet<string>): T {
  if (hidden.size === 0) return value;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!isPlainObject(v)) return v;
    const out: Record<string, unknown> = {};
    for (const [k, child] of Object.entries(v)) {
      if (hidden.has(k)) continue;
      out[k] = walk(child);
    }
    return out;
  };
  return walk(value) as T;
}
