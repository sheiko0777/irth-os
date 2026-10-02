import { currency, formatMoney, fromMinor, type Money as MoneyValue } from "@irth/domain";
import { cn } from "@/lib/utils";

type Amount =
  | { minor: bigint; currency?: string; value?: never }
  /** An already-built domain Money (e.g. a ledger total from a router). */
  | { value: MoneyValue; minor?: never; currency?: never };

type MoneyProps = Amount & {
  className?: string;
  /**
   * Headline figures: the currency mark drops further in size so the amount
   * leads. Presentation only; the string is formatMoney's, split for styling,
   * so the text a screen reader or a test reads is unchanged.
   */
  emphasis?: boolean;
  "data-testid"?: string;
};

const PARTS = /^(.*?\d[\d,]*(?:\.\d+)?)(.*)$/u;

/**
 * The one way an amount reaches the screen: amount first, then the currency
 * mark — smaller and muted — in an LTR isolate, so an RTL paragraph can never
 * flip it to "ج.م 0.00" next to a card that reads "877.20 ج.م". Western,
 * tabular digits; bigint minor units all the way to Intl.
 */
export function Money({
  className,
  emphasis = false,
  "data-testid": dataTestId = "money-value",
  ...amount
}: MoneyProps) {
  const money =
    amount.value ?? fromMinor(amount.minor, currency(amount.currency ?? "EGP"));
  const text = formatMoney(money);
  const parts = PARTS.exec(text);
  return (
    <bdi
      dir="ltr"
      className={cn("whitespace-nowrap tabular-nums", className)}
      data-testid={dataTestId}
    >
      {parts ? (
        <>
          {parts[1]}
          <span
            className={cn(
              "font-medium opacity-70",
              emphasis ? "text-[0.55em]" : "text-[0.8em]",
            )}
          >
            {parts[2]}
          </span>
        </>
      ) : (
        text
      )}
    </bdi>
  );
}
