> **Status:** approved by the owner 2026-09-25. Owner decision A5 in `docs/superpowers/specs/2026-09-17-irth-os-bos-design.md`.

# خطة التنفيذ — IRTH OS: تشغيل آمن + نظام صلاحيات مرن (موظفين / مناديب / موردين)

## Context
- التقييم السابق: الأساس الهندسي قوي (money/ledger/RLS/idempotency، والـ CI أخضر بـ 770 test)، لكن مسار أوردر Shopify لسه بيشيل البنود اللي مش متربطة (`apps/api/src/routes/webhooks/shopify.ts:380`)، والإيراد بيتحسب من `orders` بدل الـ ledger، ومفيش Sentry ولا e2e، والإنتاج اتكسر أكتر من مرة.
- قرار المالك: **كل الشاشات والفيتشرز هتفضل**. الشغل هيكمل لحد ما المشروع يخلص بالكامل، مش هنقلّص.
- طلب جديد: الأدمن ينشئ الحسابات بنفسه، ويختار لكل شخص **الشاشات والعمليات ونطاق البيانات والحقول الحساسة**. الأنواع: موظف، مندوب توصيل، مندوب مبيعات، مورد (في بوابة منفصلة).
- ده بيلغي قرار الـ spec القديم "fixed role templates, no permission builder" (`docs/delivery/packets/CX.md` CX-03/CX-20). يتسجل كقرار مالك **A5** في `docs/superpowers/specs/2026-09-17-irth-os-bos-design.md`.

### الوضع الحالي للصلاحيات (اللي هنبني عليه)
- `packages/db/src/permissions.ts`: فيه 3 أدوار ثابتة (owner/admin/member) و13 resource، و`can(role, resource, action)`.
- `apps/admin/src/server/trpc.ts`: فيه `protectedProcedure` (58 استخدام)، و`adminProcedure` (40)، و`ownerProcedure` (9)، و`requirePermission` (حوالي 70). يعني نص الـ API بيعتمد على مستوى الدور مش على صلاحية محددة.
- `org_members.role` عمود نصي. `resolveActiveOrgMembership` في `packages/db/src/orgContext.ts` بيرجّع `{orgId, role}`.
- `org_feature_flags.enabledScreens` وقائمة `ALL_SCREENS` في `apps/admin/src/lib/platformPlans.ts` موجودين، بس **مش متربطين بالـ Sidebar**. الـ `buildNavGroups` في `apps/admin/src/lib/navigation.ts` بيعرض كل حاجة لكل الناس.
- الانضمام دلوقتي بالدعوة بس (email + OTP، في `packages/db/src/invites.ts`). مفيش إنشاء حساب مباشر.

---

## المرحلة 0 — تشغيل آمن (الأيام 1–7، قبل الإطلاق)
الهدف: الإطلاق يحصل جنب Shopify (shadow run) من غير ما أي أوردر يضيع أو رقم يطلع غلط. الشاشات كلها تفضل موجودة.

1. **الأوردر ما يتشالش منه حاجة** (نسخة مصغرة من OR-09، ومتوافقة معاه):
   - Migration `0073_orders_snapshot.sql`: إضافة `buyer jsonb` و`shipping_address jsonb` و`billing_address jsonb` و`totals jsonb` (subtotal/discount/shipping/tax بالقروش) و`source_payload jsonb` و`import_status` (`complete|blocked`) و`blocked_reason`.
   - في `applyShopifyOrderLines`: لو فيه بند مش متربط، الأوردر يتسجل `import_status='blocked'` والبنود كلها تتحفظ في `source_payload`، والمخزون ما يتخصمش لحد ما البند يتربط.
   - إضافة action اسمه `orders.resolveBlocked` لربط الـ SKU وإعادة معالجة الأوردر، ويشتغل بـ idempotency key.
