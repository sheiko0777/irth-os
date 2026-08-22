# irth-os — ملخص الجلسة (Session Summary)

هذا الملف بيوثّق كل اللي اتعمل في الجلسة دي: من صقل الواجهة، لتقييم صادق شامل للمشروع،
لخطة الطريق للإنتاج، للتنفيذ اللي بدأ فعلاً.

---

## 1) Phase 1 — صقل الواجهة وتجربة المستخدم (مكتمل ✅ — PR #129، مدموج)

**المشكلة الأساسية المكتشفة:** مكتبة `sonner` (toast notifications) كانت مثبّتة ومُستخدمة في
مكانين بس **لم تُركَّب إطلاقاً** في الـ layout — يعني كل استدعاءات `toast.success/error`
الموجودة كانت **صامتة تماماً**. المستخدم ما كانش بيشوف أي تأكيد بعد أي عملية.

### اللي اتعمل (7 commits):

**1.1 Toast notifications**
- تركيب `<Toaster>` في `app/[locale]/layout.tsx` (RTL + خط Cairo + theme داكن).
- ربط `toast.success/error` في **كل** أسطح الإدارة تقريباً: Products, Orders,
  BulkOrderActions, Coupons, Categories, Customers, Campaigns, Purchasing, Shipping,
  Pricelists, Returns, Courier, EtaActions, StatusUpdater, PurchasingActions.

**1.2 Loading skeletons**
- استخدام `SkeletonRow` الموجود مسبقاً (وغير مستخدم) أثناء التحميل الأولي لقائمة المنتجات.

**1.3 Confirm dialogs** (مكوّن جديد `ConfirmDialog.tsx`)
- بديل RTL محترم لـ `confirm()` الأصلي (كان بيجمّد الواجهة وغير مصمّم).
- مربوط بـ: إلغاء تفعيل منتج، حذف كوبون/مورّد/فئة/معدل شحن/قائمة أسعار، تغيير حالة بالجملة
  (BulkOrderActions)، إرسال/حذف حملة.

**1.4 Pagination UI** (مكوّنين جديدين: `Pagination.tsx` + `PaginationNav.tsx`)
- RTL، أرقام عربية (`toLocaleString('ar-EG')`).
- `PaginationNav` = نسخة تعمل بـ URL query param (`?page=`) للصفحات server-rendered.
- مربوط بـ: Products (client state)، Orders و Customers (URL-based)، مع إسقاط
  `pageSize` الثابتة الكبيرة (200/100) لصالح 50 حقيقية مع pagination فعلي.

**1.5 Form validation**
- Login form: رسائل خطأ بالعربية في zod schema + عرض inline تحت كل حقل (حدود حمراء).
- ProductForm: نفس النمط لحقول name/sku/price/stock + toast عند نجاح/فشل الحفظ.

**1.6 Unified error states** (مكوّن جديد `ErrorState.tsx`)
- استبدال `<div>Error loading X</div>` الخام بالإنجليزي بمكوّن موحّد (أيقونة + رسالة عربية)
  في: dashboard, products, categories, customers, inventory, purchasing/suppliers.

**إصلاحات جانبية:**
- `bg-white` مكتوب يدويًا في `ProductsClient` كان بيكسر الثيم الداكن → `bg-[var(--card-bg)]`.
- استبدال بقايا `console.error` في client components بـ `toast.error`.

**النتيجة:** PR #129 اتدمج في `main`. PR #128 (إصلاح IDOR أمني سابق) اتدمج بردو.

---

## 2) التقييم الصادق الشامل (Deep Audit)

بعد طلب المستخدم لتقييم مهني صادق وخطة كاملة للإنتاج، اتعمل تدقيق عميق بـ 3 وكلاء استكشاف
متوازيين + تأكيد يدوي مباشر بقراءة الكود (مش تخمين). الخلاصة:

> **المشروع يبدو مكتمل أكتر بكتير من حقيقته.** البنية المعمارية والأمان الأساسي محترمين
> فعلاً، لكن **العمود الفقري (الفلوس + التشغيل) فيه ثقوب حقيقية** تمنع أي إطلاق آمن حالياً.

### أ) المسار المالي — غير آمن للفلوس الحقيقية كما هو

