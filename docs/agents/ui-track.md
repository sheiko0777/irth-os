<!-- UI-00 output: codex gpt-6-astra, read-only run 2026-09-23 (thread 01a0d032-bf01-78a3-b15a-ea3d3c8a8b8a), from docs/delivery/briefs/astra-ui-brief.md. Owner decisions: remove Carbon, no Chatwoot/Metabase/n8n, real Shopify data. UI packets UI-01..UI-26 below are issued to the ui lane (agy) with Stitch references. -->

# IRTH OS admin: UI architecture and delivery specification

**Decision:** retain Next.js, Tailwind, shadcn/Radix, tRPC, and the financial kernel. Remove Carbon. Build a warm, precise, mobile-first working interface whose first proof is the owner’s real Shopify order, including every item, buyer, address, money explanation, and import failure.

This is a read-only source audit and proposed implementation specification. No files were changed or runtime tests executed. Repository observations below are distinguished from required future contracts.

## 1. Audit of `apps/admin`

The repository contains a usable frontend foundation and an inadequate operational read model. Rebuilding the entire frontend would discard working localization, validation, authentication integration, and money handling without solving the order problem.

| Area | Observed in source | Decision |
|---|---|---|
| Runtime | Next **15.5.25**, React **19.0.0**, App Router; server pages with client interaction islands | Keep. No framework migration in S1. |
| Shell | `CarbonShell.tsx`, Carbon React **1.90.0**, Carbon styles **1.89.0**, scoped g100 Sass; dashboard layout also mounts command palette and chatbot | Remove Carbon and its Sass. Preserve useful navigation, logout, skip-link, and focus-return behavior. Remove the persistent chatbot from the operational shell. |
| Styling | Tailwind **4.0.0**, PostCSS plugin range **4.3.x**; semantic aliases plus duplicated navy/gold variables | Keep Tailwind; reconcile package versions and replace token definitions. Migrate legacy aliases through one temporary compatibility layer. |
| Primitives | Existing button/input/table/dialog primitives; `ConfirmDialog` uses the shared dialog | Keep and normalize. Do not regenerate the whole shadcn directory. |
| Forms | React Hook Form, Zod, several product forms already integrated | Keep validation patterns. Replace modal presentation and inconsistent error behavior. |
| `FormDialog` | Custom overlay with `role="dialog"` but no visible focus trap, Escape handling, or focus restoration | Replace its implementation with Radix Dialog while preserving callers initially. |
| `ConfirmDialog` | Closes immediately after calling `onConfirm` | Fix: await success; retain input and show failure inside the dialog. |
| Tables | Native tables, URL search/status/page, pagination and selection; order table scrolls horizontally on phones | Reuse semantics and URL state. Introduce a shared table controller and deliberate mobile summaries. |
| Statistics | `KpiCard`, `StatBox`, `PipelineBar`; KPI includes 10px labels, gradient hero, sparkline | Retain useful props and drill-through behavior. Rebuild typography and layout. Remove the gold hero treatment. |
| Charts | Hand-written `BarChart` and `Sparkline`; limited labeling and accessibility | Retire the report chart implementations. Keep no second chart system. |
| Testing | Vitest, Testing Library, jsdom and `vitest.ui.config.ts` already exist | Extend these; add Playwright. Component testing is not a greenfield requirement. |
| Mobile | Expo 52, React Native 0.76, React 18; tab navigation, refreshable lists, validated API responses, 401 reset | Salvage interaction requirements and response validation. Delete native implementation on the planned backend/delivery lane. |
| Installability | `app/manifest.ts` and Apple standalone metadata already exist; no service-worker registration found in inspected source | Salvage metadata. Treat install/offline/update behavior as unimplemented until tested. |

The concrete order defect is visible in [the detail page](../../apps/admin/src/app/[locale]/(dashboard)/orders/[id]/page.tsx): status editing, SKU/quantity/price, and shipment history occupy the workspace. Buyer, addresses, full pricing, payment transactions, returns, and import evidence are absent. The list’s `OrderRow` similarly carries only ID, number, status, total, and creation date. A fetch error becomes an empty list; a detail error becomes “not found.” Both conceal operational failures.

The [OR delivery contract](../../docs/delivery/packets/OR.md:170) already specifies `orders.getWorkspace` and one `OrderView` for accepted orders and candidates. **Adopt that contract exactly; do not invent a competing frontend order model.**

RTL has a sound starting point: locale-driven `<html dir>`, next-intl routing, logical alignment in places, and isolated order identifiers. Remaining weaknesses include hard-coded Arabic navigation, default-Arabic 2FA redirects, direct `ar-EG` digit formatting, and untranslated status maps. The owner-supplied counts of literals and token bypasses are migration scope, not independently recounted findings.

**Data-layer verdict:** keep tRPC 11 inside the admin. Server pages use `serverCaller`; client mutations use the existing Query integration and SuperJSON. Extract business behavior into the agreed shared operations, with thin tRPC adapters. Public REST/OpenAPI later exposes the approved subset through Hono using the same validation and operations. A REST rewrite before the real order works would add transport work without business value.

