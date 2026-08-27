# IRTH OS Design System 2.0

## Product principle
IRTH OS is an operational system with a luxury brand DNA. It must feel calm, precise and architectural without sacrificing information density or speed.

## Three layers
1. **Brand** — editorial, tactile, cinematic and restrained.
2. **OS** — operational, dense, legible and action-oriented.
3. **Platform** — accessibility, responsive behavior, browser/device constraints and system feedback.

## Visual language
- Obsidian canvas with ivory text and muted gold used as a signal, not decoration.
- Warm neutral surfaces and quiet borders instead of cards everywhere.
- Typography is hierarchical: UI sans for operations; editorial serif only for brand moments.
- One focal point per section; whitespace is structural, not empty decoration.
- No gradients, glow, chrome, excessive rounded containers, bounce or ornamental motion.

## UX rules
- Arabic-first and RTL-safe.
- Minimum touch target: 44px by default; 40px in compact desktop density.
- Keyboard focus must remain visible.
- Status must not rely on color alone; pair tone with text/icon/state.
- Operational actions should be reversible where possible and require confirmation for destructive actions.
- Mobile is not a squeezed desktop: prioritize Today, Attention and the next action.
- Tables remain information-dense on desktop and become purposeful horizontal-scroll surfaces on mobile.

## Components
Foundation: Button, Input, Badge, Panel, Divider.
Operational: Metric, Table, Command Bar, Navigation, Timeline.
Next layer: Select, Combobox, Dialog, Drawer, Toast, Empty State, Skeleton, Data Grid, Filter Bar, Date Range, File Upload, Permission Matrix.

## Density
`comfortable` for default workflows, `compact` for high-volume operations. Density changes spacing and touch targets without changing semantic hierarchy.

## Motion
Use 120ms for immediate feedback, 180ms for component transitions, and 280ms for larger reveals. Respect `prefers-reduced-motion`.
