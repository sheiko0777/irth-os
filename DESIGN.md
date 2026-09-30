# IRTH OS — Design System

Admin console, delivery-rep screens and supplier portal for Egyptian commerce
operations. Arabic-first, RTL by default, English through the same components.

Direction (owner decision, PR-UI): **calm navy + glass**. A softly lit light
canvas, translucent white cards, one navy hero figure per screen, large money
figures. Dark mode is a first-class pair, not an inversion.

Every value below lives in `apps/admin/src/app/[locale]/globals.css`. Components
use tokens, never raw hex. `src/__tests__/ui/themeTokens.test.ts` pins the
semantic palette and fails on any `var(--x)` that globals.css does not define.

## 1. Colour

### Semantic tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--canvas` | `#EEF2F8` | `#0B1220` | Page background (under the glow) |
| `--surface` | `#FFFFFF` | `#131C2E` | Opaque surfaces: inputs, popovers, dense tables |
| `--raised` | `#F2F5FA` | `#1B2640` | Table heads, tracks, quiet chips |
| `--text-primary` | `#0F1B33` | `#EEF2FA` | Body and figures |
| `--text-secondary` | `#536179` | `#A3B1C9` | Labels, captions |
| `--accent` | `#1F3B7A` | `#8FB0F5` | Primary action, active nav, chart line |
| `--accent-fg` | `#FFFFFF` | `#0B1220` | Text on accent |
| `--input-border` | `#8391A8` | `#5F6F8C` | Form control borders (3:1) |
| `--separator` | `#DDE4EF` | `#26324A` | Dividers, card rims |
| `--success` / `-bg` | `#166534` / `#ECFDF3` | `#6EE7A0` / `#0F2A1E` | |
| `--warning` / `-bg` | `#92400E` / `#FFF7E6` | `#FBBF5A` / `#2C2111` | |
| `--critical` / `-bg` | `#B42318` / `#FEF3F2` | `#FCA5A5` / `#331A1F` | |
| `--info` / `-bg` | `#1D4ED8` / `#EEF4FF` | `#93C5FD` / `#14233D` | |

Measured contrast (WCAG): primary text 15.3:1 light and 16.7:1 dark; secondary
text at least 5.6:1 on every surface; accent on white 10.7:1; every status
colour on its own background at least 6:1; input borders at least 3.2:1.

### Glass system

- `--glass`, `--glass-strong`, `--glass-border`: the translucent card. Use the
  `.glass` class. It blurs where `backdrop-filter` exists and is near-opaque
  where it does not, so text never sits on an unreadable surface.
- `--card-shadow`, `--float-shadow`: two elevations only. Cards rest; menus,
  hovered cards and the tab bar float.
- `--hero-from` / `--hero-to` / `--hero-fg` / `--hero-muted`: the navy hero.
  Use the `.surface-hero` class.
- `--accent-soft`, `--accent-strong`: icon tiles, hovers, and the pressed or
  hovered primary.
- `--canvas-glow-a` / `-b`: the two radial glows painted on `body`.

Legacy aliases (`--t1..4`, `--rim*`, `--gold*`, `--card-bg`...) still resolve to
semantic tokens, so older pages follow the palette. New code uses semantic names.

## 2. Typography

- IBM Plex Sans Arabic + IBM Plex Sans, weights 400/500/600.
- Page title 1.5–1.75rem/600. Section title 0.875–1rem/600. Labels 0.75–0.875rem/500.
- Figures use `tabular-nums`. Money is always `<Money>`: `ج.م`, Latin digits, LTR
  isolated. Pass `emphasis` for headline figures: pounds full weight, piastres and
  currency muted. That is presentation only; the value is formatMoney's string.
- Headings take their colour from the base layer, so a utility on a heading wins.

## 3. Shape, spacing, motion

- `--card-radius` 18px (cards), `--control-radius` 12px (buttons, inputs, chips).
  Hero balance cards use radius + 6px.
- 4/8px rhythm. Card padding 20px (16px on phones). Grid gaps 16px, sections 24px.
- Controls are at least 44px tall; phone actions 44–56px.
- Motion runs 150–300ms and animates colour, shadow and opacity only. Press is
  `scale(0.98)` on buttons. The page entrance is `.rise`, staggered about 90ms.
  All motion stops under `prefers-reduced-motion`.