2. **الإيراد في التقارير يتقرا من الـ ledger**: في `dashboard.ts` و`analytics.ts` وسؤال الإيراد في `finance.ts:48`. النمط الصح موجود أصلاً في `finance.ts:104-122`.
3. **مراقبة الأخطاء**: Sentry في admin (Next) وapi (Workers)، و alert لما يحصل أي 5xx أو فشل في الـ webhook أو الـ outbox.
4. **Playwright smoke في CI**: login ← فتح أوردر ← التأكد إن الأقسام ظاهرة ← الشحن.
5. **Restore drill** حقيقي حسب `docs/db/RESTORE.md`، وترقية خطة Neon لـ PITR أطول.
6. **الحوكمة**: وقف الـ auto-merge لـ PRs الـ bots. أي PR بيلمس الفلوس أو الأوردرات أو الصلاحيات يعدّي على `money-reviewer` و`tenancy-reviewer` وبعدين مراجعة بشرية.
7. **تقرير مطابقة يومي مع Shopify** (عدد الأوردرات والإجمالي والأوردرات الـ blocked) طول فترة التشغيل جنب Shopify.

**معيار Go:** أوردر حقيقي يظهر كامل ويطابق صفحة Shopify، والبند اللي مش متربط يظهر "blocked" مش ناقص.

---

## المرحلة 1 — محرك الصلاحيات v2 (الأسبوع 2–4)

### 1.1 نموذج البيانات (Migration `0074_access_control.sql` + schema `packages/db/src/schema/access.ts`)
- **`access_roles`**: `id, org_id, name, principal_kind (staff|delivery_rep|sales_rep|supplier), is_system bool, permissions jsonb {resource: action[]}, created_by, updated_at`، مع UNIQUE `(org_id, name)` وRLS بنفس قالب `drizzle/_TEMPLATE.sql.txt`.
- **`org_members`** يتضاف له: `access_role_id uuid` (FK مركّب مع org_id)، و`principal_kind`، و`status (active|suspended)`، و`overrides jsonb {grant:{}, revoke:{}}`، و`must_change_password bool`.
  - عمود `role` يفضل في مرحلة الانتقال. الـ `owner` بيفضل flag خاص: عنده كل الصلاحيات، ولازم يفضل في الـ org مالك واحد على الأقل (constraint trigger).
- **`member_scopes`**: `org_id, member_id, scope_kind (warehouse|brand|channel|supplier), scope_id`، مع UNIQUE `(member_id, scope_kind, scope_id)`. ده بيعتمد على الجداول الموجودة في `schema/dimensions.ts` (warehouses/brands/channels).
- **Backfill**: كل org يتعمل لها 3 أدوار نظام بنفس المصفوفة الحالية بالظبط (مالك/مدير/موظف)، وكل عضو يتربط بدوره. يعني **السلوك يوم التحويل مايتغيرش خالص**.
- **قوالب جاهزة** يقدر الأدمن ينسخها ويعدّلها: محاسب، أمين مخزن، خدمة عملاء، مسؤول مشتريات، مندوب توصيل، مندوب مبيعات، مورد.

### 1.2 كتالوج الصلاحيات (مصدر واحد)
- `packages/db/src/permissions.ts` يبقى فيه `PERMISSION_CATALOG`. كل resource بيتربط بـ: شاشة (slug + اسم عربي)، والعمليات المتاحة (`view | create | edit | delete | approve | export`، وعمليات خاصة زي `post` للـ ledger و`collect_cod`)، وأنواع الأشخاص المسموح لهم بيها.
- resources جديدة: `ledger`، `audit`، `approvals`، `shipments`، `suppliers`، `reports`، `roles`، `deliveries`، `rep_cash`، `sales_rep_orders`.
- resource اسمه **`sensitive`** وعملياته: `cost`، `margin`، `supplier_price`، `customer_contact`.
- الشاشة بتظهر بشرط يكون عند الشخص `view` على الـ resource بتاعها **وكمان** تكون مفعّلة في باقة الـ org (`org_feature_flags.enabledScreens`). كده الشاشات مالهاش جدول لوحدها، فمفيش حاجة تتلخبط بين مكانين.
- `can(access, resource, action)` بتاخد object اسمه `EffectiveAccess` (`{isOwner, principalKind, perms: Set<"res.action">, scopes}`) بدل الـ role. الملف يفضل pure من غير imports، عشان `apps/admin/src/lib/permissions.ts` بيعمل deep import للمتصفح.

