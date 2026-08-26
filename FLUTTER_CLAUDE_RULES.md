# CLAUDE.md — قواعد تطوير مشروع أثر (Claude Code)

**Clean Code • Best Practices • Smart AI Rules**

> ⚠️ **Note on scope:** This file documents a Flutter/Dart rule set (Cubit/BLoC,
> GoRouter, `flutter analyze`) exactly as given. It is **not** wired into the
> `irth-os` repo's build or CI — this codebase is a TypeScript monorepo
> (Next.js admin, Hono API on Cloudflare Workers, Expo/React Native mobile),
> not Flutter. The repo's actual binding rules file is the root `CLAUDE.md`.
> Use this file as a standalone reference — e.g. for a separate Flutter
> project — or ask to have it merged/adapted into the real `CLAUDE.md` if
> that was the intent.

---

## 1. Feature-First Architecture

**تنظيم المشروع حسب Features**

Organize the project by feature, not by layer. Each feature owns its own
models, widgets, state, and logic — a feature can be understood, tested, and
removed without hunting across unrelated folders.

## 2. Cubit Default

**Cubit هو الاختيار الافتراضي، و BLoC للحالات المعقدة فقط**

Cubit is the default state-management choice. Reach for full BLoC only when a
feature's state transitions are genuinely complex enough to need explicit
event objects — not by default.

## 3. Reusable Widgets

**استخدم وأعد استخدام Widgets**

Build widgets to be reused. Before writing a new one, check whether an
existing widget already covers the need — extend it rather than duplicating
it.

## 4. DRY Principle

**منع تكرار الـ UI و الـ Business Logic**

Don't repeat UI or business logic. Duplicated code is duplicated bugs — the
same fix has to be found and applied in every copy.

## 5. Single Responsibility

**كل كلاس أو ويجت يجب أن تكون له مسؤولية واحدة فقط**

Every class or widget should have exactly one responsibility. If it's doing
two unrelated things, split it.

## 6. Separation of Business Logic & Data

**فصل الـ Business Logic عن الـ Data**

Keep business logic out of data-layer classes (repositories, data sources)
and out of the UI layer. Logic lives in the state-management layer (Cubit/
BLoC), not scattered across widgets or models.

## 7. Error Handling

**معالجة الأخطاء بوضوح بدل إخفائها**

Handle errors explicitly and visibly — surface them to the user or log them
meaningfully. Never swallow an exception silently; a hidden failure is worse
than a visible one.

## 8. Performance Rules

**استخدم const وقلل التحديثات والعمليات الثقيلة**

Use `const` constructors wherever possible. Minimize unnecessary rebuilds and
avoid heavy synchronous work on the UI thread.

## 9. UI & Theme Consistency

**التزم بالتصميم الموحد للتطبيق**

Follow the app's unified design system — consistent spacing, colors,
typography, and component styles across every screen.

## 10. Dependency Injection

**إدارة الاعتمادات بطريقة منظمة**

Manage dependencies in an organized way (e.g. via a DI container/service
locator) rather than constructing them ad hoc inside widgets or classes that
use them.

## 11. Navigation (GoRouter)

**استخدم نظام التنقل الموجود (GoRouter)**

Use the project's existing navigation system, GoRouter — don't introduce a
second, competing navigation approach.

## 12. Security & Privacy

**حماية البيانات وعدم وضع Secrets في الكود**

Protect user data. Never commit secrets, API keys, or credentials into the
codebase — use environment configuration instead.

## 13. Minimal Changes

**تغييرات بسيطة عند إصلاح الأخطاء**

When fixing a bug, make the smallest change that fixes it. Don't use a bugfix
as an opportunity to refactor unrelated code.

## 14. Git Scope Rules

**عدم تعديل ملفات غير مرتبطة بالمهمة**

Don't touch files unrelated to the current task. Keep each commit/PR scoped
to what it says it does.

## 15. Testing & Analyze

**flutter analyze والاختبارات المناسبة**

Run `flutter analyze` and write/run the appropriate tests (unit, widget,
integration as fitting) before considering work done.

## 16. AI Workflow

**يفهم ← يخطط ← ينفذ ← يختبر ← يراجع**

Understand → Plan → Implement → Test → Review. Don't jump straight to code
without understanding the request and planning the approach first, and don't
call it done without testing and a final review pass.

---

## 🎯 Golden Rule

**إستخدم الموجود قبل إنشاء أي شيء جديد**

**Reuse → Extend → Extract → Create**

Before creating anything new, check what already exists. Reuse it if it
fits; extend it if it almost fits; extract a shared piece if the need
recurs; only create something new when none of the above applies.
