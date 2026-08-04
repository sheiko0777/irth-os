import Link from 'next/link';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  /** What is missing, stated plainly. */
  title: string;
  /** One line telling the operator how to populate this view. */
  hint?: string;
  icon?: React.ElementType;
  action?: { label: string; href: string };
}

/**
 * The empty view for a list or table.
 *
 * Sibling of ErrorState and deliberately shaped like it, so "nothing here" and
 * "something broke" read as the same family rather than two unrelated screens.
 *
 * The icon sits in a muted circle rather than taking an accent colour: an empty
 * table is not a warning, and tinting it crimson or gold would spend attention
 * the operator needs for the alert panel.
 */
export function EmptyState({ title, hint, icon: Icon = Inbox, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 px-6 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-[var(--rim1)]">
        <Icon size={20} className="text-[var(--t3)]" aria-hidden="true" />
      </span>
      <h3 className="text-sm font-semibold text-[var(--t1)]">{title}</h3>
      {hint && <p className="max-w-[38ch] text-xs leading-relaxed text-[var(--t3)]">{hint}</p>}
      {action && (
        <Link
          href={action.href}
          className="mt-1 rounded-md border border-[var(--rim2)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--t2)] transition-colors hover:border-[var(--gold-br)] hover:text-[var(--gold)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