### 1.3 حساب الصلاحية على السيرفر
- `resolveActiveOrgMembership` في `orgContext.ts` يرجّع `EffectiveAccess`. المعادلة: صلاحيات الدور + `grant` − `revoke`، وده في query واحد join. الـ owner بياخد كل حاجة. العضو الـ `suspended` يترفض.
- **tRPC** (`apps/admin/src/server/trpc.ts`): الـ `createContext` يحط `ctx.access` في الـ context، و`requirePermission` يستخدم `can(ctx.access, …)`. بعدها `adminProcedure` و`ownerProcedure` يتحوّلوا لـ wrappers قديمة (deprecated).
- **الـ API** (`apps/api/src/middlewares/authContext.ts` و`requirePermission.ts`): نفس الشيء.
- **نقل كل الـ procedures**: الـ 107 procedure اللي على `protected/admin/ownerProcedure` تتحوّل لـ `requirePermission(resource, action)` صريح، router ورا router (28 router).
- **Gate test جديد** `apps/admin/src/__tests__/permissionGate.test.ts` على نفس شكل `tenancyGate.test.ts`: يفشل لو أي procedure في `routers/` (غير `me` و`platformAdmin`) مش ماشي على `requirePermission`. يتثبت إنه بيفشل بزرع خطأ عن قصد وبعدين يترجع، حسب CLAUDE.md.
- **سجل الرفض**: كل رفض صلاحية يتسجل في `audit_log` بـ `outcome='denied'`، وبحد أقصى لكل شخص في الدقيقة.
- **MFA** (CX-04 بعد تعديله): أي حد عنده `roles.*` أو `members.*` أو `ledger.post` أو `finance.edit` ممنوع يعمل أي تعديل إلا لما يفعّل TOTP. الـ 2FA موجود أصلاً (migrations 0063/0066).

### 1.4 نطاق البيانات (Scopes) — طبقتين
- `withOrgContext` في `packages/db/src/index.ts` يضيف في نفس جملة `set_config` القيم دي: `app.member_id` و`app.principal_kind` و`app.warehouse_ids` و`app.brand_ids` و`app.supplier_ids`، وكلهم transaction-local.
- **policy RLS تانية** (`0075_scope_policies.sql`) على الجداول اللي فيها عمود النطاق، بالشكل ده: `current_setting('app.warehouse_ids', true) = '' OR warehouse_id = ANY(...)`. ونفس الفكرة للـ brand والـ supplier. وبرضه تتكتب شروط `WHERE` صريحة في الكود، يعني طبقتين زي القاعدة 3.
- جداول لسه مافيهاش `warehouse_id` (مثلاً `inventory_items` قبل الـ re-key في IN-01): النطاق يتطبق في الكود بس، ويتعلّم عليها في `rlsCoverage` لحد ما IN-01 يوصل.

### 1.5 إخفاء الحقول الحساسة
- `redactForAccess(row, access, SENSITIVE_FIELDS)` في `packages/db/src/permissions.ts`: بيشيل `costMinor` و`marginMinor` و`supplierPriceMinor` وبيانات تواصل العميل من الـ **response نفسه على السيرفر** (مش مجرد إخفاء في الواجهة).
- يتطبق في: products، inventory، orders، purchasing، finance، analytics، dashboard.

### 1.6 شاشات الإدارة
- **`/settings/roles`**:
  - قائمة الأدوار، مع إنشاء ونسخ وتعديل.
  - مصفوفة: كل صف شاشة، والأعمدة (عرض / إضافة / تعديل / حذف / اعتماد / تصدير).
  - قسم "حقول حساسة".
  - نوع الدور.
  - مايتمسحش دور عليه أعضاء.
- **`/settings/members`** (توسيع الشاشة الموجودة):
  - **إنشاء حساب مباشر**: الاسم، والموبايل أو اسم المستخدم، والإيميل (اختياري)، والدور، والنطاقات، وكلمة سر مؤقتة. أول دخول يجبر الشخص يغيّرها (`must_change_password`).
  - تفعيل Better Auth `username` plugin عشان المناديب يقدروا يدخلوا برقم الموبايل من غير إيميل ومن غير تكلفة SMS.
  - الدعوة بالإيميل تفضل موجودة كخيار تاني.
  - **استثناءات للفرد**: إضافة أو سحب صلاحية معينة من شخص واحد.
  - إيقاف وتفعيل الحساب، وإعادة تعيين كلمة السر.
  - زرار **"الصلاحيات الفعلية"** بيعرض آخر محصلة لصلاحيات الشخص.
  - أي تغيير يعدّي على `withAudit(tx, …)`.
