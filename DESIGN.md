# IRTH OS — Design System

Admin console for Egyptian and Gulf commerce operations. Arabic-first, RTL by
default, English supported through the same components.

Source of truth: `apps/admin/src/app/[locale]/globals.css`. Every value below is
registered as a Tailwind v4 `@theme` token, so `bg-surface`, `text-t2`,
`border-rim1` are real utility classes — not arbitrary values.

---

## 1. Character

**Obsidian and gold.** A near-black operations console lit by a single warm
accent. The interface is dense with numbers — orders, stock counts, variance,
money — so the surface stays quiet and lets figures carry the contrast.

Three rules the system is built on:

1. **One accent.** Gold marks the primary action and nothing else. A screen with
   two gold buttons has a bug.
2. **Status colour is semantic, never decorative.** Emerald, crimson, azure and
   amber appear only when they encode a state.
3. **Elevation is a colour step, not a shadow.** Surfaces get lighter as they
   come forward. Shadows are reserved for genuinely floating layers.

---

## 2. Colour

### Surfaces — dark to light, back to front

| Token | Hex | Use |
|---|---|---|
| `void` | `#020406` | Page void, scrollbar track, text on gold |
| `ink` | `#060a10` | Application background (`<body>`) |
| `surface` | `#0e1622` | Panels, table containers, table headers |
| `card` | `#131e2e` | Cards, inputs, dialogs |
| `raised` | `#182436` | Row hover, popovers, menus, selected state |

### Rims — borders and dividers

| Token | Hex | Use |
|---|---|---|
| `rim1` | `#1a2840` | Default border, table dividers |
| `rim2` | `#223050` | Input border — one step stronger so fields read as editable |
| `rim3` | `#2c3e66` | Scrollbar thumb, emphasis border |

### Text — all four measured against `ink` and `card`

| Token | Hex | On `ink` | On `card` | Use |
|---|---|---|---|---|
| `t1` | `#f0f6ff` | 17.4:1 | 14.7:1 | Headings, figures, primary values |
| `t2` | `#93b0d0` | 8.8:1 | 7.4:1 | Body text, labels, table cells |
| `t3` | `#6d90b0` | 5.9:1 | 5.0:1 | Secondary text, placeholders, captions |
| `t4` | `#263a52` | 1.7:1 | 1.4:1 | **Decorative only** — icons, rules. Never text. |

`t4` fails text contrast by a wide margin and is deliberately kept that way; it
exists for shapes, not words.

### Accent and status

| Token | Hex | Meaning |
|---|---|---|
| `gold` | `#e09000` | Primary action. Pair with `void` text (7.98:1) |
| `gold2` | `#f5a800` | Hover |
| `gold3` | `#ffc340` | Active, focus glow |
| `emerald` | `#00c478` | Success, paid, in stock, approved |
| `crimson` | `#e83838` | Error, failed, cancelled, rejected |
| `azure` | `#2e8fff` | Informational, in transit, links |
| `amber` | `#f5a500` | Warning, pending, low stock, awaiting review |

**Every accent fill carries `void` text.** White on `gold` or `emerald` lands
near 2.3:1; `t1` on `crimson` is 3.8:1. `void` clears 4.5:1 on all four —
gold 7.98:1, emerald 9.6:1, amber 8.8:1, crimson 4.78:1.

Status chips use a tinted background rather than a solid fill:
`bg-{status}/10 text-{status}` on cards, `/15` on darker panels.

---

## 3. Typography

Two Arabic-capable families, loaded through `next/font/google` with
metric-matched fallbacks.

| Role | Family | Token |
|---|---|---|
| Body, UI, tables | IBM Plex Sans Arabic | `font-sans` |
| Headings, display | Cairo | `font-display` |

`font-display` is applied by the global `h1`–`h6` rule. Do not put it on a page
wrapper — that forces the display face onto every table cell and label.

