import { currency, formatMoney, fromMinor } from "@irth/domain";
import { cn } from "@/lib/utils";

interface MoneyProps {
  minor: bigint;
  currency?: string;
  className?: string;
  "data-testid"?: string;
}

export function Money({
  minor,
  currency: currencyCode = "EGP",
  className,
  "data-testid": dataTestId = "money-value",
}: MoneyProps) {
  return (
    <bdi
      dir="ltr"
      className={cn("tabular-nums", className)}
      data-testid={dataTestId}
    >
      {formatMoney(fromMinor(minor, currency(currencyCode)), {
        digits: "latin",
      })}
    </bdi>
  );
}
