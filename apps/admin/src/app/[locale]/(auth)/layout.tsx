import { ReactNode } from "react";

/**
 * The auth shell is the brand's front door — the one screen every operator
 * sees every day before the dense tables take over, so it carries the two
 * signature gestures: a wide gold radial glow (5% opacity, fading over ~600px,
 * depth without a single shadow) and the heritage thread under the wordmark.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-ink p-4">
      {/* The glow is paint, not content — out of the a11y tree, no pointer trap. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
        style={{
          background:
            'radial-gradient(600px 320px at 50% 0%, rgba(224,144,0,.07), transparent 70%)',
        }}
      />

      <header className="rise relative mb-10 flex flex-col items-center gap-3 text-center">
        <div className="grid size-12 place-items-center rounded-xl border border-[var(--gold-br)] bg-[var(--gold-bg)]">
          <span className="text-2xl font-bold leading-none text-gold">إ</span>
        </div>
        <div>
          <h1
            className="font-display text-3xl font-bold tracking-tight"
            // Inline because the global unlayered `h1 { color: t1 }` rule
            // outranks Tailwind's layered utilities — `text-gold` loses there.
            style={{ color: 'var(--gold)' }}
            dir="ltr"
          >
            IRTH OS
          </h1>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-t3">
            نظام العمليات
          </p>
        </div>
        <hr className="thread-gold w-40" />
      </header>

      <div className="rise relative w-full max-w-md" style={{ animationDelay: '90ms' }}>
        {children}
      </div>

      <p className="rise relative mt-10 text-[10px] text-t4" style={{ animationDelay: '180ms' }}>
        تجارة تُدار بهدوء
      </p>
    </div>
  );
}