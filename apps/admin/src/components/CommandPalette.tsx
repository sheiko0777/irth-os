'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Search } from 'lucide-react';
import { buildNavGroups } from '@/lib/navigation';
import { signOut } from '@/lib/auth-client';

/**
 * The console's command palette (Ctrl+K / ⌘K).
 *
 * Hand-built rather than cmdk: the stock libraries assume LTR and ship their
 * own visual language, and this dialog is one of the two brand moments in the
 * app (the other is login). Owning the ~200 lines costs less than fighting a
 * dependency's opinions in RTL.
 *
 * Opens from the keyboard or from any element dispatching the
 * `irth:palette` window event — that keeps the header trigger decoupled
 * from this component's tree position.
 */

type Command = {
  id: string;
  label: string;
  group: string;
  icon: React.ElementType;
  keywords: string;
  run: () => void;
};

/**
 * Arabic search normalisation. Operators type fast and unvowelled: unify the
 * alef family, taa marbuta and alef maqsura, strip tatweel and diacritics.
 * Without this, "الاعدادات" fails to find "الإعدادات" — a hamza away.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .trim();
}

export function CommandPalette({ locale }: { locale: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const commands = useMemo<Command[]>(() => {
    const nav = buildNavGroups(locale).flatMap((g) =>
      g.items.map((item) => ({
        id: item.href,
        label: item.label,
        group: g.label,
        icon: item.icon,
        keywords: item.keywords ?? '',
        run: () => router.push(item.href),
      })),
    );
    return [
      ...nav,
      {
        id: 'logout',
        label: 'تسجيل الخروج',
        group: 'إجراءات',
        icon: LogOut,
        keywords: 'logout signout exit',
        run: () => {
          void signOut().then(() => {
            router.push(`/${locale}/login`);
            router.refresh();
          });
        },
      },
    ];
  }, [locale, router]);

  const results = useMemo(() => {
    const q = normalize(query);
    if (!q) return commands;
    // startsWith outranks includes; label match outranks keyword match.
    return commands
      .map((c) => {
        const label = normalize(c.label);
        const kw = c.keywords.toLowerCase();
        const score = label.startsWith(q) ? 3
          : label.includes(q) ? 2
          : kw.includes(q) ? 1
          : 0;
        return { c, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.c);
  }, [commands, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActive(0);
  }, []);

  // Global bindings. Ctrl+K is claimed unconditionally — the browser's own
  // binding (focus address bar) is exactly what an operator inside a console
  // does not want.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') close();
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('irth:palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('irth:palette', onOpen);
    };
  }, [close]);

  // Focus the input on open and freeze the page behind the scrim.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Keep the active row in view while arrowing through a clipped list.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      results[active].run();
      close();
    }
  };

  // Group headers interleave with rows in render order; results stay ranked.
  let lastGroup = '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[16vh] px-4"
      style={{ background: 'rgba(2,4,6,.7)' }}
      onMouseDown={close}
      role="presentation"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-[var(--rim2)] bg-[var(--card-bg)]"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="لوحة الأوامر"
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--rim1)] px-4">
          <Search size={15} className="shrink-0 text-[var(--t3)]" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            placeholder="ابحث أو انتقل إلى..."
            className="h-12 w-full bg-transparent text-sm text-[var(--t1)] placeholder:text-[var(--t3)] focus:outline-none"
            aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
          />
          <kbd
            className="shrink-0 rounded-md border border-[var(--rim2)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--t3)]"
            dir="ltr"
          >
            Esc
          </kbd>
        </div>

        <ul ref={listRef} className="max-h-[46vh] overflow-y-auto p-2" role="listbox">
          {results.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-[var(--t3)]">
              لا نتائج لـ&quot;{query}&quot;
            </li>
          )}
          {results.map((cmd, i) => {
            const Icon = cmd.icon;
            const header = cmd.group !== lastGroup ? cmd.group : null;
            lastGroup = cmd.group;
            const isActive = i === active;
            return (
              <li key={cmd.id}>
                {header && (
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                    {header}
                  </p>
                )}
                <button
                  id={`cmd-${cmd.id}`}
                  data-index={i}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    cmd.run();
                    close();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors"
                  style={
                    isActive
                      ? {
                          background: 'var(--raised)',
                          // The same 3px gold bar as the sidebar's active item
                          // (Sidebar's border-s-2): one signature, used
                          // everywhere "current" is meant. Negative inset-x =
                          // right edge — box-shadow has no logical form, so
                          // this one stays physical and matches border-s only
                          // in RTL.
                          boxShadow: 'inset -3px 0 0 var(--gold)',
                          color: 'var(--t1)',
                        }
                      : { color: 'var(--t2)' }
                  }
                >
                  <Icon size={15} className="shrink-0 opacity-80" aria-hidden="true" />
                  <span className="truncate">{cmd.label}</span>
                  {isActive && (
                    <kbd
                      className="ms-auto shrink-0 rounded-md border border-[var(--rim2)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--t3)]"
                      dir="ltr"
                    >
                      ↵
                    </kbd>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
