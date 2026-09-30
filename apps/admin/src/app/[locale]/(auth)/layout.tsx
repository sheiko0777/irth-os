import { ReactNode } from "react";

/**
 * The auth shell is the brand's front door — the one screen every operator
 * sees every day before the dense tables take over: the lit canvas behind a
 * glass card, the navy mark, and the accent thread under the wordmark.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden p-4">
      {/* The glow is paint, not content — out of the a11y tree, no pointer trap. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
        style={{
          background:
            'radial-gradient(640px 340px at 50% 0%, var(--accent-soft), transparent 70%)',
        }}
      />

      <header className="rise relative mb-10 flex flex-col items-center gap-3 text-center">
        <div className="grid size-14 place-items-center rounded-2xl bg-[linear-gradient(135deg,var(--hero-from),var(--hero-to))] shadow-[var(--float-shadow)]">
          <span className="text-2xl font-bold leading-none text-[var(--hero-fg)]">إ</span>
        </div>
        <div>
          <h1
            className="font-display text-3xl font-bold tracking-tight"
            // Inline because the global unlayered `h1 { color: t1 }` rule
            // outranks Tailwind's layered utilities.
            style={{ color: 'var(--accent)' }}
            dir="ltr"
          >
            IRTH OS
          </h1>
          <p className="mt-1 text-xs font-medium text-[var(--text-secondary)]">
            نظام العمليات
          </p>
        </div>
        <hr className="thread-gold w-40" />
      </header>

      <div className="rise relative w-full max-w-md" style={{ animationDelay: '90ms' }}>
        {children}
      </div>

      <p className="rise relative mt-10 text-xs text-[var(--text-secondary)]" style={{ animationDelay: '180ms' }}>
        تجارة تُدار بهدوء
      </p>
    </div>
  );
}