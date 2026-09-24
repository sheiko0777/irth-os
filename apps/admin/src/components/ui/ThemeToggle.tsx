"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Theme = "system" | "light" | "dark";

const nextTheme: Record<Theme, Theme> = {
  system: "light",
  light: "dark",
  dark: "system",
};

function isTheme(value: unknown): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

export function ThemeToggle({ locale }: { locale: string }) {
  const [theme, setTheme] = useState<Theme>("system");
  const ar = locale === "ar";

  useEffect(() => {
    const applied = document.documentElement.dataset.theme;
    setTheme(isTheme(applied) ? applied : "system");

    const syncTheme = (event: StorageEvent) => {
      if (event.key !== "irth-theme") return;
      const value = isTheme(event.newValue) ? event.newValue : "system";
      document.documentElement.dataset.theme = value;
      setTheme(value);
    };

    window.addEventListener("storage", syncTheme);
    return () => window.removeEventListener("storage", syncTheme);
  }, []);

  const cycleTheme = () => {
    const value = nextTheme[theme];
    document.documentElement.dataset.theme = value;
    setTheme(value);
    try {
      localStorage.setItem("irth-theme", value);
    } catch {
      // The theme still applies for this page when storage is unavailable.
    }
  };

  const labels: Record<Theme, string> = ar
    ? {
        system: "النظام",
        light: "فاتح",
        dark: "داكن",
      }
    : {
        system: "system",
        light: "light",
        dark: "dark",
      };
  const label = ar
    ? `السمة ${labels[theme]}، التبديل إلى ${labels[nextTheme[theme]]}`
    : `Theme: ${labels[theme]}. Switch to ${labels[nextTheme[theme]]}`;
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  return (
    <button
      type="button"
      onClick={cycleTheme}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      className="inline-flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-[var(--separator)] bg-[var(--surface)] text-[var(--text-primary)] transition-colors hover:bg-[var(--raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}