| المشكلة | الموقع | الخطورة |
|---|---|---|
| **المخزون لا يُخصم عند البيع إطلاقاً** — صفر حماية من oversell. 3 تمثيلات مخزون غير متوافقة (`products.stock`, `productVariants.stock`, `inventoryItems.quantity`) | `apps/api/src/routes/orders.ts:22-85` | 🔴 الأخطر |
| **webhook الدفع (Paymob) غير idempotent وغير مقيّد بالـ org** — بيدوّر على `orderNumber` بدون `orgId`، ورقم الطلب يتكرر بين المستأجرين → ممكن يأكّد طلب مستأجر غلط. بيعيد المعالجة عند كل retry. ما بيتحققش من المبلغ | `webhooks/paymob.ts:62` | 🔴 |
| **كل حساب الفلوس بـ JS float** + ضريبة VAT مكتوبة يدويًا 14% على الإجمالي (غلط محاسبيًا) — مفيش ledger/دفتر قيود، "المحاسبة" مجرد SUM حي على جدول orders | `orders.ts:46`, `finance.ts:141`, `eta.ts:44` | 🔴 |
| رقم الطلب عبر `existingOrders.length + 1` — race condition، يحمّل كل الطلبات في الذاكرة، ينكسر بعد 9999 | `orders.ts:56-58` | 🟠 |
| `orderItems` تُكتب **خارج** الـ transaction — طلبات يتيمة عند أي crash | `orders.ts:77-82` | 🟠 |
| ETA: فاتورة تُبعث للمصلحة **على كل حفظ كـ delivered**، متجاوزة حارس idempotency في جدول `etaInvoices` → فواتير ضريبية مكررة للحكومة | `api/orders.ts:137` | 🔴 |
| `withAudit` لا يوفّر idempotency ولا transaction. جدول `outbox_events` (الحل المفترض) = **كود ميت، مفيش أي producer بيكتب فيه** | `packages/db/src/index.ts:45-53` | 🟠 |
| مفتاح تسوية COD غير متطابق (`remittanceId` مقابل `remittanceReference`) + مفيش مطابقة مبلغ | `courier.ts` | 🟡 |

### ب) التشغيل — الـ Worker غالباً ما بيقلعش أصلاً في الإنتاج

| المشكلة | التفاصيل |
|---|---|
| **`db:migrate` غير موجود** | `packages/db/package.json` فيه فقط generate/push/studio. خطوة الهجرة في `deploy-api.yml:32` **هتفشل** |
| **journal الهجرات متضارب** | `_journal.json` يتابع فقط `0000–0004`، بينما SQL موجود لحد `0018` (و`0005` ناقص من المجلد) |
| **`drizzle.config.ts` بيشوف جزء من الـ schema بس** | يشير لـ `./src/schema.ts` فقط، بينما الـ schema الحقيقي وقت التشغيل = ده + 13 ملف تحت `schema/` — أداة الهجرة **لا ترى** جداول inventory/outbox/eta/courier/... إلخ. هذا هو السبب الجذري لتضارب الـ journal |
| **اتصال DB مبني وقت تحميل الموديول** من `process.env.DATABASE_URL!` عبر postgres.js/TCP، مع `compatibility_date = 2024-03-20` قديم — احتمال كبير إن `process.env` فاضي على Workers وTCP محتاج Hyperdrive | `packages/db/src/index.ts:43` |
| **أسرار غير موثّقة بالكامل** | مفيش `.env.example` للأدمن إطلاقاً (تم إصلاحه — انظر §3)؛ `auth.ts` كان فيه تعليق "we'll configure this later" (تم إصلاحه) |
| **بوابة CI وهمية** | مفيش `test` أو `type-check` script في أي package — `turbo test`/`type-check` بيعدّوا فاضي (نجاح كاذب) |
| **rate limiter في الذاكرة** | بلا فائدة حقيقية على Cloudflare Workers (كل isolate له ذاكرته) |
| **مفيش نسخ احتياطي/خطة استرجاع موثّقة** | صفر مراجع لـ backup/PITR في المشروع كله |

### ج) نقاط ربط Shopify (جاهزة للاستكشاف لاحقًا)
- **Outbox pattern موجود لكنه هيكل ميت**: schema + processor (`outboxWorker.ts`) موجودين،
  لكن **مفيش أي كود بيكتب/ينتج (produce) حدث فيه**. لازم نبني الـ producer.
