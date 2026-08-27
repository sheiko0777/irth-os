# IRTH OS Design System 2.1

IRTH OS is an Arabic-first, RTL operations system for commerce. The design system is intentionally **not a visual clone** of Carbon, Fluent, Apple HIG, Material, Polaris, Atlassian, Lightning, or Stripe. It borrows proven system architecture and keeps IRTH's own character: obsidian, warm gold, editorial Arabic typography, dense operational data, and heritage-grade restraint.

## What we adopt from mature systems

- **IBM Carbon:** explicit component taxonomy, accessibility status, data-table rigor, and repeatable component behavior.
- **Microsoft Fluent 2:** two-layer tokens — primitive/global values plus semantic/alias values — and platform-aware theming.
- **Apple HIG:** purpose, agency, familiarity, flexibility, simplicity, craft, clear feedback, recovery, and accessibility as product principles.
- **Atlassian:** foundations as a single source of truth for tokens, spacing, typography, color, grid, iconography, elevation, border, and radius.
- **Shopify Polaris:** consistent cross-surface components and native-feeling operational patterns.
- **Stripe/Sail direction:** system foundations should support a high-scale dashboard rather than becoming a decorative component library. Stripe publicly describes Sail as the platform team building foundations for Dashboard and other interfaces.

## IRTH architecture

### Layer 01 — Primitives

Raw colors, spacing, radius, type families, motion, and breakpoints. Primitives are rarely used directly in product screens.

### Layer 02 — Semantic tokens

Meaningful roles such as `surface.page`, `content.primary`, `action.primary`, `status.warning`, and `border.focus`. Product code should prefer semantic tokens.

### Layer 03 — Components

Buttons, inputs, selects, search, tabs, badges, tables, pagination, dialogs, drawers, toasts, banners, KPI cards, command bars, filters, timelines, empty states, loading states, and error states.

### Layer 04 — Patterns

Reusable operational workflows: command center, resource list, resource detail, bulk action, adjustment, approval, audit trail, search/filter, import/export, and destructive confirmation.

### Layer 05 — Templates

Dashboard, orders, order detail, inventory, products, customers, purchasing, fulfillment, returns, analytics, settings, and mobile operational surfaces.

## Component contract

Every interactive component must document:

1. Anatomy
2. Variants
3. States: default, hover, focus, pressed, disabled, loading, error, success where relevant
4. Keyboard behavior
5. Screen-reader semantics
6. RTL behavior
7. Responsive behavior
8. Content rules
9. Do / don't examples
10. Design token dependencies

## Accessibility gate

IRTH targets **WCAG 2.2 AA**. Accessibility is a release requirement, not a later polish pass.

- Text contrast >= 4.5:1
- Large text >= 3:1
- Non-text UI boundaries >= 3:1
- 44px minimum touch target for primary interactive controls
- Visible keyboard focus
- No color-only status communication
- Reduced-motion support
- Logical RTL reading and focus order
- Numeric identifiers and money can remain LTR inside RTL layouts

Every stable component should have automated accessibility checks plus manual keyboard/screen-reader review for advanced states.

## Density model

IRTH is an operations product, so density is intentional.

- **Comfort:** dashboards, forms, onboarding
- **Standard:** default lists and detail pages
- **Dense:** orders, inventory, audit logs, analytics tables

Density changes spacing, not hierarchy. Typography and interaction targets remain accessible.

## Content model

Arabic is the primary product language. Labels should be short, direct, and action-oriented. English is supported without creating a separate visual system.

Never translate UI word-for-word when the result becomes unnatural Arabic. Preserve the user's mental model and the operational meaning.

## Motion

Motion communicates state and hierarchy, never decoration.

- 120ms: micro feedback
- 180ms: normal transitions
- 240ms: drawers/dialogs
- Respect `prefers-reduced-motion`
- Avoid hover transforms in dense tables

## Theming

Dark is the primary IRTH OS theme. The token architecture supports a future light theme and high-contrast theme without changing component APIs.

Theme changes must happen through semantic tokens, never by replacing arbitrary component colors.

## Governance

A component is **Draft** until its anatomy and states are documented.

A component is **Stable** only after:

- design spec exists
- implementation exists
- responsive behavior exists
- RTL behavior is verified
- accessibility checks pass
- empty/loading/error states are defined
- usage guidance exists
- at least one production surface consumes it

Breaking changes require a token/component migration note.

## Source of truth

- `design-system/tokens.json` — machine-readable token contract
- `DESIGN.md` — repository-level design rules
- `apps/admin/src/app/[locale]/globals.css` — current web token implementation

Do not introduce a second token source without an explicit migration plan.
