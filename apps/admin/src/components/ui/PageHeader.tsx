import type { ReactNode } from "react";

/**
 * The title card every list screen opens with: an eyebrow naming the area, the
 * screen's title and one line on what it is for, and the screen's actions at
 * the end. One primary action at most; the rest are outline buttons.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  icon,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="glass flex flex-wrap items-center justify-between gap-4 rounded-[var(--card-radius)] p-5">
      <div className="flex min-w-0 items-center gap-4">
        {icon && (
          <span
            className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)] [&_svg]:size-[22px]"
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[11px] font-semibold tracking-wide text-[var(--accent)]">{eyebrow}</p>
          )}
          <h1 className="text-[1.5rem] font-semibold leading-tight tracking-tight text-[var(--text-primary)]">
            {title}
          </h1>
          {description && <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
