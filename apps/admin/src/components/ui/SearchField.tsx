'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';

interface SearchFieldProps {
  /** The query-string key this field owns, e.g. `q`. */
  param: string;
  placeholder?: string;
}

/**
 * URL-backed search box.
 *
 * Debounced at 400ms: the server component refetches on every navigation, so
 * pushing per keystroke would fire a query per character. Long enough to batch
 * a burst of typing, short enough not to feel laggy.
 *
 * `replace` rather than `push` — typing a query should not stack twenty entries
 * in browser history that the back button has to walk out of one by one.
 */
export function SearchField({ param, placeholder = 'ابحث...' }: SearchFieldProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initial = searchParams.get(param) ?? '';
  const [value, setValue] = useState(initial);
  // Skips the debounce on first render and whenever the URL drives the value,
  // so landing on a filtered link does not immediately re-navigate to itself.
  const skip = useRef(true);

  useEffect(() => {
    setValue(searchParams.get(param) ?? '');
    skip.current = true;
  }, [searchParams, param]);

  useEffect(() => {
    if (skip.current) {
      skip.current = false;
      return;
    }
    const t = setTimeout(() => {
      const next = new URLSearchParams(searchParams.toString());
      if (value) next.set(param, value);
      else next.delete(param);
      next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 400);
    return () => clearTimeout(t);
  }, [value, param, pathname, router, searchParams]);

  return (
    <div className="relative">
      <Search
        size={14}
        className="pointer-events-none absolute inset-inline-start-0 top-1/2 -translate-y-1/2 text-[var(--t3)]"
        style={{ insetInlineStart: '10px' }}
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full rounded-md border border-[var(--rim2)] bg-[var(--card-bg)] text-sm text-[var(--t1)] placeholder:text-[var(--t3)] transition-colors focus:border-[var(--gold)] focus:outline-none md:w-64"
        style={{ paddingInlineStart: '32px', paddingInlineEnd: value ? '32px' : '12px' }}
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue('')}
          aria-label="مسح البحث"
          className="absolute top-1/2 -translate-y-1/2 text-[var(--t3)] transition-colors hover:text-[var(--t1)]"
          style={{ insetInlineEnd: '10px' }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
