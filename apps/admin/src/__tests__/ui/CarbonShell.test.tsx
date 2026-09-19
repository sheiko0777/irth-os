import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ImgHTMLAttributes } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header as LegacyHeader } from '@/components/layout/Header';
import { CarbonShell } from '@/components/layout/CarbonShell';
import { buildNavGroups } from '@/lib/navigation';

const state = vi.hoisted(() => ({
  pathname: '/ar/orders',
  email: 'member@example.test',
  push: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: state.push, refresh: state.refresh }),
}));
vi.mock('next/image', () => ({
  default: ({ priority: _priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { email: state.email } } }),
  signOut: state.signOut,
}));
vi.mock('@/components/layout/AlertPanel', () => ({ AlertPanel: () => <div>Operational alerts</div> }));
vi.mock('@/components/layout/OrgSwitcher', () => ({ OrgSwitcher: () => <div>Organization switcher</div> }));
vi.mock('@/components/layout/NotificationBell', () => ({ NotificationBell: () => <button>Notifications</button> }));

function media(desktop: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: desktop, media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  state.pathname = '/ar/orders';
  state.email = 'member@example.test';
  state.signOut.mockResolvedValue({});
  vi.stubEnv('NEXT_PUBLIC_PLATFORM_ADMIN_EMAIL', 'owner@example.test');
  media(false);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// Kept alongside the new shell to make the pre-migration behavior explicit.
describe('legacy shell characterization', () => {
  it('opens the shared navigation and preserves organization tools', () => {
    render(<Sidebar locale="ar" />);
    act(() => window.dispatchEvent(new CustomEvent('irth:sidebar-toggle')));
    for (const item of buildNavGroups('ar').flatMap((group) => group.items)) {
      expect(screen.getByRole('link', { name: item.label }).getAttribute('href')).toBe(item.href);
    }
    expect(screen.getByText('Organization switcher')).toBeTruthy();
    expect(screen.getByText('Operational alerts')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'لوحة الأدمن' })).toBeNull();
  });
  it('opens the existing command palette event', async () => {
    const listener = vi.fn();
    window.addEventListener('irth:palette', listener);
    render(<LegacyHeader locale="ar" />);
    await userEvent.click(screen.getAllByRole('button', { name: 'فتح لوحة الأوامر' })[0]);
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener('irth:palette', listener);
  });
});

function mount(locale = 'ar') {
  return render(<CarbonShell locale={locale}><h1>Existing page</h1></CarbonShell>);
}

describe('Carbon review shell', () => {
  it('preserves all destinations and embedded tools on desktop', () => {
    media(true);
    mount();
    for (const item of buildNavGroups('ar').flatMap((group) => group.items)) {
      expect(screen.getByRole('link', { name: item.label }).getAttribute('href')).toBe(item.href);
    }
    expect(screen.getByText('Organization switcher')).toBeTruthy();
    expect(screen.getByText('Operational alerts')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Existing page' })).toBeTruthy();
  });
  it('selects the most specific matching route', () => {
    media(true);
    state.pathname = '/ar/settings/members';
    mount();
    expect(screen.getByRole('link', { name: 'الأعضاء' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'الإعدادات' }).getAttribute('aria-current')).toBeNull();
  });
  it('opens a modal mobile drawer and restores focus on Escape', async () => {
    mount();
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'فتح القائمة' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'التنقل الرئيسي' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('keeps keyboard focus inside the mobile drawer', async () => {
    mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'فتح القائمة' }));
    const dialog = screen.getByRole('dialog');
    const focusable = dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]');
    focusable[focusable.length - 1].focus();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
  it('preserves platform admin visibility rules', () => {
    media(true);
    const view = mount();
    expect(screen.queryByRole('link', { name: 'لوحة الأدمن' })).toBeNull();
    state.email = 'owner@example.test';
    view.rerender(<CarbonShell locale="ar"><h1>Existing page</h1></CarbonShell>);
    expect(screen.getByRole('link', { name: 'لوحة الأدمن' }).getAttribute('href')).toBe('/ar/platform-admin');
  });
  it('uses the existing palette event', async () => {
    const listener = vi.fn();
    window.addEventListener('irth:palette', listener);
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'فتح لوحة الأوامر' }));
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener('irth:palette', listener);
  });
  it('preserves logout redirect and session refresh', async () => {
    media(true);
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'تسجيل الخروج' }));
    expect(state.signOut).toHaveBeenCalledOnce();
    expect(state.push).toHaveBeenCalledWith('/ar/login');
    expect(state.refresh).toHaveBeenCalledOnce();
  });
  it('reports logout failure without navigating away', async () => {
    media(true);
    state.signOut.mockRejectedValueOnce(new Error('offline'));
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'تسجيل الخروج' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(state.push).not.toHaveBeenCalled();
  });
  it('keeps English locale URLs and does not override document direction', () => {
    media(true);
    state.pathname = '/en/orders';
    const { container } = mount('en');
    expect(screen.getByRole('link', { name: 'الطلبات' }).getAttribute('href')).toBe('/en/orders');
    expect(container.querySelector('[dir="rtl"]')).toBeNull();
  });
});
