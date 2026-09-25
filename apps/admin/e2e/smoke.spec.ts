import { test, expect, type Page } from '@playwright/test';
import { BLOCKED_ORDER_NUMBER, BUYER_NAME, OWNER, UNMAPPED_LINE } from './fixture';

/**
 * The path an operator takes on day one, in a real browser against a real
 * build and database: sign in, read the dashboard, find the order that could
 * not be imported, see who bought it and what is missing, link the missing
 * line. If any of these screens fails to render or the flow breaks, CI goes
 * red before the owner finds out in production.
 */

async function signIn(page: Page) {
  await page.goto('/ar/login');
  await page.locator('input[type="email"]').fill(OWNER.email);
  await page.locator('input[type="password"]').fill(OWNER.password);
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await page.waitForURL(/\/ar\/?$/);
}

test('owner signs in and the dashboard shows net sales, not "profit"', async ({ page }) => {
  await signIn(page);
  await expect(page.getByText('صافي مبيعات اليوم')).toBeVisible();
  await expect(page.getByText('أرباح اليوم')).toHaveCount(0);
});

test('a blocked Shopify order is visible, complete, and can be resolved', async ({ page }) => {
  await signIn(page);

  // The orders list surfaces blocked imports above everything else.
  await page.goto('/ar/orders');
  const blockedLink = page.getByRole('link', { name: /الطلبات المتوقفة/ });
  await expect(blockedLink).toBeVisible();
  await blockedLink.click();
  await expect(page).toHaveURL(/blocked=1/);

  await page.getByRole('row', { name: new RegExp(BLOCKED_ORDER_NUMBER) }).getByRole('link', { name: 'عرض' }).click();

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
