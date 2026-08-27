'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

const STORAGE_KEY = 'irth-os-theme';

type Theme = 'light' | 'dark';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const next: Theme = saved === 'dark' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.dataset.theme = next;
  }, []);

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'light' ? 'التبديل إلى الوضع الداكن' : 'التبديل إلى الوضع الفاتح'}
      title={theme === 'light' ? 'الوضع الداكن' : 'الوضع الفاتح'}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--rim2)] bg-[var(--surface)] text-[var(--t2)] transition-colors hover:border-[var(--gold)]/50 hover:text-[var(--gold)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]"
    >
      {theme === 'light' ? <Moon size={14} aria-hidden="true" /> : <Sun size={14} aria-hidden="true" />}
      <span className="sr-only">{theme === 'light' ? 'الوضع الداكن' : 'الوضع الفاتح'}</span>
    </button>
  );
}

export function ThemeStatusIcon() {
  return <Monitor size={13} aria-hidden="true" />;
}