- **نمط webhook قابل لإعادة الاستخدام**: Bosta webhook (`bosta-webhook.ts`) هو أقرب قالب —
  raw body + HMAC + إيجاد الـ org بشكل غير مباشر. Shopify يحتاج تحقق مختلف (HMAC-SHA256 +
  base64، مش sha512 زي `verifyWebhook.ts` الحالي).
- **الإعدادات**: نظام `org_settings` + `settingsRouter` جاهز تمامًا لتخزين مفاتيح Shopify
  (نمط `integration.*` موجود بالفعل).
- **صفحة integrations موجودة** (`integrations/page.tsx`) — تصلح كنقطة توسّع لعرض حالة Shopify.
- **فجوات لازم تُبنى**: جدول ربط `shopify_*_map` (GID ↔ irth id)، `shopifyOrderId` على جدول
  الطلبات لضمان idempotency، SKU→variant resolver (لأن `orderItems.variantId` إجباري)، وحل
  قيد `sku` الفريد **عالميًا** (مش لكل مستأجر) في بيئة multi-tenant.

---

## 3) إعادة التأطير + خطة الطريق (الخطة المعتمدة)

**السؤال اللي كان بيسبب التوهان:** "إزاي أخلّص الـ 6 مراحل؟" (سؤال بلا قاع).

**السؤال الصح:** *"إيه أصغر مسار حقيقي كامل أقدر أشغّله في إنتاج، بتاجر واحد حقيقي، وأثق فيه
بالفلوس؟"*

**قرار المستخدم:** الهدف = يبدأ بمتجره الشخصي (عنده متجر Shopify جاهز فعلاً) ثم يوسّع لاحقًا.
البنية الـ multi-tenant تفضل موجودة بدون استثمار إضافي في SaaS onboarding دلوقتي.

**الاستراتيجية المعتمدة: شريحة رأسية (Vertical Slice) بدل التوسع الأفقي.** بدل ما نكمل
المراحل الست الأصلية بالترتيب القديم (UI → Testing → Security → Deploy → Shopify → Mobile)،
اتعادت صياغة الخطة حول سؤال واحد: **"هل ده ممكن يضيّع فلوس أو داتا؟" أولًا.**

### المراحل الجديدة (A → F)

| المرحلة | الهدف | الأولوية |
|---|---|---|
| **A — Ops Foundation** | نخلّي الـ Worker يقلع فعليًا في الإنتاج (DB connection على Workers، migrate runner حقيقي، توثيق env، إنهاء auth، health check حقيقي) | 🔴 أول حاجة |
| **B — Core Integrity** | نأمّن المسار المالي (transaction ذرية للطلب، خصم مخزون مع قفل صفوف، Paymob idempotent + org-scoped، إصلاح ETA، حساب فلوس decimal-safe، إصلاح تسوية COD) | 🔴 قلب الشريحة |
| **C — Testing كبوابة حقيقية** | Vitest + `test`/`type-check` scripts فعلية، تركيز على مسارات الفلوس/الأمان فقط | 🟠 |
| **D — Deploy & Observe** | نشر staging→production، نسخ احتياطي + اختبار استرجاع فعلي، rate limiter دائم (KV)، RUNBOOK | 🟠 |
| **E — ربط Shopify** | Push كتالوج/مخزون (outbox producer) + Pull طلبات (webhook جديد) — إعادة استخدام كل الأنماط الموجودة | 🟢 |
| **F — التوسّع** | Mobile design tokens، توحيد الـ API المزدوج (tRPC/Hono)، state machine لحالات الطلب، صقل إضافي | 🟢 |

**التخطيط الكامل موجود في:** `/root/.claude/plans/make-a-refactor-or-mellow-muffin.md`

**النطاق المتفق عليه للتنفيذ الفوري:** نبدأ بـ **Phase A ثم Phase B** كأول PR(s) — هذي
الشريحة اللي تحوّل المشروع من "بيبان شغّال" لـ "بيشتغل فعلًا ويُعتمد عليه". C–F تتسلسل بعدها.

---

## 4) التنفيذ اللي بدأ فعلاً (Phase A — جاري)

**الفرع:** `claude/phase-a-production-boot` (من أحدث `main`)

### Commit 1: `5feeb00` — "production boot foundations"

