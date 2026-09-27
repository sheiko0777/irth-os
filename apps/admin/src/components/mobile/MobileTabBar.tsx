"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  /** A same-page anchor (`#section-id`) or a path. */
  href: string;
  label: string;
  /** A rendered icon element: a component would not cross the server/client boundary. */
  icon: ReactNode;
}

/**
 * Phone-only bottom navigation (hidden from md up): the sections a rep or a
 * supplier reaches with a thumb. At most four items, each icon + label. For
 * same-page anchors the active tab follows the section in view.
 */
export function MobileTabBar({ items, label }: { items: TabItem[]; label: string }) {
  const [active, setActive] = useState(items[0]?.href);

  useEffect(() => {
    const anchors = items.filter((i) => i.href.startsWith("#"));
    const targets = anchors
      .map((i) => document.getElementById(i.href.slice(1)))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0 || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) setActive(`#${visible[0].target.id}`);
      },
      { rootMargin: "-30% 0px -55% 0px" },
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav
      aria-label={label}
      data-tabbar
      className="fixed inset-x-3 z-40 md:hidden"
      style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      <ul className="glass flex items-stretch justify-around gap-1 rounded-[1.5rem] p-1.5 shadow-[var(--float-shadow)]">
        {items.map(({ href, label: text, icon }) => {
          const current = active === href;
          return (
            <li key={href} className="flex-1">
              <a
                href={href}
                aria-current={current ? "location" : undefined}
                onClick={() => setActive(href)}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-[1.125rem] text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                  current
                    ? "bg-[var(--accent)] text-[var(--accent-fg)] shadow-[0_8px_18px_-10px_var(--accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--accent-soft)]",
                )}
              >
                <span className="[&_svg]:size-5" aria-hidden="true">
                  {icon}
                </span>
                {text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