Auth UX needs explicit repair. The locale layout fetches a session but does not use the result; home performs another check. The TOTP page always trusts the device, discards Arabic-Indic input, returns to home, and exposes no backup-code form. Follow the existing CX plan for one Better Auth authority; UI agents must not modify auth configuration. Add locale-preserving return paths, deliberate trusted-device choice, enrollment, backup-code recovery, session-expiry handling, and a distinguishable authentication-service error. Backup codes must use the library’s verification operation, not an invented password convention. [Better Auth 2FA documentation](https://better-auth.com/docs/plugins/2fa)

## 2. UI stack decision

Versions below distinguish existing manifest versions from selected major lines. The dependency integration packet must pin compatible patch versions and regenerate the lockfile; UI agents do not edit it.

| Concern | Selected stack | Rationale |
|---|---|---|
| Framework | Next **15.5.25**, React **19.0.0** initially | Preserve the deployed App Router architecture; maintenance/security updates remain separate controlled work. [Next 15 docs](https://nextjs.org/docs/15/app/getting-started/deploying) |
| Styling | Tailwind **4.x**, matching `@tailwindcss/postcss`; `tailwind-merge` **3.x** | One CSS token source, logical utilities, no Carbon/Sass dependency. Support floor: Safari 16.4, Chrome 111, Firefox 128. [Tailwind upgrade guide](https://tailwindcss.com/docs/upgrade-guide) |
| Components | Existing shadcn source + Radix Dialog **1.1.x**, Select **2.2.x**, Direction **1.1.x** | Owned code and accessible primitives; no new visual component library. shadcn supports Tailwind 4/React 19. [shadcn guidance](https://ui.shadcn.com/docs/tailwind-v4) |
| Reports | Recharts **3.x**, lazy-loaded named imports | MIT, React/SVG, adequate for seven graphical report families; cohorts use a semantic HTML heatmap. RTL is configured and tested explicitly. [Recharts](https://recharts.github.io/en-US/guide/installation/) |
| Tables | TanStack Table **8.x**; Virtual **3.x** only when measured necessary | Headless control over RTL, density and mobile representations. Default to server pagination, 50 rows. [Table](https://tanstack.com/table/v8/docs/introduction), [Virtual](https://tanstack.com/virtual/latest/docs/introduction) |
| Forms | Existing RHF **7.76.x**, resolvers **5.2.x**, Zod **4.4.x** | Shared schemas, bounded text, field errors and server validation. |
| Data | Existing tRPC **11.13.x**, TanStack Query **5.100.x**, SuperJSON **2.2.x** | Preserve typed calls and bigint serialization. |
| Localization | Existing next-intl **3.22.x**; native `Intl` | No localization-library migration. |
| Icons | Existing Lucide **0.300.x** initially | One stroke family; named imports; no icon-font download. |
| Tests | Playwright Test **1.x**, existing Vitest **3.2.x**, Testing Library **16.x**, axe-core **4.x** | Browser workflows plus focused component behavior. Keep Vitest rather than adding Playwright’s experimental component runner. [Playwright component-test status](https://playwright.dev/docs/test-components) |

**Formatting policy:** use Western digits `0–9` everywhere in both languages: money, quantities, dates, telephone numbers, charts and exports. Set `numberingSystem: "latn"` explicitly. Accept and normalize Arabic-Indic digits in inputs. Arabic EGP displays `ج.م`; English displays `EGP`. Other currencies receive unambiguous ISO labels where symbols collide.

Money remains integer minor units with an explicit currency. Extend the existing domain formatter; never convert arbitrary bigint totals through `Number(amount) / 100`. Display server-calculated totals and FX snapshots. Use Gregorian dates, `Africa/Cairo` for operational reporting, localized month names, and explicit timezone labels in audit/evidence views. Lot expiry is a date-only value, never shifted through a timezone.

**Fetching convention:** server-render the initial meaningful screen; hydrate interactive islands only where needed. Query keys include authenticated organization, entity/brand/warehouse scope and filters. On logout or membership change, clear cached data. Scope changes cancel obsolete requests and cannot briefly display the previous scope’s results.

Use URL state for filters, sorting, page and selected view; React state for sheets and transient input; Query for server data. Do not introduce Redux. Mutations carry the server’s revision plus an idempotency key; money, stock, approvals and booking never use optimistic success. After a timeout, check operation status before retrying with the same key.

**PWA:** extend the existing manifest and icons using Next’s supported metadata conventions. Cache only public static assets and a neutral offline page; authenticated HTML, API responses, evidence, and PII remain network-only. No background stock or payment mutation queue. Show “Connection lost; action not submitted,” then revalidate on reconnect. Installation help is dismissible; iOS receives accurate Add to Home Screen instructions. Test safe areas, standalone launches, expired sessions and update prompts on physical devices. [Next PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps)

## 3. Information architecture

Use one route registry containing translation keys, permission requirements, role placement, icon, search keywords and destination. Desktop navigation, mobile tabs, breadcrumbs and command search consume it. A shell changes emphasis by role; it never grants authorization.

Desktop has a 240px logical-start sidebar: **Today; Orders; Stock & Products; Money; Reports; Administration**. Customers sit under Orders; procurement under Stock; approvals remain globally reachable with a count. Inbox and integrations live inside this admin. Future destinations appear only when functional and authorized.

| Role shell | Home | Phone destinations | Desktop emphasis |
|---|---|---|---|
| Owner/admin | Exceptions → today’s work → money awaiting movement | Today, Orders, Money, More | Group comparison, approvals, connection failures |
| Accountant | Close checklist → unposted documents → reconciliation | Close, Reconcile, Approvals, More | Dense worklists, period/entity context, keyboard navigation |
| Ops/warehouse | Assigned pick/pack/ship queues; shortages first | Queue, Orders, Stock, More | Warehouse scope and batch progress |
| POS cashier | Active sale, cart, tender, receipt | Sale, Receipts, More | Tablet split view; online-only; explicit operator switch |
| Supplier | POs awaiting acknowledgement and expected deliveries | POs, Deliveries, Account | Separate portal routes and whitelisted DTOs |

POS is a workspace for an authorized fixed template, not a new permission-design system. Supplier navigation cannot expose internal search, margins, other suppliers, or organizational administration.

Below 768px, use labeled bottom tabs. At 768–1199px, use a compact rail; at 1200px, expand the sidebar. Tabs represent destinations, never “Create,” “Scan,” or “Approve.” Their positions remain stable when counts are zero. This follows the navigation/action distinction in [Apple’s tab-bar guidance](https://developer.apple.com/design/human-interface-guidelines/tab-bars) and the compact navigation pattern in [Material 3](https://m3.material.io/components/navigation-bar/overview).

Short filters and confirmations use bottom sheets; multi-step editing and evidence use full-height surfaces. The primary action sits above bottom navigation, within the safe area; secondary actions use a labeled overflow menu. It must remain reachable with the software keyboard open and must not obscure validation messages.

The scope control displays **organization → legal entity → brand → warehouse**, including “All permitted” where meaningful. Legal owner and physical location are separate dimensions. Group financial scope is read-only; mutations state the specific legal entity. A brand change invalidates incompatible warehouse selections visibly.

Search accepts order number, buyer contact, SKU, barcode and shipment tracking. Results are grouped, permission-filtered and scope-labeled. Command palette supports Ctrl/Cmd+K plus a touch button. Notifications link to actionable records and deduplicate repeated integration incidents; notifications are not the authoritative approvals inbox.

## 4. Design system specification

The visual base is warm white and graphite with one bronze accent. Light mode is the primary design target for warehouse daylight and eight-hour accounting use; dark mode is equally supported. Default to system preference, persist an explicit override, and apply the choice before paint.

Define semantic CSS variables once, expose them through Tailwind `@theme inline`, and use `data-theme`. Legacy names temporarily alias these values. New feature code may not introduce palette classes, hex literals, or arbitrary color variables.

Contrast ratios below are calculated for the stated foreground/background pair, rounded to two decimals.

| Token/use | Light | Dark | Contrast |
|---|---|---|---|
| Canvas / surface / raised | `#F6F5F2` / `#FFFFFF` / `#EFEEE9` | `#191917` / `#23221F` / `#2D2B27` | Background hierarchy |
| Primary text on surface | `#252420` | `#F3F1EC` | 15.53 / 14.09 |
| Secondary text on surface | `#65615A` | `#B8B2A8` | 6.16 / 7.55 |
| Accent on surface | `#76502C` | `#D2AC80` | 7.11 / 7.54 |
| Accent button foreground | White on `#76502C` | `#23221F` on `#D2AC80` | 7.11 / 7.54 |
| Input boundary on surface | `#8C867D` | `#898277` | 3.61 / 4.18 |
| Decorative separator | `#DDDAD3` | `#454139` | Not an input boundary |
| Success foreground/background | `#166534` / `#F0FDF4` | `#86EFAC` / `#14291D` | 6.81 / 10.96 |
| Warning foreground/background | `#854D0E` / `#FEFCE8` | `#FDE047` / `#302A13` | 6.62 / 10.86 |
| Critical foreground/background | `#991B1B` / `#FEF2F2` | `#FCA5A5` / `#351C1C` | 7.60 / 8.29 |
| Info foreground/background | `#1E40AF` / `#EFF6FF` | `#93C5FD` / `#1B273A` | 8.01 / 8.33 |

Accent means interaction or selection. It never means revenue, warning, paid, or a particular brand. Semantic colors always accompany text and an icon; multiple critical states remain distinguishable by their labels.

| Vocabulary | Treatment |
|---|---|
| `loaded` | Success/check; successfully fetched empty collections say “No refunds,” etc. |
| `not_applicable` | Neutral/minus; state why |
| `not_exposed_by_provider` | Info/provider icon; explain limitation |
| `permission_denied` | Critical/lock; name missing permission and corrective action |
| `fetch_failed` | Critical/retry; timestamp, error reference, retry action |
| Import blocked | Critical/stop banner; blocker count and next action |
| Held | Warning/pause; actor and reason |
| Reserved | Info/package-check; quantity and reservation reference |
| Released lot | Success/check |
| Quarantined | Warning/shield; reason and inspection state |
| Expired / recalled | Critical/calendar / critical/recall; never pickable |

**Typography:** use Google Fonts’ **IBM Plex Sans Arabic** and **IBM Plex Sans**, self-hosted by `next/font`, weights 400/500/600. Remove Cairo as a second display voice. This is a design choice for consistent Arabic/Latin proportions, clear small text and restrained headings; verify actual Arabic strings and numeral metrics before accepting font subsets. [Arabic family](https://fonts.google.com/specimen/IBM+Plex+Sans+Arabic), [Latin family](https://fonts.google.com/specimen/IBM+Plex+Sans)

| Role | Size / line-height |
|---|---|
| Page title | 24/34px, 600 |
| Section title | 18/28px, 600 |
| Body and inputs | 16/26px |
| Table and controls | 14/22px |
| Metadata | 12/20px; never essential instructions |
| Financial emphasis | 28/36px, tabular numerals |

Use 4/8/12/16/24/32/48px spacing; 6px control radius, 8px surface radius, pill radius only for statuses. Borders organize ordinary surfaces. Shadows are reserved for overlays. Comfortable rows are at least 48px; compact accountant rows may be 36px for passive data, but interactive rows expand to preserve 44px targets. Density is a user preference, not smaller Arabic typography.

Motion lasts 120–180ms and explains opening, closing or state change. Remove staggered entrances, animated counters and looping chart transitions. Reduced motion disables movement and smooth scrolling.

RTL uses logical padding, margin, inset and text alignment. Mirror back/forward, breadcrumb and directional navigation chevrons; do not mirror search, checkmarks, clocks, charts, barcodes, logos or telephone symbols. Use `<bdi dir="auto">` for imported names and notes; isolate phone numbers, email, SKUs, tracking numbers and numeric runs LTR. Keep currency labels independently localized. Radix receives the locale through its [Direction Provider](https://www.radix-ui.com/primitives/docs/utilities/direction-provider); follow [W3C bidi markup guidance](https://www.w3.org/International/questions/qa-html-dir).

Target **WCAG 2.2 AA**, with 44×44px product targets—stricter than AA’s minimum target-size criterion. Require visible 2px focus outlines with offset, unobscured focus beneath sticky bars, keyboard operation, error summaries, paste/password-manager support, and no color-only meaning. Test reflow at 320 CSS pixels and zoom. [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

Performance acceptance: p75 **LCP ≤2.5s, INP ≤200ms, CLS ≤0.1** on representative mid-range Android/4G sessions. Lab checks use a recorded device/network profile. Initial Order Workspace JavaScript budget is 220KiB gzip; reports may lazy-load an additional 180KiB. Keep charts, camera decoding and raw evidence out of the initial order bundle. These are budgets to measure, not claims about current performance.

## 5. Component inventory

All components accept stable test IDs, localized labels and accessible names. Feature components consume DTOs; they do not import database rows.

| Component | Purpose / high-level props | Mobile behavior | Required states |
|---|---|---|---|
| Money | `minor`, `currency`, `locale`, optional FX source/rate/date | Amount never truncates; FX note expands | Known, unknown, withheld, negative |
| StatusPill | `domain`, typed `status`, label | Wrap, never icon-only | All declared states; unknown fallback |
| SectionStatus | Section, status, reason, freshness, next action | Inline banner above section | Five parity statuses |
| DataTable | Columns, rows, pagination, sort, selection, summary renderer | Task-specific summary rows; detail disclosure | Loading, empty, filtered-empty, error, stale |
| SavedViews | Named filter definitions and ownership | Sheet with current-view chip | Built-in, saved, modified, invalid |
| Timeline | Events, actor, occurred/received times, links | Single vertical sequence | Empty, paginated, delayed event |
| EvidenceDrawer | Delivery, fetch pages, revision metadata, permission | Full-height sheet | Loading, denied, redacted, failed |
| ApprovalSheet | Policy, proposal, before/after, version, reason | Full-height review and sticky decision | Pending, rejected, stale, executed, expired |
| ScopeSwitcher | Permitted dimensions, current scope | Searchable staged sheet | Loading, unavailable, invalid combination |
| ExceptionCard | Severity, subject, cause, age, next action | Whole summary links to resolver | New, retrying, unresolved, resolved |
| StockLotBadge | Lot, expiry, release state, owner | Expand traceability details | Released, quarantined, expired, recalled |
| LotPicker | Eligible lots, FEFO suggestion, required quantity | Scan plus selectable rows | Suggested, insufficient, excluded, stale |
| AddressCard | Snapshot, address type, validation, source | Readable lines and copy action | Loaded, not needed, denied, incomplete |
| ContactCard | Buyer snapshot, profile link, guest flag | Tap-to-call; explicit copy | Guest, linked, redacted, unavailable |
| CommandPalette | Authorized destinations/results/actions | Full-screen search | Searching, empty, failed, selected |
| EmptyState | Reason, explanation, next step | One contextual action | First-run, no matches, no activity |
| LoadingState | Layout skeleton, accessible label | Stable dimensions | Initial, refresh, operation pending |
| ErrorState | Category, retry, request ID | Inline recovery | Offline, service failure, forbidden, missing |
| ReportFrame | Definition, source, freshness, coverage, table | Chart/table switch | Complete, partial, stale, no coverage |
| ScanInput | Expected code types, submit, camera capability | Wedge keyboard first; optional camera | Ready, denied camera, invalid, duplicate |
| PrintDocument | Kind, immutable snapshot, paper size | Preview/download then browser print | Ready, unavailable, print failed |
| ActionBar | Server-provided actions and disabled reasons | Sticky above tabs/safe area | Available, pending, blocked, stale |
| FormSheet | Schema-bound fields, submit, dirty state | Full-height when keyboard-intensive | Pristine, dirty, invalid, submitting, failed |
| NotificationCenter | Scoped incidents, read state, target | Full-height list | Unread, read, empty, failed |
| AppShell | Role placement, scope, navigation, session state | Tabs/rail adaptation | Authenticated, expired, offline |

## 6. Screen program for Slice 1

Operation names below are **required handoff contracts**, not claims that every procedure exists. `orders.getWorkspace`, `orderImport.*` and the parity section names follow OR packets; remaining names describe the facade the backend lane must publish. UI packets depend on typed signatures, permission behavior, sanitized fixtures and error codes.

Every screen distinguishes loading, legitimate empty, blocked and error states. Blocked candidates may display their complete available snapshot, but remain outside operational orders and financial totals.

The Workspace contains these eleven sections in order:

| Section ID | Required content |
|---|---|
| `identity` | Source/local IDs, store/domain, selling entity, brand, channel, timestamps, test/cancel flags |
| `items` | Every source line; title, options, SKU/source IDs, quantities, unit and line money, mapping |
| `buyer` | Order-time name/contact snapshot; guest/profile distinction |
| `addresses` | Shipping and billing snapshots; delivery instructions |
| `price` | Subtotal, line/order discounts, shipping, tax treatment, total |
| `currency` | Shop/presentment currencies and amounts; applicable FX snapshot |
| `payment` | Transactions, outstanding/refunded amounts, COD or bank reconciliation state |
| `fulfillment` | Reservations, picks, packs, local shipments, source fulfillments |
| `returns` | Refunds, local returns, quantities, reasons and disposition |
| `context` | Notes, tags, custom attributes, risk, holds, available actions |
| `evidence` | Delivery/fetch/revision references, errors, section status and source freshness |

All eleven headings and statuses remain visible in one document. Desktop adds a sticky section index; phone uses “Jump to section.” Long collections expand or paginate internally without hiding the section. The sticky action bar comes exclusively from `actions_available`, including disabled reasons.

| Screen | Purpose / primary action | Required operations | Phone / desktop | Special states and Playwright assertions |
|---|---|---|---|---|
| Order Desk | Find next order requiring work / open next | `orders.list`, `orderImport.blockedSummary`, `views.list/save` | Summary rows + filter sheet / table + saved views | `order-desk-error` replaces empty on failure; `view-needs-attention` includes blocked candidates with distinct identity |
| Order Workspace | Understand and act on one order / next permitted action | `orders.getWorkspace`, hold/release/cancel operations | One scroll + bottom action / content + section index | Eleven `section-*` IDs; source line count matches fixture; `action-ship` disabled for pending revision |
| Import Blocked resolver | Explain failed acceptance / resolve then reprocess | `orderImport.getCandidate`, `retryHydrate`, `acknowledgeAccessGranted` | Blockers then shared workspace / split explanation and snapshot | `import-blocked` names exact section; `blocker-next-action` visible; no fulfilment action |
| Variant Mapping resolver | Bind source variant / confirm mapping | Mapping search/map/create/classify operations | Source snapshot then candidates / side-by-side comparison | `mapping-source-id` includes connection; matching SKU never auto-confirms; promotion follows successful reprocessing |
| Customer profile | Group person and brand relationships / inspect orders | `customers.getProfile`, authorized relationship operations | Profile then brand sections / relationship list + orders | `customer-guest` does not invent a registered profile; unauthorized brand data absent from response |
| Product/variant/listing | Explain sold item and channel mapping / resolve listing | `products.getWorkspace`, `listings.list`, mapping operations | Variant selector + sections / master/detail | `listing-source-id`, per-connection status; deleted source variant still shows snapshot |
| Stock | Show ownership and physical availability / inspect eligible lots | `inventory.availability`, `inventory.lots` | Item summaries, lot sheet / owner-location-lot table | `stock-available` distinct from on-hand/reserved; `lot-expired` excluded from allocation |
| Reserve → Pick → Pack → Ship | Complete warehouse work / current step | Reservation preview/commit, pick scan/confirm, pack confirm, shipment handoff | Large scan input + one task / queue + active task | `scan-result` rejects wrong SKU/lot; double confirmation creates one effect; offline action remains unsubmitted |
| Courier booking/tracking | Create shipment and explain delivery / book | `shipments.quote/book/get/refresh` | Address/COD review then timeline / booking form + tracking | `booking-pending` survives uncertain timeout; retry reuses key; delivered does not imply remitted |
| COD reconciliation | Match courier money / reconcile reviewed batch | `remittances.list/get/preview/reconcile` | Exception summaries; controlled review / matching grid | `settlement-difference` exact; unexplained short-pay cannot silently reconcile |
| Approvals inbox | Review controlled changes / approve or reject | `approvals.list/get/decide` | List → ApprovalSheet / inbox + proposal | `approval-stale` blocks decision; required reason enforced; execution result distinguished from approval |
| Audit viewer | Explain who changed what / inspect event | `audit.list/get` | Filter sheet + event detail / dense searchable table | `audit-filters` survive reload; redacted evidence cannot be revealed by UI controls |
| Connections/settings | Establish trustworthy integrations / test permissions | Connection list/get/connect/save; health and recheck operations | Connection summaries + guided setup / health matrix | `health-customer-data` reports permission denial even on HTTP 200; secrets never returned in read DTO |
| Owner home | Exceptions, today, money / resolve highest-priority issue | Reports **2, 1, 6**, scoped home operation | Exception list before metrics / three restrained regions | `blocked-count` separate from sales; `coverage-note` visible; empty DB offers connection/import steps |
| Login/2FA/recovery | Restore authorized access / continue intended task | Better Auth login, TOTP, backup-code, enrollment and recovery operations | Single-column form / constrained form | `auth-return-to` restores safe local route; trust defaults off; Arabic-Indic OTP normalized; recovery code reusable only once |

S1 ships Shopify and the selected courier. Connections architecture accommodates WooCommerce and payment providers, but their controls activate only when their adapters and tests exist. WooCommerce remains S2 under the current delivery plan.

First-run home says what is missing: **connect store → verify access → import first order → resolve blockers**. A connected store with zero orders is distinct from an unconnected store, a failed fetch and an incomplete backfill. Never insert demonstration orders into production to make dashboards attractive.

A newer blocked revision preserves the previously accepted snapshot with an explicit “Newer source data pending” notice. Fulfilment/refund actions remain blocked until the server resolves it. The browser cannot infer readiness from a green badge.

## 7. Dashboard and data-viz rules

Ship reports **2: attention**, **1: sales/contribution**, and **6: courier/COD** first, matching the owner’s immediate decisions. Report queries remain handwritten SQL; chart components never implement financial calculations.

| Report | Visualization | Mandatory qualification |
|---|---|---|
| 1. Sales/contribution | Daily bars; aligned small multiples by entity/brand/channel/currency | Ledger basis, FX basis, missing-cost coverage |
| 2. Orders needing attention | Ranked exception list with counts and ageing | Accepted orders versus blocked imports |
| 3. Stock availability/ageing/expiry | Age-bucket bars and lot table | As-of time, owner/location, excluded lots |
| 4. Funnel | Horizontal stage bars on a shared baseline | Eligible sessions, storefront/device/campaign coverage |
| 5. Repeat/cohorts | Semantic table heatmap with printed percentages | Cohort definition, denominator, immature periods |
| 6. Courier/RTO/COD | Separate delivery-rate and money-ageing panels | Shipment cohort; collected, due and remitted separated |
| 7. Fulfilment performance | Throughput bars; separate turnaround lines | Median/p90 definitions, incomplete jobs and errors |
| 8. Speed/integration health | Separate LCP/INP trends plus connection health matrix | Device sample size, telemetry gaps, capability status |

One chart has one unit and one scale. Never combine EGP and EUR, percentage and money, or count and duration on dual axes. Comparable small multiples share domains; bars start at zero. Time runs chronologically left-to-right even in Arabic, inside an explicitly LTR plot; surrounding captions, legends and tooltips follow locale. Verify Arabic labels and keyboard traversal rather than assuming automatic RTL support.

Place **definition, source, last successful refresh and coverage** directly beneath the report title, before the plot. State “Updated 09:42 Cairo; 3/4 stores complete; Brand B pending,” not merely “Live.” Preserve a data-table alternative and accessible summary; Recharts’ accessibility support is a starting point, not a substitute for them. [Recharts accessibility guidance](https://github.com/recharts/recharts/blob/main/storybook/stories/API/Accessibility.mdx)

Missing costs are `null` plus a reason and coverage measure. Show **“Contribution unavailable — costs missing for 7 of 42 lines”**; optionally show a clearly labeled known-cost subtotal. Never render missing cost as zero or publish a misleading total margin. Zero sales appears only after a successful complete query confirms zero; failed coverage displays an unavailable state.

Use tabular numerals and exact values in tables/tooltips. Unknown periods are gaps, not zero-height bars. No smoothed curves that imply unobserved measurements, decorative donuts, 3D effects or animated counting.

## 8. Anti-generic guardrails

Refuse cream-plus-serif-plus-terracotta styling, purple gradients, glass panels, giant greeting banners, emoji section markers, centered operational content, ornamental sparklines, and everything-is-a-card layouts. Stitch references must show realistic long Arabic content, failures and empty states; attractive placeholder dashboards are not acceptance evidence.

The admin belongs to IRTH through restrained bronze, warm neutrals and precise typography. Arabic leads the composition while identifiers and amounts remain exceptionally readable. Thin rules and aligned rows organize work before containers do. Operational exceptions earn visual emphasis; ordinary records remain quiet. Every prominent action names the business consequence it will cause.

## 9. Build program for the UI track

**Packet execution contract.** Each row below becomes one `exec:ui` packet for agy. Its issued body must copy this common contract, the referenced component/screen requirements, exact API signatures, fixture references and its row; it must not require conversation history. Attach Stitch references for phone/desktop, light/dark, populated/empty/blocked states. References guide composition; tokens, semantics and tests win conflicts.

Every packet reads `CLAUDE.md` and its Do-not-touch list. UI scope excludes `apps/admin/src/server/**`, `apps/api/**`, `packages/**`, migrations, auth configuration, `.env*`, lockfile and infrastructure. Backend contracts, dependency installation, auth consolidation and Expo removal are predecessor packets on their appropriate lanes.

For paths below:

- `A` = `apps/admin/src`.
- `D` = `A/app/[locale]/(dashboard)`.
- `F` = new `A/components/features`.
- Each packet owns `apps/admin/e2e/ui-XX.spec.ts` and relevant `A/__tests__/ui/ui-XX.test.tsx`.
- New feature messages live in packet-owned namespace files under `A/messages/features/`; UI-01 establishes loading and key-collision checks. Existing shared catalogs are not edited concurrently.

Common browser matrix: Arabic/English; light/dark; 390×844 and 1440×900; 320px reflow; keyboard and reduced motion. Assert semantics with roles and stable `data-testid`; snapshots supplement behavior. Test fixtures stay in disposable test environments. Real-data UAT uses the owner’s imported order without committing PII.

| Packet / size | Goal and owned files/area | API and predecessor dependencies | Acceptance, including browser assertion |
|---|---|---|---|
| UI-01 / M | Establish tokens, fonts, theme and message loading: `A/app/[locale]/globals.css`, locale layout, `A/i18n/request.ts` | Dependency baseline | `theme-toggle` persists without flash; contrast pairs pass; English becomes LTR |
| UI-02 / M | Normalize foundational components: `A/components/ui/**`, Money/SectionStatus/FormSheet | UI-01; domain formatter contract | `money-value` preserves large bigint; dialog traps/restores focus; failed submission remains open |
| UI-03 / L | Render real eleven-section order: `D/orders/[id]/page.tsx`, `F/orders/OrderWorkspace.tsx` | UI-02; OR-16 `getWorkspace`; owner fixture | Eleven `section-*` nodes, every source item, buyer/address/totals; no false empty on failure |
| UI-04 / M | Explain blocked import: `D/orders/import/[candidateId]/page.tsx`, `F/imports/**` | UI-03; OR-12 | `import-blocked` names missing section; retry shows operation state; no shipping affordance |
| UI-05 / M | Resolve source variants: `F/mapping/**` | UI-04; mapping search/map/create/classify | `mapping-confirm` requires explicit source/target selection; all lines survive promotion |
| UI-06 / M | Replace Carbon shell: `A/components/layout/**`, dashboard layout, `A/lib/navigation.ts`, `routeLabels.ts`, `A/styles/carbon.scss` | UI-01/02; authorized navigation/scope DTO | No Carbon DOM/imports remain; `mobile-tabs` and desktop nav agree; active nested route correct |
| UI-07 / M | Build table and saved-view primitives: `A/components/data/**` | UI-02; saved-view contract | `saved-view` survives reload; mobile summary exposes required fields; selection scope explicit |
| UI-08 / M | Rebuild Order Desk: `D/orders/page.tsx`, `OrdersClient.tsx` | UI-06/07; OR-18 list and blocked counts | `view-needs-attention` finds fixture; loading/error/zero distinguished; filters round-trip URL |
| UI-09 / M | Add evidence and revisions: `F/evidence/**` | UI-03; audited evidence read/list operations | `evidence-raw` absent before authorized fetch; failed revision preserves accepted items |
| UI-10 / M | Connection setup and health: `D/integrations/**`, `F/connections/**` | UI-06; CX connections, OR-19 health | HTTP-200 redaction renders `permission-denied`; successful permission recheck enables retry |
| UI-11 / M | Group customer workspace: `D/customers/[id]/**`, `F/customers/**` | UI-06; customer/profile DTO | `brand-relationship` scoped correctly; guest snapshot remains accessible without account |
| UI-12 / M | Product/variant/listing workspace: `D/products/**`, `F/products/**` | UI-06; product/listing DTO | `listing-connection` distinguishes identical SKUs across stores; snapshot survives source deletion |
| UI-13 / M | Stock and lot visibility: `D/inventory/**`, `F/stock/**` | UI-06/07; availability/lot operations | `stock-owner` differs from location; expired/quarantined stock excluded from selectable availability |
| UI-14 / L | Phone fulfilment: new `D/fulfillment/**`, `F/fulfillment/**`, scan/lot controls | UI-13; reservation/pick/pack operations | `scan-result` rejects wrong lot; shortage explained; duplicate confirmation produces one reservation/effect |
| UI-15 / M | Courier booking/tracking: `D/courier/shipments/**`, `F/shipments/**` | UI-14; quote/book/track and operation-status contracts | `booking-review` shows address/COD/entity; timeout recovery does not duplicate shipment |
| UI-16 / M | Return/refund action surfaces: `F/returns/**` | UI-03; return preview/propose and approval contracts | `refund-preview` shows currency, refundable quantity and disposition; pending approval does not say refunded |
| UI-17 / L | COD reconciliation: `D/courier/remittances/**`, `F/remittances/**` | UI-07; settlement preview/reconcile | `settlement-difference` matches fixture exactly; unauthorized short-pay rejected; repeated submit executes once |
| UI-18 / M | Approval inbox: new `D/approvals/**`, `F/approvals/**` | UI-06; CX-10 five-policy operations | `approval-stale` blocks execution; reason mandatory where required; self-approval follows server policy |
| UI-19 / M | Audit viewer: new `D/audit/**`, `F/audit/**` | UI-06/07; audit list/detail | `audit-filter-actor` persists; before/after readable; no edit/delete controls |
| UI-20 / M | Owner home and first-run: `D/page.tsx`, `F/home/**` | UI-06; AN reports 2/1/6 and connection readiness | `blocked-count` drills through; no fabricated zero revenue; first-run steps reflect actual readiness |
| UI-21 / M | Login/enrollment/recovery UX: `A/app/[locale]/(auth)/**`, `F/auth/**` | UI-02; CX consolidated auth and recovery contracts | Backup code works once; `trust-device` defaults off; expiry returns safely to intended route |
| UI-22 / M | Installable phone experience: manifest, `A/components/pwa/**`, public offline assets/service worker | UI-06/21; delivery-owned SW headers/config | `offline-banner` appears; authenticated responses never cached; update waits for dirty form resolution |
| UI-23 / L | Eight report presentations: `D/analytics/**`, `F/reports/**`, chart wrappers | UI-07; each published AN report contract | `coverage-note` visible for every report; missing costs never zero; chart/table values agree |
| UI-24 / M | Role homes: `F/home/AccountantHome.tsx`, `OpsHome.tsx`; registered home composition | UI-20; close/unposted/reconciliation/queue DTOs | Accountant sees close work; warehouse sees assigned queue; hidden margins absent from payload |
| UI-25 / L, S2 | POS tablet workspace: new `A/app/[locale]/(pos)/**`, `F/pos/**`, receipt print | UI-02/22; idempotent POS sale/refund contracts | `pos-pay` disabled offline; duplicate tender creates one sale; receipt matches committed transaction |
| UI-26 / M, S3 | Supplier portal: new `A/app/[locale]/(supplier)/**`, `F/supplier/**` | UI-02/21; supplier-scoped PO/delivery operations and RLS | `supplier-po` shows only assigned supplier; guessed foreign ID denied; no internal notes/margins |

Sizes follow the repository: S ≤ half a day, M ≤ two days, L ≤ five days; split anything larger before issue publication.

**Sequence:** UI-01 → UI-02 → UI-03 is the shortest route to the real order. Do not wait for the sidebar, dashboard or report suite. UI-04/05 then make blocked data repairable. UI-06 can proceed alongside UI-03 after primitives stabilize; UI-07 can proceed alongside UI-04. After shell/contracts land, evidence, connections, customer, product, stock, auth and audit packets can run independently in their owned paths.

Serialize shared-file edits: UI-01 owns globals/layout/message loading; UI-02 owns primitives; UI-06 owns navigation; UI-20 then UI-24 own home composition. Feature agents request shared-component changes through those owners rather than patching them concurrently.

A UI packet is complete only with Arabic/English browser evidence, API fixture/error coverage, relevant component tests, and the repository’s lint/typecheck/test gate. Its PR includes `ID | status | PR | commit | evidence/tests | migration | blocker | next`. Browser mocks prove presentation; disposable-Postgres tests prove tenant isolation, atomicity and idempotency. S1 release additionally requires the owner’s real order to pass the parity and fulfilment gate.

## 10. What I would refuse to build now

- **Another component-library migration.** Carbon leaves; the existing Tailwind/Radix foundation stays.
- **A prettier half-order.** Missing buyer, lines or required addresses must produce an explicit import blocker.
- **A generic workflow, permission or dashboard builder.** Five approval policies and fixed role templates are sufficient.
- **A public REST rewrite as a prerequisite for S1.** Share operations first; expose the public subset in its planned slice.
- **Offline POS, stock writes or financial mutations.** Recovery and conflict resolution would exceed the agreed online-only model.
- **A native mobile replacement.** Finish the responsive admin and installable web experience.
- **Demo-seeded production dashboards or invented margins.** Empty, unavailable and incomplete are legitimate product states.
- **WooCommerce, full POS, supplier portal or consolidated close disguised as S1 completion.** Their architecture is specified; implementation remains gated by the planned slices.
- **A theme per brand, decorative analytics, or persistent AI assistant chrome.** This is one team’s working control room.
- **Fake storefront parity buttons.** Unsupported actions carry an exact reason and source link; implemented actions require real server operations and evidence of their effects.