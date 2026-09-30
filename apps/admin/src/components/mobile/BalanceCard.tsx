import type { ReactNode } from "react";
import { Money } from "@/components/ui/Money";

/**
 * The one headline figure of a phone screen — the cash a rep holds, what a
 * supplier is owed — on the navy hero surface, large enough to read at arm's
 * length. Amounts stay bigint minor units; this only renders them.
 */
export function BalanceCard({
  label,
  minor,
  currency = "EGP",
  icon,
  sub,
  children,
  "data-testid": testId,
  id,
}: {
  label: string;
  minor: bigint;
  currency?: string;
  icon?: ReactNode;
  sub?: ReactNode;
  /** Actions under the figure: a handover form, a statement link. */
  children?: ReactNode;
  "data-testid"?: string;
  id?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className="surface-hero relative overflow-hidden rounded-[calc(var(--card-radius)+6px)] p-5"
    >
      <div className="flex items-center gap-3">
        {icon && (
          <span
            className="grid size-10 place-items-center rounded-xl bg-white/15 [&_svg]:size-[18px]"
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <h2 id={id} className="text-sm font-medium text-[var(--hero-muted)]">
          {label}
        </h2>
      </div>
      <p className="mt-5 text-[2.5rem] font-semibold leading-none tracking-tight">
        <Money minor={minor} currency={currency} emphasis data-testid={testId} />
      </p>
      {sub && <div className="mt-3 text-xs text-[var(--hero-muted)]">{sub}</div>}
      {children && <div className="mt-5">{children}</div>}
    </section>
  );
}
