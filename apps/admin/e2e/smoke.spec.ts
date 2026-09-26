import { test, expect, type Page } from '@playwright/test';
import {
  BLOCKED_ORDER_NUMBER, BUYER_NAME, COD_ORDER_NUMBER, DRIVER_PASSWORD, DRIVER_USERNAME, OWNER, OWNER_STATE, REP_NEW_PASSWORD, REP_USERNAME,
  SALES_CUSTOMER, SALES_PRICE_LIST, SELLER_PASSWORD, SELLER_USERNAME, UNMAPPED_LINE,
} from './fixture';

/**
 * The path an operator takes on day one, in a real browser against a real
 * build and database: sign in, read the dashboard, find the order that could
 * not be imported, see who bought it and what is missing, link the missing
 * line. If any of these screens fails to render or the flow breaks, CI goes
 * red before the owner finds out in production.
 */

async function signIn(page: Page, identifier = OWNER.email, password = OWNER.password) {
  await page.goto('/ar/login');
  await page.getByLabel('البريد الإلكتروني أو اسم المستخدم').fill(identifier);
  await page.getByLabel('كلمة المرور').fill(password);
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
}

async function signInAsOwner(page: Page) {
  await signIn(page);
  await page.waitForURL(/\/ar\/?$/);
}

test.describe('signing in through the form', () => {
  // A fresh browser, not the owner state the other tests start from.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('owner signs in and the dashboard shows net sales, not "profit"', async ({ page }) => {
    await signInAsOwner(page);
    await expect(page.getByText('صافي مبيعات اليوم')).toBeVisible();
    await expect(page.getByText('أرباح اليوم')).toHaveCount(0);
  });
});

test('a blocked Shopify order is visible, complete, and can be resolved', async ({ page }) => {

  // The orders list surfaces blocked imports above everything else.
  await page.goto('/ar/orders');
  const blockedLink = page.getByRole('link', { name: /الطلبات المتوقفة/ });
  await expect(blockedLink).toBeVisible();
  await expect(blockedLink).toHaveAttribute('href', /blocked=1/);

  // Navigate by full page loads, not by clicking. On the slower CI runner a
  // click on a Next <Link> can land while the router is still settling (after
  // hydration or a pending transition) and be dropped: the link takes focus
  // and the page never leaves the list. Seen twice, never locally. What this
  // test proves is that the list shows the blocked order and links to it, so
  // assert the link, then follow it.
  await page.goto('/ar/orders?blocked=1');
  const orderLink = page.getByRole('row', { name: new RegExp(BLOCKED_ORDER_NUMBER) }).getByRole('link', { name: 'عرض' });
  await expect(orderLink).toHaveAttribute('href', /\/ar\/orders\/[0-9a-f-]{36}$/);
  await page.goto(await orderLink.getAttribute('href') ?? '');
  await expect(page).toHaveURL(/\/ar\/orders\/[0-9a-f-]{36}$/);

  // The order page: why it is blocked, who bought it, every line as received.
  await expect(page.getByRole('alert').getByText('الطلب متوقف')).toBeVisible();
  await expect(page.getByText(BUYER_NAME).first()).toBeVisible();
  await expect(page.getByText('12 شارع التحرير', { exact: false })).toBeVisible();
  await expect(page.getByRole('cell', { name: UNMAPPED_LINE })).toBeVisible();

  // Link the missing line to its local variant and queue the re-import.
  const mapSelect = page.getByLabel(`اربط بـ ${UNMAPPED_LINE}`);
  await mapSelect.selectOption({ label: 'سيروم — 50 مل (E2E-SERUM-50)' });
  await page.getByRole('button', { name: 'اربط وأعد الاستيراد' }).click();
  await expect(page.getByText('تم الربط')).toBeVisible();
});

