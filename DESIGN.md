# IRTH OS — Design System 2.1

Arabic-first, RTL-by-default operations design system for IRTH OS. The system is built for dense commerce workflows — orders, inventory, products, fulfillment, finance, and operational analytics — while keeping IRTH's own visual character.

## 0. System architecture

IRTH OS follows a layered model inspired by mature systems such as IBM Carbon and Microsoft Fluent 2, without copying their visual language:

1. **Primitives** — raw color, spacing, type, radius, motion, breakpoints.
2. **Semantic tokens** — meaning such as `surface.page`, `content.primary`, `action.primary`, `status.warning`.
3. **Components** — reusable UI building blocks with documented states and accessibility behavior.
4. **Patterns** — reusable operational workflows such as command center, resource list/detail, bulk actions, adjustment, approval, audit trail, and search/filter.
5. **Templates** — complete product surfaces such as dashboard, orders, inventory, products, customers, purchasing, fulfillment, returns, analytics, and settings.

Machine-readable token source: `design-system/tokens.json`.
Governance and component contracts: `design-system/README.md`.
Current web implementation: `apps/admin/src/app/[locale]/globals.css`.

---

## 1. Character

**Operational elegance with heritage restraint.** Obsidian is the base, warm gold is the single brand accent, and semantic status colors are reserved for meaning.

### Non-negotiables

1. **One brand accent.** Gold marks primary actions and important brand moments. Do not turn every interactive element gold.
2. **Semantic color only.** Emerald, crimson, azure, and amber communicate state; they are not decoration.
3. **Hierarchy before ornament.** Numbers, labels, status, and next actions should be readable before any visual flourish.
4. **Density is intentional.** Operations users need information density, but never at the expense of legibility or target size.
5. **Heritage is expressed through restraint.** Do not add ornamental Arabic motifs to every component. The brand identity should emerge from typography, spacing, material contrast, and selective gold details.

---

## 2. Color tokens

### Surfaces

| Token | Hex | Use |
|---|---|---|
| `void` | `#020406` | Scrims, deepest background, text on accent fills |
| `ink` | `#060a10` | Application background |
| `surface` | `#0e1622` | Panels, table containers |
| `card` | `#131e2e` | Cards, fields, dialogs |
| `raised` | `#182436` | Hover, selected, popovers |

### Borders

| Token | Hex | Use |
|---|---|---|
| `rim1` | `#1a2840` | Default dividers |
| `rim2` | `#223050` | Editable field borders |
| `rim3` | `#2c3e66` | Emphasis / scrollbar |

### Content

| Token | Hex | Use |
|---|---|---|
| `t1` | `#f0f6ff` | Primary text and figures |
| `t2` | `#93b0d0` | Body and secondary labels |
| `t3` | `#6d90b0` | Captions and tertiary content |
| `t4` | `#263a52` | Decorative only; never primary text |

### Brand and semantic colors

| Token | Hex | Meaning |
|---|---|---|
| `gold` | `#e09000` | Primary action |
| `gold2` | `#f5a800` | Hover |
| `gold3` | `#ffc340` | Active / focus |
| `emerald` | `#00c478` | Success / available |
| `crimson` | `#e83838` | Error / destructive |
| `azure` | `#2e8fff` | Information |
| `amber` | `#f5a500` | Warning / pending / low stock |

Prefer semantic aliases in components rather than raw primitive values.

---

## 3. Typography

- **Body/UI:** IBM Plex Sans Arabic
- **Display/headings:** Cairo
- **Identifiers/numeric data:** IBM Plex Mono where useful

Typography hierarchy:

| Role | Size | Weight | Line height |
|---|---:|---:|---:|
| Page title | 30–36px | 700 | 1.2 |
| Section title | 20–24px | 700 | 1.3 |
| Card title | 16–18px | 600 | 1.4 |
| Body | 14px | 400 | 1.75 |
| Label | 12px | 500 | 1.5 |
| Micro | 10px | 600 | 1.4 |

