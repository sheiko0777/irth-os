import { currency, formatMoney, fromMinor } from "@irth/domain";
import { cn } from "@/lib/utils";

interface MoneyProps {
  minor: bigint;
  currency?: string;
  className?: string;
  /**
   * Headline figures: pounds at full weight, piastres and the currency mark
   * muted. Presentation only; the string is formatMoney's, split for styling,
   * so the text a screen reader or a test reads is unchanged.
   */
  emphasis?: boolean;
  "data-testid"?: string;
}

const PARTS = /^(.*?)(\d[\d,]*)(\.\d+)?(.*)$/u;

export function Money({
  minor,
  currency: currencyCode = "EGP",
  className,
  emphasis = false,
  "data-testid": dataTestId = "money-value",
}: MoneyProps) {
  const text = formatMoney(fromMinor(minor, currency(currencyCode)), {
    digits: "latin",
  });
  const parts = emphasis ? PARTS.exec(text) : null;
  return (
    <bdi
      dir="ltr"
      className={cn("tabular-nums", className)}
      data-testid={dataTestId}
    >
      {parts ? (
        <>
          {parts[1]}
          {parts[2]}
          <span className="opacity-55">
            {parts[3] ?? ""}
            <span className="text-[0.55em] font-medium">{parts[4]}</span>
          </span>
        </>
      ) : (
        text
      )}
    </bdi>
  );
}
