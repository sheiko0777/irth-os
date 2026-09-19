"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Button,
  Header,
  HeaderGlobalBar,
  HeaderMenuButton,
  HeaderName,
  SideNav,
  SideNavItems,
  SideNavLink,
} from "@carbon/react";
import { LogOut, Search, Shield, X } from "lucide-react";
import { signOut, useSession } from "@/lib/auth-client";
import { buildNavGroups } from "@/lib/navigation";
import { routeLabels } from "@/lib/routeLabels";
import { AlertPanel } from "./AlertPanel";
import { NotificationBell } from "./NotificationBell";
import { OrgSwitcher } from "./OrgSwitcher";

/** Client-only shell; server-rendered pages and all data/auth boundaries stay outside it. */
export function CarbonShell({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const [desktop, setDesktop] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const logoutInFlight = useRef(false);
  const ar = locale === "ar";
  const navLabel = ar ? "التنقل الرئيسي" : "Main navigation";
  const expanded = desktop ? desktopOpen : mobileOpen;
  const groups = buildNavGroups(locale);
  const platformAdmin =
    Boolean(process.env.NEXT_PUBLIC_PLATFORM_ADMIN_EMAIL) &&
    session?.user?.email === process.env.NEXT_PUBLIC_PLATFORM_ADMIN_EMAIL;
  const candidates = groups.flatMap((group) =>
    group.items.map((item) => item.href),
  );
  if (platformAdmin) candidates.push(`/${locale}/platform-admin`);
  // Match complete segments, then choose the deepest route. /customers must
  // not activate /customer-segments; settings and members must not both select.
  const activeHref = candidates
    .filter(
      (href) =>
        pathname === href ||
        (href !== `/${locale}` && pathname.startsWith(`${href}/`)),
    )
    .sort((a, b) => b.length - a.length)[0];
  const segments = pathname.split("/").filter(Boolean).slice(1);
  const pageLabel =
    routeLabels[segments[segments.length - 1]] ??
    (segments.length
      ? ar
        ? "تفاصيل"
        : "Details"
      : ar
        ? "الرئيسية"
        : "Overview");

  useEffect(() => {
    const query = window.matchMedia("(min-width: 66rem)");
    const update = () => {
      setDesktop(query.matches);
      setMobileOpen(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const toggle = () => {
      if (desktop) setDesktopOpen((value) => !value);
      else setMobileOpen((value) => !value);
    };
    window.addEventListener("irth:sidebar-toggle", toggle);
    return () => window.removeEventListener("irth:sidebar-toggle", toggle);
  }, [desktop]);

  async function handleLogout() {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    setSigningOut(true);
    setLogoutError(false);
    try {
      const result = await signOut();
      if (result?.error) throw new Error("Sign out failed");
      router.push(`/${locale}/login`);
      router.refresh();
    } catch {
      setLogoutError(true);
    } finally {
      logoutInFlight.current = false;
      setSigningOut(false);
    }
  }

  const navigation = (
    <SideNav
      id="irth-main-navigation"
      aria-label={navLabel}
      expanded
      isFixedNav
      inert={false}
      addFocusListeners={false}
      addMouseListeners={false}
      className="irth-navigation"
    >
      <div className="irth-navigation__intro">
        <span className="irth-eyebrow">{ar ? "مساحة العمل" : "Workspace"}</span>
        <span className="irth-navigation__title">
          {ar ? "إدارة أعمالك" : "Your operations"}
        </span>
      </div>
      <div className="irth-navigation__scroll">
        <div className="irth-navigation__alerts">
          <AlertPanel locale={locale} />
        </div>
        {groups.map((group, index) => (
          <section
            key={group.label}
            aria-labelledby={`irth-nav-group-${index}`}
          >
            <h2
              id={`irth-nav-group-${index}`}
              className="irth-navigation__group"
            >
              {group.label}
            </h2>
            <SideNavItems isSideNavExpanded>
              {group.items.map((item) => (
                <SideNavLink
                  key={item.href}
                  element={Link}
                  href={item.href}
                  renderIcon={item.icon}
                  isSideNavExpanded
                  isActive={activeHref === item.href}
                  aria-current={activeHref === item.href ? "page" : undefined}
                  onClick={() => setMobileOpen(false)}
                >
                  {item.label}
                </SideNavLink>
              ))}
            </SideNavItems>
          </section>
        ))}
        {platformAdmin && (
          <SideNavItems isSideNavExpanded>
            <SideNavLink
              element={Link}
              href={`/${locale}/platform-admin`}
              renderIcon={Shield}
              isSideNavExpanded
              isActive={activeHref === `/${locale}/platform-admin`}
              aria-current={
                activeHref === `/${locale}/platform-admin` ? "page" : undefined
              }
              onClick={() => setMobileOpen(false)}
            >
              لوحة الأدمن
            </SideNavLink>
          </SideNavItems>
        )}
      </div>
      <div className="irth-navigation__footer">
        <label className="irth-organization">
          <span className="irth-eyebrow">
            {ar ? "المؤسسة" : "Organization"}
          </span>
          <OrgSwitcher />
        </label>
        {session?.user?.email && (
          <bdi className="irth-account">{session.user.email}</bdi>
        )}
        {logoutError && (
          <p role="alert" className="irth-logout-error">
            {ar
              ? "تعذر تسجيل الخروج. حاول مرة أخرى."
              : "Sign out failed. Please try again."}
          </p>
        )}
        <Button
          kind="ghost"
          size="md"
          renderIcon={LogOut}
          disabled={signingOut}
          onClick={handleLogout}
        >
          {signingOut
            ? ar
              ? "جارٍ تسجيل الخروج…"
              : "Signing out…"
            : ar
              ? "تسجيل الخروج"
              : "Sign out"}
        </Button>
      </div>
    </SideNav>
  );

  return (
    <div className="irth-shell" data-navigation-open={desktop && desktopOpen}>
      <div className="irth-carbon-ui">
        <a className="irth-skip-link" href="#irth-main-content">
          {ar ? "انتقل إلى المحتوى" : "Skip to content"}
        </a>
        <Header
          aria-label={ar ? "نظام إرث" : "IRTH OS"}
          className="irth-header"
        >
          <HeaderMenuButton
            id="irth-menu-toggle"
            aria-label={
              expanded
                ? ar
                  ? "إغلاق القائمة"
                  : "Close navigation"
                : ar
                  ? "فتح القائمة"
                  : "Open navigation"
            }
            aria-controls={expanded ? "irth-main-navigation" : undefined}
            aria-expanded={expanded}
            isActive={expanded}
            isCollapsible
            onClick={() =>
              desktop
                ? setDesktopOpen((value) => !value)
                : setMobileOpen((value) => !value)
            }
          />
          <HeaderName
            element={Link}
            href={`/${locale}`}
            prefix=""
            className="irth-brand"
          >
            {ar ? "إرث" : "IRTH"}
            <span className="irth-brand__suffix">OS</span>
          </HeaderName>
          <span className="irth-header__page">{pageLabel}</span>
          <HeaderGlobalBar className="irth-header__actions">
            <button
              type="button"
              className="irth-search"
              aria-label={ar ? "فتح لوحة الأوامر" : "Open command palette"}
              onClick={() =>
                window.dispatchEvent(new CustomEvent("irth:palette"))
              }
            >
              <Search size={18} aria-hidden="true" />
              <span>{ar ? "بحث أو انتقال سريع" : "Search or jump to…"}</span>
              <kbd>Ctrl K</kbd>
            </button>
            <NotificationBell />
          </HeaderGlobalBar>
        </Header>
        {desktop && desktopOpen && navigation}
      </div>
      <Dialog.Root open={!desktop && mobileOpen} onOpenChange={setMobileOpen}>
        <Dialog.Portal>
          <div className="irth-carbon-ui">
            <Dialog.Overlay className="irth-drawer-overlay" />
            <Dialog.Content
              className="irth-drawer"
              aria-describedby={undefined}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                document.getElementById("irth-menu-toggle")?.focus();
              }}
            >
              <div className="irth-drawer__heading">
                <Dialog.Title>{navLabel}</Dialog.Title>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="irth-close"
                    aria-label={ar ? "إغلاق القائمة" : "Close navigation"}
                  >
                    <X size={20} aria-hidden="true" />
                  </button>
                </Dialog.Close>
              </div>
              {navigation}
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog.Root>
      <main
        id="irth-main-content"
        tabIndex={-1}
        className="irth-shell__content"
      >
        <div className="irth-shell__page">{children}</div>
      </main>
    </div>
  );
}
