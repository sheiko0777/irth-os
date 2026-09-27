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
 * The icon sits in a soft accent tile: an empty table is not a warning, so it
 * never takes a status colour the operator needs for the alert panel.
 */
export function EmptyState({ title, hint, icon: Icon = Inbox, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 px-6 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-[var(--accent-soft)]">
        <Icon size={22} className="text-[var(--accent)]" aria-hidden="true" />
      </span>
      <h3 className="text-sm font-semibold text-[var(--t1)]">{title}</h3>
      {hint && <p className="max-w-[38ch] text-xs leading-relaxed text-[var(--t3)]">{hint}</p>}
      {action && (
        <Link
          href={action.href}
          className="mt-1 inline-flex min-h-10 items-center rounded-[var(--control-radius)] bg-[var(--accent)] px-4 text-xs font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