1. **`apps/api/src/auth.ts`** — إنهاء إعداد Better Auth:
   - قراءة `BETTER_AUTH_SECRET` من env بدل التعليق "we'll configure this later".
   - رفض الإقلاع في production لو السر مفقود (`throw` مبكّر بدل فشل صامت لاحقًا).
   - إضافة `baseURL` من `NEXT_PUBLIC_API_URL`.

2. **`apps/api/src/index.ts`** — `/health` حقيقي:
   - قبل: يرجّع `{status: 'ok', environment: 'development'}` **دائمًا**، حتى لو الـ DB واقعة.
   - بعد: بينفّذ `select 1` فعليًا على الـ DB، يرجّع `503` + `db: 'down'` لو فشل، ويقرأ
     `NODE_ENV` الحقيقي بدل القيمة المكتوبة يدويًا.

3. **توثيق متغيرات البيئة** (كانت الفجوة الأكبر في التشغيل):
   - تحديث `apps/api/.env.example`: إضافة `PAYMOB_HMAC_SECRET`, `BOSTA_API_KEY`,
     `TRUSTED_PROXY_COUNT`, `NODE_ENV` (كانت مستخدمة في الكود وغير موثّقة).
   - **جديد** `apps/admin/.env.example` — الأدمن ما كان عنده ملف env نموذجي إطلاقًا.
   - **جديد** `.env.example` في الجذر — فهرس يوجّه لكل تطبيق + توضيح إن الأسرار الحقيقية
     تُدار عبر `wrangler secret put` (API) و Cloudflare Pages env vars (admin)، مش ملفات.

### الخطوات المتبقية في Phase A (متوقفة — محتاجة قرارات المستخدم)

توقّف التنفيذ عند نقطتين حسّاستين لازم قرار المستخدم فيهم قبل الاستمرار، لأن الخطأ فيهم قد
**يفقد بيانات حقيقية**:

1. **حالة قاعدة بيانات Supabase الحالية**: هل فيها بيانات تجريبية بس (آمن نعمل baseline نظيف
   من الصفر)، ولا فيها بيانات حقيقية/تجريبية مهمة (لازم نعمل باكاب أول ونبني الـ baseline
   بعناية فوق الموجود بدون DROP)؟
2. **حساب Cloudflare**: هل عندك حساب جاهز أقدر أشغّل عليه أوامر `wrangler` (لإعداد الأسرار،
   Hyperdrive، والنشر)، ولا نجهّز الكود بس دلوقتي والنشر يبقى خطوة يدوية لاحقة منك؟

**الخطوة التالية بعد الإجابة:** إصلاح اتصال DB على Workers (نقل بناء `db` لكل-طلب عبر
`c.env` + Hyperdrive)، إصلاح `drizzle.config.ts` عشان يشوف الـ schema كامل، وبناء
migration runner حقيقي مع baseline نظيف للهجرات.

---

## 5) فتح PR #169 + المتابعة الحية

- اتعمل commit تاني (`5ba0cf6`) بإضافة `SESSION_SUMMARY.md` نفسه للفرع.
- اتفتح **PR #169** (draft) على `main`:
  <https://github.com/sheiko0777/irth-os/pull/169>
  العنوان: *"Phase A (1/2): production boot foundations — auth secret, real health check, env docs"*.
  الوصف بيشرح السياق (التدقيق + قرار الشريحة الرأسية) والمتبقي في Phase A والقرارين
  المعلّقين.
- المستخدم فعّل المتابعة الحية (`subscribe_pr_activity`) — الجلسة دلوقتي بتستقبل أحداث الـ PR
  تلقائيًا (CI، تعليقات مراجعة) وهتتصرف فيها لحد ما الـ PR يتدمج أو يتقفل.
- تعليق بوت Supabase على الـ PR (تجاهل تلقائي لعدم وجود تغييرات في مجلد `supabase/`) — لا
  يحتاج أي إجراء، معلوماتي فقط.
- CI (`build` check) كان لسه شغّال وقت الكتابة؛ جدولنا متابعة تلقائية بعد ~8 دقايق للتأكد من
  نتيجته وتصحيح أي فشل لو حصل.

---

## 6) تنظيف الـ Pull Requests المكررة (109 PR)

