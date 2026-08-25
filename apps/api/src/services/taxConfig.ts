import { orgSettings } from '@irth/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { DbInstance } from '@irth/db';

// Accepts the plain db or a transaction handle — both expose the same
// select() shape, and passing tx keeps the settings read inside the caller's
// transaction. Same pattern as withAudit's AuditWriter in @irth/db.
type SettingsReader = Pick<DbInstance, 'select'>;

// Mirrors SETTING_KEYS in apps/admin/src/lib/settings.ts. Both apps read the
// same org_settings rows, so the key strings must stay identical.
const VAT_RATE_KEY = 'pricing.vat_rate';
const PRICES_INCLUDE_TAX_KEY = 'pricing.prices_include_tax';
const CURRENCY_KEY = 'pricing.currency';

export type TaxConfig = {
  /** Basis points: 1400 = 14.00%. */
  rateBps: number;
  /** Whether catalog prices already contain the tax. */
  pricesIncludeTax: boolean;
  currency: string;
};

// Egypt's standard VAT rate, tax-inclusive consumer pricing (the shelf price
// is what the customer pays). Used only when an org has not set its own
// values; every order snapshots whatever was resolved, so changing these
// later never rewrites historical tax.
export const DEFAULT_TAX_CONFIG: TaxConfig = {
  rateBps: 1400,
  pricesIncludeTax: true,
  currency: 'EGP',
};

/**
 * Reads an org's tax treatment. `pricing.vat_rate` is stored as a percentage
 * string ("14", "5", "0") for the settings UI; it is converted to basis
 * points here so all downstream arithmetic stays on exact integers.
 */
export async function getTaxConfig(db: SettingsReader, orgId: string): Promise<TaxConfig> {
  const rows = await db
    .select({ key: orgSettings.key, value: orgSettings.value })
    .from(orgSettings)
    .where(and(
      eq(orgSettings.orgId, orgId),
      inArray(orgSettings.key, [VAT_RATE_KEY, PRICES_INCLUDE_TAX_KEY, CURRENCY_KEY]),
    ));

  const settings = new Map(rows.map(r => [r.key, r.value]));

  const ratePercent = Number(settings.get(VAT_RATE_KEY));
  // A malformed or missing rate falls back to the default rather than
  // silently becoming NaN -> 0, which would under-report tax to zero.
  const rateBps = Number.isFinite(ratePercent) && ratePercent >= 0
    ? Math.round(ratePercent * 100)
    : DEFAULT_TAX_CONFIG.rateBps;

  const includeRaw = settings.get(PRICES_INCLUDE_TAX_KEY);
  const pricesIncludeTax = includeRaw === undefined
    ? DEFAULT_TAX_CONFIG.pricesIncludeTax
    : includeRaw === 'true';

  return {
    rateBps,
    pricesIncludeTax,
    currency: settings.get(CURRENCY_KEY) || DEFAULT_TAX_CONFIG.currency,
  };
}