- **Router جديد** `apps/admin/src/server/routers/access.ts` فيه: `roles.list/create/update/duplicate/delete` و`members.create/update/setOverrides/setScopes/suspend/resetPassword/effective`، وكله بـ zod و`.max()`.
- **الـ Sidebar و CommandPalette**: `buildNavGroups(locale, access)` يفلتر حسب الصلاحيات، و`me.get` يرجّع `EffectiveAccess`.
- **حماية الصفحة نفسها**: كل `page.tsx` تنادي `requireScreen('orders')`، ولو الشخص مالوش صلاحية ترجع `notFound()`. ده عشان الرابط المباشر مايفتحش الشاشة، وده UX بس. الحماية الحقيقية في الـ procedures.

---

## المرحلة 2 — المناديب (الأسبوع 4–6)
الواجهة تبقى route group موبايل (PWA) جوه `apps/admin`: `app/[locale]/(rep)/**` بـ shell خاص بيه. مش هنحيي `apps/mobile`.

### مندوب التوصيل (`principal_kind='delivery_rep'`)
- Migration `0076_delivery_reps.sql`:
  - `orders.assigned_rep_member_id` + index.
  - جدول `rep_cash_collections (org_id, member_id, order_id, amount_minor bigint, currency, idempotency_key, collected_at, handover_id)`.
  - جدول `rep_cash_handovers`.
  - RLS: `principal_kind <> 'delivery_rep' OR assigned_rep_member_id = app.member_id`.
- **شاشات المندوب**:
  - طلباتي النهارده.
  - تفاصيل الأوردر: العنوان، وزرار اتصال، ومبلغ COD.
  - تم التسليم / فشل (مع السبب) / مرتجع.
  - تحصيل COD بـ idempotency key.
  - تسليم العهدة آخر اليوم.
- **في الأدمن**:
  - إسناد أوردرات لمندوب (فردي أو جماعي).
  - شاشة "عهدة المناديب": المحصّل، والمسلّم، والفرق.
- **المحاسبة** (عن طريق `postJournalEntry` الموجود في `packages/db/src/ledger.ts`):
  - عند التحصيل: من ح/ عهدة مندوب ← إلى ح/ العملاء (COD).
  - عند التسليم: من ح/ الخزينة ← إلى ح/ عهدة مندوب.
  - الفرق يتسجل كقيد مستقل يتعمل له approve. مفيش أي تعديل على قيود قديمة.

### مندوب المبيعات (`principal_kind='sales_rep'`)
- إضافة `customers.sales_rep_member_id` و`orders.created_by_member_id`، مع RLS: المندوب يشوف عملاءه وأوردراته بس.
- **الشاشات**: عملائي، وإنشاء أوردر أو عرض سعر بقائمة الأسعار المسموحة (pricelists موجودة)، وأوردراتي وحالتها.
- الخصم يتحسب بـ `Money.allocate`، والأسعار بالقروش.

---

## المرحلة 3 — بوابة الموردين (الأسبوع 6–8)
ده CX-20 بعد التعديل.
- `suppliers.user_id`، و`org_invites.kind (user|supplier)` + `supplier_id`. المورد بيتعمل له حساب من شاشة الموردين نفسها.
- Route group منفصل `app/[locale]/(portal)/**` بـ shell بسيط، و`portalProcedure` بيشترط `principalKind==='supplier'`.
- **الشاشات**:
  - أوامر الشراء الموجهة ليه.
  - تأكيد أمر الشراء أو اقتراح تاريخ تسليم تاني (ده بيعمل approval عند المشتري).
  - إشعار التسليم (ASN).
  - الفواتير وحالة السداد.
- RLS على `purchase_orders` و`purchase_order_items`: `principal_kind <> 'supplier' OR supplier_id = ANY(app.supplier_ids)`.
- الـ output DTO محددة بالظبط (whitelist): من غير تكلفة، ولا هامش، ولا ملاحظات داخلية، ولا موردين تانيين.

---