طلب المستخدم "check repo and whole project" ثم "clean up the duplicate PRs first". اكتشفنا
إن المستودع فيه **~110 PR مفتوح**، الغالبية الساحقة منها بوتات آلية (Sentinel/Bolt/Jules)
بتكرر نفس الإصلاح لنفس المشكلة عشرات المرات. قبل قفل أي حاجة، اتعمل تحقق فعلي من كود `main`
(مش عنوان الـ PR) لكل فئة:

| الفئة | العدد | نتيجة التحقق |
|---|---|---|
| Timing attacks في webhooks | 17 | مُصلَّحة فعلاً (Aramex/Bosta/Paymob كلهم `timingSafeEqual` مع hashing) |
| JSON.parse DoS في webhooks | 36 | Aramex/Bosta مُصلَّحين؛ **Paymob كان لسه عرضة** (اتصلح لاحقًا في §7) |
| IDOR في categories/products | 7 | مُصلَّحة فعلاً (`ctx.orgId` في كل query) |
| Authorization bypass في order status | 5 | مُصلَّحة فعلاً (Better Auth session حقيقي + orgId من السيرفر) |
| مميزات قديمة من مايو (Phase 13-20) | 7 | نفس المميزات موجودة فعلاً في `main` بهيكلة مختلفة |
| تحسينات أداء N+1 مكررة | 37 | تكرار بحت لنفس التحسين، مش bugs، تأجيل آمن |

