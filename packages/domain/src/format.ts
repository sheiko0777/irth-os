/**
 * One place that turns Money into text.
 *
 * Today the admin renders amounts at least four different ways: some screens
 * interpolate the raw decimal string straight from the column
 * (`{customer.totalSpent} ج.م` -> "1234.56 ج.م", ungrouped), analytics forces
 * zero fraction digits, gift cards force two, and the returns detail page
 * prints "EGP" instead of "ج.م". Same number, four appearances.
 */
import { type Currency, type Money, exponentOf, toDecimalString } from './money';

/**
 * Arabic symbols, matching what the UI already uses. `ج.م` is the established
 * spelling here — not the ISO code, which reads as a foreign string to the
 * Egyptian audience this admin is for.
 */
const SYMBOLS: Readonly<Record<string, string>> = {
  EGP: 'ج.م',
  SAR: 'ر.س',
  AED: 'د.إ',
  KWD: 'د.ك',
  USD: '$',
};

export function symbolOf(c: Currency): string {
  return SYMBOLS[c] ?? c;
}

export interface FormatOptions {
  /** BCP 47 tag. Defaults to Egyptian Arabic, which the admin renders in. */
  locale?: string;
  /**
   * `ar-EG` uses Arabic-Indic digits (١٢٣٤) by default, which is what the app
   * shows today. Pass 'latin' where digits must align in a column — Arabic-Indic
   * glyphs are not tabular in most fonts, so a right-aligned money column
   * visibly ragged is usually this.
   */
  digits?: 'default' | 'latin';
  /** Set false for a bare number, e.g. inside a column already headed "ج.م". */
  symbol?: boolean;
  /**
   * Drop the fraction. For KPI headlines where piastres are noise. Never use it
   * on an invoice line or anything that has to reconcile to a total.
   */
  hideFraction?: boolean;
}

function numberFormat(c: Currency, options: FormatOptions): Intl.NumberFormat {
  const base = options.locale ?? 'ar-EG';
  const locale = options.digits === 'latin' ? `${base}-u-nu-latn` : base;
  const digits = options.hideFraction ? 0 : exponentOf(c);

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: true,
  });
}

/**
 * Renders an amount with its symbol, e.g. "١٬٢٣٤٫٥٦ ج.م".
 *
 * The decimal string is handed to Intl directly rather than converted to a
 * number: `Number` loses precision past 2^53, and the whole point of holding
 * money as bigint is undone if the last step casts it back to a float.
 * Hermes (React Native) does not accept string arguments on every version, so
 * there is a numeric fallback — it is only reachable for values a storefront
 * will not produce.
 */
export function formatMoney(m: Money, options: FormatOptions = {}): string {
  const formatter = numberFormat(m.currency, options);
  const decimal = toDecimalString(m);

  let rendered: string;
  try {
    rendered = formatter.format(decimal as unknown as number);
  } catch {
    rendered = formatter.format(Number(decimal));
  }

  return options.symbol === false ? rendered : `${rendered} ${symbolOf(m.currency)}`;
}

/** Basis points as a percentage, e.g. 1400 -> "١٤٪". */
export function formatRate(basisPoints: number, options: FormatOptions = {}): string {
  const base = options.locale ?? 'ar-EG';
  const locale = options.digits === 'latin' ? `${base}-u-nu-latn` : base;
  const percent = basisPoints / 100;

  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(percent / 100);
}
