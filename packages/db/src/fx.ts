import { and, desc, eq, lte } from 'drizzle-orm';
import { currency, type FxRate } from '@irth/domain';
import { exchangeRates } from './schema/exchangeRates';
import type { DbTx } from './index';

export class MissingExchangeRateError extends Error {
  constructor(public readonly base: string, public readonly quote: string, public readonly asOf: string) {
    super(`No ${base}->${quote} exchange rate on or before ${asOf}`);
    this.name = 'MissingExchangeRateError';
  }
}

/**
 * The latest org rate for base->quote with as_of <= asOf (YYYY-MM-DD).
 * Identity (1/1) when base == quote. Throws MissingExchangeRateError rather
 * than guessing: a posting with an invented rate is worse than a failed one.
 */
export async function lookupRate(
  tx: Pick<DbTx, 'select'>,
  orgId: string,
  base: string,
  quote: string,
  asOf: string,
): Promise<FxRate> {
  if (base === quote) return { base: currency(base), quote: currency(quote), num: 1n, den: 1n };

  const [row] = await tx.select({ num: exchangeRates.rateNum, den: exchangeRates.rateDen })
    .from(exchangeRates)
    .where(and(
      eq(exchangeRates.orgId, orgId),
      eq(exchangeRates.base, base),
      eq(exchangeRates.quote, quote),
      lte(exchangeRates.asOf, asOf),
    ))
    .orderBy(desc(exchangeRates.asOf))
    .limit(1);

  if (!row) throw new MissingExchangeRateError(base, quote, asOf);
  return { base: currency(base), quote: currency(quote), num: row.num, den: row.den };
}
