/**
 * One place that turns Money into text.
 *
 * Today the admin renders amounts at least four different ways: some screens
 * interpolate the raw decimal string straight from the column
 * (`{customer.totalSpent} ج.م` -> "1234.56 ج.م", ungrouped), analytics forces
 * zero fraction digits, gift cards force two, and the returns detail page
 * prints "EGP" instead of "ج.م". Same number, four appearances.
 */
import {
  type Currency,
  type KnownCurrencyCode,
  type Money,
  exponentOf,
  toDecimalString,
} from './money';

/**
 * Arabic symbols, matching what the UI already uses. `ج.م` is the established
 * spelling here — not the ISO code, which reads as a foreign string to the
 * Egyptian audience this admin is for.
 */
const SYMBOLS: Record<KnownCurrencyCode, string> = {
  EGP: 'ج.م',
  USD: '$',
  SAR: 'ر.س',
  AED: 'د.إ',
  KWD: 'د.ك',
  BHD: 'د.ب',
  OMR: 'ر.ع',
};

export function symbolOf(c: Currency): string {
  return SYMBOLS[c as KnownCurrencyCode] ?? c;
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

/**
 * BCP 47 tag from FormatOptions: the caller's `locale` (default `ar-EG`), with
 * the `-u-nu-latn` Unicode extension appended when latin digits are requested.
 */
function resolveLocale(options: FormatOptions): string {
  const base = options.locale ?? 'ar-EG';
  return options.digits === 'latin' ? `${base}-u-nu-latn` : base;
}

function numberFormat(c: Currency, options: FormatOptions): Intl.NumberFormat {
  const locale = resolveLocale(options);
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

/**
 * Renders a date/time in the admin's locale -- the one place that turns a
 * Date into text, replacing ~21 independent `new Date(x).toLocaleDateString
 * ('ar-EG')`/`.toLocaleString('ar-EG')` call sites across the admin app.
 * One of those (orders/[id]/page.tsx) carries a comment recording a real bug
 * a developer hit and fixed only at that one call site: `toLocaleString()`
 * with no locale argument renders in the server's locale, not the user's --
 * every other bare call site had the same shape with no way to know whether
 * it already accounted for that.
 *
 * Defaults to date-only (`toLocaleDateString`, matching most call sites).
 * Pass `withTime: true` for the plain date+time sites (`toLocaleString`).
 * Pass `dateTimeOptions` for the handful of sites with a custom part set
 * (a full weekday/year/month/day greeting, a compact month/day/hour/minute
 * timestamp) -- `toLocaleDateString`/`toLocaleString` resolve identically
 * once explicit parts are given, so one code path covers both.
 */
export function formatDate(
  value: Date | string | number,
  options: FormatOptions & { withTime?: boolean; dateTimeOptions?: Intl.DateTimeFormatOptions } = {},
): string {
  const locale = resolveLocale(options);
  const date = value instanceof Date ? value : new Date(value);
  if (options.dateTimeOptions) return date.toLocaleDateString(locale, options.dateTimeOptions);
  return options.withTime ? date.toLocaleString(locale) : date.toLocaleDateString(locale);
}

/** Basis points as a percentage, e.g. 1400 -> "١٤٪". */
export function formatRate(basisPoints: number, options: FormatOptions = {}): string {
  const locale = resolveLocale(options);
  const percent = basisPoints / 100;

  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(percent / 100);
}