Arabic copy must remain concise. Never reduce text size merely to make a translated label fit.

---

## 4. Spacing, shape, elevation

- Base spacing unit: **4px**.
- Default control height: **44px**.
- Button heights: 32 / 40 / 48px.
- Default radius: 8px.
- Cards/panels: 12px.
- Pills/badges: fully rounded.
- Elevation is primarily a surface-color change. Shadows are reserved for floating layers.
- Dense tables use 12px vertical / 16px horizontal cell padding.

---

## 5. Direction and responsive behavior

The document direction comes from locale. Use logical CSS properties and Tailwind `ms-*`, `me-*`, `ps-*`, and `pe-*` classes.

Keep LTR only where the data itself has an inherent LTR representation: order numbers, SKUs, URLs, monetary strings, and similar identifiers.

Breakpoints:

- Mobile: `<768px`
- Tablet: `768–1279px`
- Desktop: `>=1280px`
- Wide: `>=1600px`

Mobile is not a shrunk desktop. Tables become scrollable or transform into list/detail patterns; actions remain reachable and touch-safe.

---

## 6. Component contract

Every stable component must define:

- anatomy
- variants
- default / hover / focus / pressed / disabled / loading / error / success states as relevant
- keyboard interaction
- screen-reader semantics
- RTL behavior
- responsive behavior
- content rules
- design-token dependencies
- do / don't guidance

Core components include: Button, Input, Select, Search, Tabs, Badge, Table, Pagination, Dialog, Drawer, Toast, Banner, KPI, Filter Bar, Command Bar, Timeline, Empty State, Loading State, Error State, and Confirmation.

---

## 7. Operational patterns

The system should standardize these workflows instead of allowing every page to invent its own UI:

- **Command Center:** KPI → flow → attention → recent activity.
- **Resource List:** title → primary action → search/filter → dense table/list → pagination.
- **Resource Detail:** identity → primary status → key facts → activity/history → actions.
- **Bulk Action:** selection → contextual action bar → confirmation → result feedback.
- **Adjustment:** current value → proposed change → reason → preview → confirm → audit event.
- **Destructive Action:** explicit consequence → confirmation → pending state → success/error feedback.
- **Audit Trail:** actor → action → timestamp → before/after where applicable.

No visible action should exist unless a real product capability exists behind it.

---

## 8. Accessibility gate

Target: **WCAG 2.2 AA**.

- Text contrast >= 4.5:1.
- Large text >= 3:1.
- Non-text UI boundaries >= 3:1.
- Primary interactive targets >= 44px.
- Visible keyboard focus.
- No color-only status communication.
- Logical screen-reader order.
- Reduced-motion support.
- Zoom/text resizing must not destroy task completion.

Stable components require automated accessibility checks plus manual review for keyboard and advanced/screen-reader states.

---

## 9. Motion

Motion is feedback, not decoration:

- 120ms micro feedback
- 180ms normal transitions
- 240ms drawers/dialogs
- `prefers-reduced-motion` always respected
- no hover transforms in dense operational tables

---

## 10. Content

Arabic is the primary product language. Use direct operational language: what happened, what needs attention, and what the user can do next.

Avoid vague labels such as “Manage”, “Process”, or “Continue” when the actual action can be named precisely.

Error messages should explain the problem and the recovery path.

---

## 11. Governance

A component is **Draft** until anatomy and states are documented.

A component becomes **Stable** only when design, implementation, RTL, responsive behavior, accessibility, empty/loading/error states, and production usage are all verified.

Breaking changes require a migration note. Do not create a parallel token source.

---

## 12. Anti-patterns

- Default Tailwind palette values.
- Hardcoded component hex values.
- White text on gold/emerald fills.
- Display font applied to page wrappers.
- Per-element direction hacks.
- Hover transforms in dense tables.
- Multiple competing primary actions.
- Decorative gradients that reduce data legibility.
- Cards inside cards without a clear information hierarchy.
- Fake actions with no real backend capability.