**109 PR اتقفلوا** (كل شيء ما عدا PR #169). التفاصيل الكاملة والمنهجية موجودة في نص المحادثة.

---

## 7) تقرير بحث هندسي شامل + إعادة صياغة الخطة بالكامل

المستخدم رفع ملف **"IRTH OS — Master Engineering Research Report"** (تقرير بحثي معمّق، مصادره
موثّقة: Veracode 2025، Apiiro، USENIX 2025، CVE-2025-48757، ETA SDK الرسمي، إلخ) وطلب تعديل
المشروع بناءً عليه.

**الخلاصة:** التقرير بيأكد نفس فجوات التدقيق السابق (فلوس float، مفيش idempotency، مفيش RLS،
outbox معطّل) لكنه بيقترح معمارية أعمق بكتير: فلوس كـ **integer minor units** (قروش) مع
`dinero.js`، **دفتر قيود مزدوج القيد غير قابل للتعديل** (ledger)، **RLS على كل جدول** كخط دفاع
تاني، **CASL policy layer**، ومنهجية **Spec Kit** (`/speckit.*`) لقيادة التطوير.

**قرار المستخدم (بعد سؤالين توضيحيين):**
1. **معمارية الفلوس**: التحويل الكامل دلوقتي لـ integer minor units + dinero.js (مش الحل
   السريع بـ decimal-safe فقط).
2. **حجم التقرير**: إعادة صياغة الخطة بالكامل حول مراحل التقرير (Phase 0 Foundations → Phase 1
   Accounting/Inventory → Phase 2 Order-to-cash → ...) بدل خطة A→F القديمة.

### التنفيذ الفعلي (commit `3a33255` على فرع `claude/phase-a-production-boot`)

**`@irth/utils/money`** (باكدج جديد بالكامل): المكان الوحيد المسموح فيه بحساب الفلوس. غلاف
حول `dinero.js` فوق EGP (100 وحدة صغرى = جنيه واحد). 10 اختبارات (منها حالة `0.1 + 0.2` float
الكلاسيكية) — واختبار واحد **كشف باگ حقيقي**: `decimalStringToMinor('1.2.3')` كان بيتم قصّه
بصمت لـ `1.2` بدل ما يرفض المدخل الخاطئ — تم إصلاحه فورًا.

**Migration `0028_money_minor_units.sql`** (مرحلة expand — إضافية فقط، مع backfill، الأعمدة
القديمة decimal فاضلة زي ما هي): إضافة أعمدة `_minor` (bigint) بجانب **كل** عمود فلوس عبر 8
جداول (products, product_variants, orders, order_items, courier_shipments/remittances,
price_list_items, order_returns/return_items, shipping_rates, gift_cards/transactions,
coupons.min_order_amount, purchase_orders/items). استثناءان متعمّدان وموثّقان: `coupons.value`
(نسبة أو مبلغ حسب `type` — مش فلوس بشكل قاطع) و`shipping_rates` min/max_weight (وزن مش فلوس).

**`apps/api/src/routes/orders.ts`** (إعادة كتابة كاملة — كان غير آمن بصمت):
- **atomicity حقيقية**: الطلب + بنوده + خصم المخزون + رقم الطلب كلهم دلوقتي جوه
  `db.transaction()` واحدة (كان `orderItems` بيتكتب **برا** الـ transaction تمامًا).
- **المخزون بيتخصم فعليًا الآن** — كان مبيتخصمش إطلاقًا. `UPDATE ... WHERE quantity >= qty`
  شرطي جوه الـ transaction؛ أي بند ناقص بيرجّع كل الطلب بالكامل (rollback).
- **رقم طلب ذري**: جدول `order_number_counters` جديد + UPSERT ذري، بدل `count(*) + 1` اللي
  كان فيه race condition وبيكرر الأرقام تحت الضغط، وكان الرقم "2026" مكتوب يدويًا بالكود.
- variant من غير سعر بيرفض الطلب (422) بدل ما يتباع مجانًا بصمت (كان `Number(null) === 0`).

**`apps/api/src/routes/webhooks/paymob.ts`** (تصليح 3 فجوات حقيقية مؤكدة):
- `JSON.parse` جوه try/catch (كان بدونها).
- **Idempotency** عبر جدول `payment_webhook_events` جديد — إعادة إرسال الـ webhook بقت no-op.
- البحث عن الطلب بـ **UUID** (يُرسل كـ `merchant_order_id`) بدل `orderNumber` اللي مش unique
  إلا لكل مستأجر لوحده — كان ممكن يأكّد طلب مستأجر غلط.
- **مطابقة المبلغ**: `amount_cents` بيتقارن بإجمالي الطلب قبل التأكيد — مش تصديق أعمى للـ webhook.

**`apps/api/src/services/eta.ts` + `orders.ts`** (فجوة idempotency فاتورة ETA اللي كانت موثّقة
في التدقيق الأصلي): جدول `eta_invoices` كان فيه unique index على `order_id` من الأساس بس محدش
كان بيستخدمه — الفاتورة كانت بتتبعت للمصلحة **في كل مرة** الطلب يتحدد كـ delivered. دلوقتي بيحجز
صف في `eta_invoices` أولاً (`ON CONFLICT DO NOTHING`)؛ لو خسر السباق يبقى فيه فاتورة شغالة
بالفعل. كمان استبدلنا `amount * 0.14` (float) بحساب VAT صحيح بالوحدات الصغرى.

**النتيجة:** كل الـ gates فاضلة خضراء (lint/typecheck/test عبر الـ 7 باكدجات، 226 اختبار).

**متعمّد تأجيله** (موثّق هنا عشان ما يتنساش): تحويل كود التطبيق الفعلي لـ
coupons/gift-cards/returns/purchasing/shipping لاستخدام أعمدة `_minor` الجديدة (الـ schema
جاهزة، الكود لسه بيقرا/يكتب decimal)؛ الـ ledger المزدوج القيد الكامل؛ RLS؛ CASL؛ Spec Kit.

---

## 8) خلاصة الحالة الحالية

- ✅ **Phase 1 (UI/UX)** — مكتمل ومدموج في `main` (PR #129).
- ✅ **إصلاح IDOR أمني** — مكتمل ومدموج في `main` (PR #128).
- ✅ **تنظيف الـ PRs** — 109 PR مكرر اتقفلوا، PR #169 هو الوحيد الشغّال.
- 🔄 **Phase A/B (Money + Order Integrity)** — أول شريحة من الخطة المعاد صياغتها حول التقرير
  البحثي، مدفوعة كـ commit جديد على **PR #169**. كل الـ gates خضراء (226 اختبار).
- ⏸️ **متوقف مؤقتًا** — نفس القرارين من قبل: حالة بيانات Supabase الحقيقية، وحساب Cloudflare
  للنشر الفعلي (Hyperdrive، migration runner على بيانات حقيقية).
- ⏳ **المتبقي من التقرير** — الـ ledger المزدوج القيد، RLS على كل جدول، CASL، Spec Kit، تعميم
  minor units على باقي الدومينات (coupons/gift cards/returns/purchasing/shipping)، ETA
  CAdES-BES signing، PDPL compliance، React Native mobile.