test('the owner builds a role on the roles screen and it is listed with its permissions', async ({ page }) => {
  await page.goto('/ar/settings/roles');

  // The three system roles are there and cannot be edited, only viewed.
  const cards = page.getByTestId('role-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.filter({ hasText: 'مدير' }).getByRole('button', { name: 'عرض الصلاحيات' })).toBeVisible();

  await page.getByRole('button', { name: 'دور جديد' }).click();
  await page.getByLabel('اسم الدور').fill('أمين مخزن');
  await page.getByLabel('المخزون والجرد: عرض').check();
  await page.getByLabel('المخزون والجرد: إضافة وتعديل').check();
  await page.getByLabel('الطلبات: عرض').check();
  await page.getByRole('button', { name: 'حفظ الدور' }).click();

  const created = cards.filter({ hasText: 'أمين مخزن' });
  await expect(created).toBeVisible();
  await expect(created).toContainText('3 صلاحية');
  await expect(created).toContainText('0 عضو');
});

test('the owner creates an account by mobile number; the person signs in with it and must set their own password', async ({ page }) => {
  await page.goto('/ar/settings/members');
  await page.getByLabel('الاسم', { exact: true }).fill('مندوب الاختبار');
  await page.getByLabel('اسم المستخدم أو رقم الموبايل').fill(REP_USERNAME);
  await page.locator('#account-role').selectOption({ label: 'موظف — موظف' });
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click();
  const temporary = (await page.getByTestId('temp-password').textContent())?.trim() ?? '';
  expect(temporary).toMatch(/^[A-Za-z0-9]{12}$/);

  // Their first sign-in, by username, lands on the change-password page — not the app.
  await page.context().clearCookies();
  await signIn(page, REP_USERNAME, temporary);
  await page.waitForURL(/\/ar\/change-password$/);
  // And the app stays closed to them until they do: a direct link bounces back.
  await page.goto('/ar/orders');
  await page.waitForURL(/\/ar\/change-password$/);
  await page.getByLabel('كلمة السر المؤقتة').fill(temporary);
  await page.getByLabel('كلمة السر الجديدة', { exact: true }).fill(REP_NEW_PASSWORD);
  await page.getByLabel('أكّد كلمة السر الجديدة').fill(REP_NEW_PASSWORD);
  await page.getByRole('button', { name: 'احفظ كلمة السر' }).click();
  await page.waitForURL(/\/ar\/?$/);
  await expect(page.getByText('صافي مبيعات اليوم')).toBeVisible();

  // A موظف's sidebar has no finance or roles screens (PR-1e) — and a direct
  // link to finance shows "no access" rather than the page.
  const nav = page.getByRole('navigation', { name: 'التنقل الرئيسي' });
  await expect(nav.getByRole('link', { name: 'الطلبات', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'المالية', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'الأدوار والصلاحيات' })).toHaveCount(0);
  await page.goto('/ar/finance');
  await expect(page.getByText('مالكش صلاحية على الشاشة دي')).toBeVisible();
});

test('a delivery rep delivers a cash order, collects it and hands the cash over; the office counts it', async ({ page, browser }) => {
  // The owner makes the rep: a role from the template, then the account.
  await page.goto('/ar/settings/roles');
  await page.getByRole('button', { name: 'قالب مندوب توصيل' }).click();
  await page.getByRole('button', { name: 'حفظ الدور' }).click();
  await expect(page.getByTestId('role-card').filter({ hasText: 'مندوب توصيل' })).toBeVisible();

  await page.goto('/ar/settings/members');
  await page.getByLabel('الاسم', { exact: true }).fill('سواق الاختبار');
  await page.getByLabel('اسم المستخدم أو رقم الموبايل').fill(DRIVER_USERNAME);
  await page.locator('#account-role').selectOption({ label: 'مندوب توصيل — مندوب توصيل' });
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click();
  const temporary = (await page.getByTestId('temp-password').textContent())?.trim() ?? '';

  // …and assigns them the cash order from the orders list.
  await page.goto('/ar/orders');
  await page.getByLabel(new RegExp(COD_ORDER_NUMBER)).check();
  await page.getByLabel('إسناد لمندوب').selectOption({ label: 'سواق الاختبار' });
  await page.getByRole('button', { name: 'إسناد', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: COD_ORDER_NUMBER })).toContainText('سواق الاختبار');

  // The rep signs in (Better Auth allows 3 sign-ins per 10 s; the tests above used them).
  await page.waitForTimeout(10_500);
  await page.context().clearCookies();
  await signIn(page, DRIVER_USERNAME, temporary);
  await page.waitForURL(/\/ar\/change-password$/);
  await page.getByLabel('كلمة السر المؤقتة').fill(temporary);
  await page.getByLabel('كلمة السر الجديدة', { exact: true }).fill(DRIVER_PASSWORD);
  await page.getByLabel('أكّد كلمة السر الجديدة').fill(DRIVER_PASSWORD);
  await page.getByRole('button', { name: 'احفظ كلمة السر' }).click();

  // Their home is their deliveries, and that is all their sidebar offers.
  await page.waitForURL(/\/ar\/rep$/);
  const nav = page.getByRole('navigation', { name: 'التنقل الرئيسي' });
  await expect(nav.getByRole('link', { name: 'توصيلاتي' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'الطلبات', exact: true })).toHaveCount(0);

  const card = page.getByTestId('rep-order').filter({ hasText: COD_ORDER_NUMBER });
  await expect(card).toContainText('5 شارع النيل');
  await card.getByRole('button', { name: 'تم التسليم' }).click();
  await expect(card.getByLabel('المبلغ المحصّل (ج.م)')).toHaveValue('500.00');
  await card.getByRole('button', { name: 'تأكيد التسليم والتحصيل' }).click();
  await expect(page.getByTestId('rep-order')).toHaveCount(0);
  await expect(page.getByTestId('rep-cash-total')).toContainText('500');

  await page.getByRole('button', { name: 'تسليم العهدة' }).click();
  await expect(page.getByText('مستني المكتب يعدّ')).toBeVisible();

  // The office counts it.
  const office = await browser.newContext({ storageState: OWNER_STATE });
  const officePage = await office.newPage();
  await officePage.goto('/ar/rep-cash');
  const row = officePage.getByTestId('handover-row').first();
  await row.getByRole('button', { name: 'تأكيد الاستلام' }).click();
  await expect(row.getByRole('button', { name: 'تأكيد الاستلام' })).toHaveCount(0);
  await expect(row).toContainText('500');
  await office.close();
});