| Step | Size | Weight | Line height |
|---|---|---|---|
| Page title | 30px | 700 | 1.2 |
| Section title | 24px | 700 | 1.3 |
| Card title | 18px | 600 | 1.4 |
| Body | 14px | 400 | 1.75 |
| Label, caption | 12px | 500 | 1.5 |
| Micro (table meta) | 10px | 600, uppercase, wide tracking | 1.4 |

Body line height is 1.75 — Arabic needs the room.

---

## 4. Shape, spacing, motion

- **Radius:** `8px` default (`--radius`). Cards and panels `12px`. Chips and
  badges fully rounded. Inputs and buttons `6px`.
- **Spacing:** 4px scale. Card padding `20-24px`, table cells `12px 16px`,
  form field gap `16px`, section gap `24px`.
- **Motion:** `150-200ms` on colour and opacity only. No transforms on hover —
  they shift layout in dense tables.
- **Focus:** `1px` ring in `gold`, always visible. Never removed.

---

## 5. Direction

The document direction comes from `<html dir>`, set from the locale in
`layout.tsx`. Nothing else sets direction — no CSS `direction` rule, no
per-element `dir` attribute.

Two exceptions where `dir="ltr"` is correct on a single element: order numbers,
SKUs, and monetary figures rendered with Latin digits.

Everything else must mirror: use logical properties and Tailwind's `ms-`/`me-`
/`ps-`/`pe-` rather than `ml-`/`mr-`.

---

## 6. Components

**Button** — Primary is `gold` on `void`. Secondary is `surface` with a `rim1`
border and `t2` text. Ghost is transparent, hovering to `raised`. Destructive is
`crimson` on `t1`. One primary per view.

**Input / Select / Textarea** — `card` background, `rim2` border, `t1` text,
`t3` placeholder. Error state swaps border and ring to `crimson` and puts the
message directly beneath in `crimson` at 12px.

**Card** — `card` background, `rim1` border, `12px` radius, `20px` padding.

**Table** — `surface` container, header on `surface` with a `rim1` bottom
border, rows divided by `rim1`, hover to `raised/50`. Numeric columns are
`ltr` and right-aligned within the RTL layout.

**Status badge** — driven by `lib/statusMaps.ts`, which maps 15 domains
(order, payment, shipment, return, purchase order, stocktaking, …) to a label
and a status colour. Components pass `domain` and `status`; they never pick a
colour themselves.

**Dialog** — `card` panel over a `void/70` scrim, `12px` radius, max width
`425px` for forms.

**Empty state** — `t4` icon at 32px, `t2` heading, `t3` description, optional
primary action.

---

## 7. Layout

Sidebar navigation on the inline-start edge, `surface` background, `rim1`
divider. Section labels at 10px uppercase in `t3`. Active item takes a `gold`
inline-start bar with `t1` text.

Content area on `ink`, `24px` padding, max width `1440px`.

Breakpoints follow Tailwind defaults. The sidebar collapses to a drawer under
`768px`; tables scroll horizontally inside their own container so the page body
never scrolls sideways.

---

## 8. Anti-patterns

Things that have actually gone wrong in this codebase, kept here so they do not
come back:

- **Default Tailwind palette classes.** `bg-gray-50`, `text-red-600`,
  `bg-amber-100` are light-mode values. On this surface they range from washed
  out to invisible. Use tokens.
- **Hardcoded hex in components.** It drifts from the palette immediately and
  cannot be re-themed.
- **White text on gold or emerald.** ~2.3:1. Use `void`.
- **A display font on a page wrapper.** Cairo belongs on headings.
- **`dir` on individual elements.** Only the two numeric exceptions above.
- **Hover transforms.** Colour transitions only.
- **A second primary button.** Demote it to secondary.

---

## 9. Screens

The console covers: dashboard, orders (list, detail, kanban, print), products
and variants, categories, inventory, stocktaking, purchasing, customers,
customer segments, returns, coupons, gift cards, price lists, campaigns,
shipping zones and rates, courier dispatch, ETA e-invoicing, integrations,
notifications, analytics, settings, members, and platform admin.

The recurring shape is: page title with a primary action on the opposite edge,
a row of stat cards, a filter or tab strip, then a dense table with row actions
and pagination.