## المرحلة 4 — استكمال المشروع كامل (بالتوازي، حسب الـ spec)
ترتيب التنفيذ زي ما هو في `docs/superpowers/specs/2026-09-17-irth-os-bos-design.md` §4 و§7، مع التعديلات دي:
- **S0**: الـ access control بتاعنا بيحل محل CX-03. الباقي زي ما هو: audit v2 (CX-05/06)، وconnections (CX-07)، وledger v2، وorders v2.
- **S1 (Order-first Shopify)**: المرحلة 0 هنا نسخة مصغرة منه، وS1 يكمّلها للـ 11 قسم + candidate/promotion. الإسناد لمندوب التوصيل يبقى جزء من خطوة الشحن جنب Bosta.
- **S2–S5** زي ما هم: WooCommerce/POS/تصنيع، وB2B/مشتريات/ETA، والـ workbench المحاسبي، وanalytics/social/API/MCP.
- صلاحيات الـ API keys والـ MCP بتتحسب بالمعادلة دي: (key scopes) ∩ `EffectiveAccess` بتاع اللي عمل الـ key.
- كل شاشة جديدة لازم تتسجل في `PERMISSION_CATALOG`، وده شرط لقبول الـ PR والـ gate test بيتحقق منه.

---

## الملفات الأساسية
- **DB**: `packages/db/src/permissions.ts`، و`packages/db/src/orgContext.ts`، و`packages/db/src/index.ts` (withOrgContext)، و`packages/db/src/schema/access.ts` (جديد)، و`packages/db/src/invites.ts`، و`packages/db/drizzle/0073…0077_*.sql`.
- **Admin**: `apps/admin/src/server/trpc.ts`، و`apps/admin/src/server/routers/{access,members,me}.ts` + كل الـ routers (نقل الـ procedures)، و`apps/admin/src/lib/{permissions,navigation}.ts`، و`apps/admin/src/components/PermissionGate.tsx`، و`app/[locale]/(dashboard)/settings/{roles,members}/**`، و`app/[locale]/(rep)/**`، و`app/[locale]/(portal)/**`، و`apps/admin/src/lib/auth-server.ts` (username plugin).
- **API**: `apps/api/src/middlewares/{authContext,requirePermission}.ts`، و`apps/api/src/routes/webhooks/shopify.ts`.

## التحقق
- **Unit**: `packages/db/src/__tests__/permissions.test.ts` بشكل table-driven: دور + استثناءات → صلاحيات فعلية. الـ owner عنده كل حاجة. الـ suspended مرفوض. `redactForAccess` بيشيل الحقول.
- **Integration على Postgres حقيقي** (`apps/admin/src/__tests__/integration/`):
  - `accessControl.test.ts`: الموظف اللي من غير `orders.edit` بياخد FORBIDDEN حتى لو نادى الـ procedure مباشرة.
  - `scopeIsolation.test.ts`:
    - أمين مخزن A مايشوفش مخزن B.
    - مندوب توصيل مايشوفش أوردر مش مسند ليه، حتى بـ id متفبرك.
    - مورد A ياخد 404 على أمر شراء لمورد B.
  - `repCash.test.ts`: التحصيل مرتين بنفس المفتاح يتسجل مرة واحدة، والقيود متوازنة.
  - `rlsCoverage` و`tenantIsolation` و`schemaDrift` يفضلوا خضر.
- **Gates**: `permissionGate.test.ts` يثبت إنه بيفشل بزرع procedure من غير `requirePermission`، وبعدين يترجع.
- **Playwright**:
  - الأدمن ينشئ دور "أمين مخزن" ويعمل له حساب، الشخص يدخل ويشوف شاشات المخزون بس، والرابط المباشر لـ `/finance` يرجع 404.
  - مندوب التوصيل يسلّم أوردر ويحصّل COD.
  - المورد يأكد أمر شراء.
- **الأمر**: `pnpm turbo lint typecheck test` + `pnpm --filter @irth/admin test:integration`.
- **على الإنتاج**: بعد الـ deploy، مقارنة `me.get` لكل عضو قبل التحويل وبعده. الـ backfill لازم يطلع صلاحيات مطابقة 100%.

## ترتيب الـ PRs (كل PR صغير، ومعاه migration رقمه في العنوان)
1. PR-0a أوردر blocked + snapshots (0073)
2. PR-0b الإيراد من الـ ledger
3. PR-0c Sentry + Playwright smoke
4. PR-1a schema + backfill (0074) + `EffectiveAccess`، من غير تغيير في السلوك
5. PR-1b نقل الـ procedures + permission gate
6. PR-1c شاشة الأدوار
7. PR-1d إنشاء الحسابات والاستثناءات + username login
8. PR-1e scopes + RLS (0075) + redaction
9. PR-2a مندوب توصيل (0076)
10. PR-2b مندوب مبيعات
11. PR-3 بوابة الموردين (0077)