test('a sales rep sells to their own customer at their price list, and turns a quote into an order', async ({ page }) => {
  await page.goto('/ar/settings/roles');
  await page.getByRole('button', { name: 'قالب مندوب مبيعات' }).click();
  await page.getByRole('button', { name: 'حفظ الدور' }).click();
  await expect(page.getByTestId('role-card').filter({ hasText: 'مندوب مبيعات' })).toBeVisible();

  await page.goto('/ar/settings/members');
  await page.getByLabel('الاسم', { exact: true }).fill('بياع الاختبار');
  await page.getByLabel('اسم المستخدم أو رقم الموبايل').fill(SELLER_USERNAME);
  await page.locator('#account-role').selectOption({ label: 'مندوب مبيعات — مندوب مبيعات' });
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click();
  const temporary = (await page.getByTestId('temp-password').textContent())?.trim() ?? '';

  // The office hands them the customer.
  await page.goto('/ar/customers');
  const repSelect = page.getByLabel(`مندوب مبيعات ${SALES_CUSTOMER}`);
  await repSelect.selectOption({ label: 'بياع الاختبار' });
  await expect(page.getByText('اتغيّر مندوب المبيعات')).toBeVisible();

  // Better Auth allows 3 sign-ins per 10 s; the tests above used them.
  await page.waitForTimeout(10_500);
  await page.context().clearCookies();
  await signIn(page, SELLER_USERNAME, temporary);
  await page.waitForURL(/\/ar\/change-password$/);
  await page.getByLabel('كلمة السر المؤقتة').fill(temporary);
  await page.getByLabel('كلمة السر الجديدة', { exact: true }).fill(SELLER_PASSWORD);
  await page.getByLabel('أكّد كلمة السر الجديدة').fill(SELLER_PASSWORD);
  await page.getByRole('button', { name: 'احفظ كلمة السر' }).click();
  await page.waitForURL(/\/ar\/sales$/);

  // Their customer and their price list; the server's price: 250.00 less 10%.
  await page.getByRole('combobox', { name: 'العميل', exact: true }).selectOption({ label: SALES_CUSTOMER });
  await page.getByRole('combobox', { name: 'قائمة الأسعار' }).selectOption({ label: SALES_PRICE_LIST });
  await page.getByLabel('كمية E2E-SERUM-30').fill('2');
  await expect(page.getByTestId('sale-preview-total')).toContainText('450.00');
  await page.getByRole('button', { name: 'إنشاء الطلب' }).click();
  await expect(page.getByText(/اتعمل الطلب IRT-/)).toBeVisible();
  await expect(page.getByTestId('sales-orders')).toContainText('450.00');

  // A quote, then the order from it.
  await page.getByRole('combobox', { name: 'العميل', exact: true }).selectOption({ label: SALES_CUSTOMER });
  await page.getByLabel('كمية E2E-SERUM-30').fill('1');
  await page.getByRole('button', { name: 'حفظ كعرض سعر' }).click();
  await expect(page.getByText(/اتحفظ عرض السعر QT-/)).toBeVisible();
  await page.getByTestId('sales-quotes').getByRole('button', { name: 'تحويل لطلب' }).first().click();
  await expect(page.getByTestId('sales-quotes')).toContainText('اتحوّل لطلب');
});