## 4. Direction

- Logical properties only (`ms-`, `pe-`, `start`, `inset-inline`).
- Sidebar at inline-start: right in Arabic, left in English.
- Order numbers, SKUs, money and percentages are LTR-isolated (`dir="ltr"` / `<bdi>`).
- Time axes run oldest → newest left to right, the convention for charts in
  Arabic finance UIs too.

## 5. Components (`apps/admin/src/components`)

| Component | Notes |
| --- | --- |
| Shell (`layout/CarbonShell`, `styles/carbon.scss`) | Floating glass header and sidebar. Carbon `--cds-*` tokens are remapped onto the palette. The active link is a navy pill; icons sit in soft tiles. Below 66rem the sidebar is a drawer. |
| `ui/card` | `variant="glass"` (default), `"solid"` for dense forms and tables, `"hero"`. |
| `ui/PageHeader` | Title card for list screens: eyebrow, title, one-line purpose, icon tile, actions. |
| `ui/KpiCard` | Icon tile + title + drill arrow, big figure, trend pill, sparkline. `variant="hero"` once per screen. |
| `ui/StatBox` | The smaller label-over-figure tile. |
| `ui/FilterTabs` | URL-backed segmented chips; the active chip is a navy pill. |
| `ui/StatusBadge` | Soft pill with a dot: status is never colour alone. |
| `ui/table` | Quiet tinted head, accent-soft row hover. |
| `ui/EmptyState` | Accent icon tile, one-line hint, and a primary action where one exists. |
| `charts/AreaChart` | Server-rendered SVG: smooth line, soft fill, 3 grid lines, latest point marked, native tooltips, and an sr-only list of values. |
| `charts/BarChart`, `charts/Sparkline` | Same accent; bars highlight the latest period. |
| `mobile/BalanceCard` | The phone screen's headline figure on the navy hero surface. |
| `mobile/MobileTabBar` | Phone-only (below md) floating bottom bar, 2–4 items, icon + label, follows the section in view. Pages that use it add `.pb-tabbar`; the chat launcher rises above it. |

## 6. Screens

- **Home:** greeting, KPI row (net sales from the ledger is the hero), 7-day orders
  trend, order-state track, recent orders.
- **Lists** (orders, inventory, products): `PageHeader`, then filter chips, then a
  glass table card.
- **Finance and analytics:** `PageHeader`, KPI cards with icons, glass chart cards.
- **Sales rep** (`/sales`, phone-first): PageHeader, new-sale form, order and quote lists as glass cards, and a tab bar (new, orders, quotes).
- **Delivery rep** (`/rep`, phone-first): custody `BalanceCard` with the handover
  form inside, large order cards with full-width deliver and call actions, and a
  tab bar (orders and custody).
- **Supplier portal** (`/portal`, phone-first): a glass header, a "الباقي لك"
  `BalanceCard` over received and paid, PO cards, and a tab bar.
- **Supplier PO detail** (`/portal/orders/[id]`, phone-first): a navy PO card
  (total, status, delivery date), an answer card (confirm or propose a date), one
  card per line with ordered/shipped/received tiles, a shipped-progress bar and the
  quantity to ship, then the shipping notice and a notice timeline.
- **Every other admin screen** opens with `PageHeader` (the nav group as eyebrow,
  the nav icon) and uses glass cards. The primary action is the navy button.
- **Sign-in:** a navy mark and a glass card over the lit canvas.

## 7. Anti-patterns

- Two heroes on one screen, or a hero for a figure that is not the point of it.
- Raw hex or `rgba()` in components; Tailwind palette classes (`bg-red-500`).
- Emoji as icons. Use lucide, one stroke style.
- Status by colour alone. Pair it with a dot, icon or label.
- Translucent surfaces behind body text without the `.glass` fallback.
- Animating width, height or position. Transforms that make dense rows twitch.
- Money through `Number()` or float arithmetic for display. Render `bigint` minor
  units through `<Money>`.

## 8. Verification

- `pnpm --filter @irth/admin test`: `themeTokens` (palette and undefined variables),
  `CarbonShell` (navigation, drawer focus trap, RTL), money and states.
- Playwright smoke (`pnpm --filter @irth/admin test:e2e`) selects by role, label,
  Arabic text and `data-testid`, never by class, so restyles keep it green.
