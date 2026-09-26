import { test as setup, expect } from '@playwright/test';
import postgres from 'postgres';
import {
  BLOCKED_ORDER_NUMBER, BUYER_NAME, COD_ORDER_NUMBER, DRIVER_USERNAME, LINKED_GID, ORG_SLUG, OWNER, OWNER_STATE, REP_USERNAME,
  SALES_CUSTOMER, SALES_PRICE_LIST, SELLER_USERNAME, UNMAPPED_LINE,
} from './fixture';

/**
 * Creates the owner through the app's own Better Auth sign-up endpoint (so the
 * password hash and account rows are exactly what production writes), then
 * gives them an org and the data the smoke test walks through: one product
 * with two variants — one linked to Shopify, one not — and a Shopify order
 * that arrived BLOCKED because its second line had no local match (0073).
 *
 * Re-runnable: a second run resets the scenario rather than duplicating it.
 */
setup('seed an owner, an org and a blocked Shopify order', async ({ request }) => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must point at a disposable database for the e2e suite.');

  const signUp = await request.post('/api/auth/sign-up/email', {
    data: { name: OWNER.name, email: OWNER.email, password: OWNER.password },
    headers: { origin: 'http://localhost:3100' },
  });
  // 200 on first run; an existing user is fine on a re-run.
  expect([200, 422].includes(signUp.status()) || (await signUp.text()).includes('already')).toBeTruthy();

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const [user] = await sql<{ id: string }[]>`SELECT id FROM "user" WHERE email = ${OWNER.email}`;
    expect(user, 'sign-up did not create the user').toBeTruthy();

    const [org] = await sql<{ id: string }[]>`
      INSERT INTO organizations (name, slug) VALUES ('متجر الاختبار', ${ORG_SLUG})
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id`;
    await sql`
      INSERT INTO org_members (org_id, user_id, role) VALUES (${org.id}, ${user.id}, 'owner')
      ON CONFLICT (org_id, user_id) DO NOTHING`;
    // Accounts and roles a previous run created through the members and
    // roles screens.
    // A rep's delivery and cash history is kept attached to them (0077), so
    // it goes first; the ledger entries it posted stay, as they would.
    await sql`DELETE FROM rep_cash_collections WHERE org_id = ${org.id}`;
    await sql`DELETE FROM rep_cash_handovers WHERE org_id = ${org.id}`;
    await sql`DELETE FROM delivery_attempts WHERE org_id = ${org.id}`;
    await sql`DELETE FROM org_members WHERE user_id IN (SELECT id FROM "user" WHERE username IN (${REP_USERNAME}, ${DRIVER_USERNAME}, ${SELLER_USERNAME}))`;
    await sql`DELETE FROM "user" WHERE username IN (${REP_USERNAME}, ${DRIVER_USERNAME}, ${SELLER_USERNAME})`;

    // The sales rep flow (PR-2b): a customer with no rep yet, and an active
    // 10% price list. Kept across runs; the rep is re-assigned each time.
    const [salesCustomer] = await sql`SELECT id FROM customers WHERE org_id = ${org.id} AND name = ${SALES_CUSTOMER}`;
    if (salesCustomer) {
      await sql`UPDATE customers SET sales_rep_member_id = NULL WHERE id = ${salesCustomer.id}`;
    } else {
      await sql`INSERT INTO customers (org_id, name, phone, address) VALUES (${org.id}, ${SALES_CUSTOMER}, '+201000000002', '10 شارع الجمهورية، المنصورة')`;
    }
    const [salesList] = await sql`SELECT id FROM price_lists WHERE org_id = ${org.id} AND name = ${SALES_PRICE_LIST}`;
    if (!salesList) {
      await sql`INSERT INTO price_lists (org_id, name, currency, discount_bp) VALUES (${org.id}, ${SALES_PRICE_LIST}, 'EGP', 1000)`;
    }
    await sql`DELETE FROM access_roles WHERE org_id = ${org.id} AND system_key IS NULL`;

    // A cash-on-delivery order out for delivery, for the delivery rep flow.
    // A previous run delivered it and booked its sale, which can happen once
    // per order (0049), so that order is retired under another number — never
    // deleted, like any order with ledger history — and a fresh one is made.
    await sql`
      UPDATE orders SET order_number = 'E2E-DELIVERED-' || extract(epoch from now())::bigint
      WHERE org_id = ${org.id} AND order_number = ${COD_ORDER_NUMBER}`;
    await sql`
      INSERT INTO orders (org_id, order_number, status, payment_method, total_amount_minor, currency, buyer, shipping_address)
      VALUES (
        ${org.id}, ${COD_ORDER_NUMBER}, 'shipped', 'cod', 50000, 'EGP',
        ${sql.json({ name: 'أحمد سمير', email: null, phone: '+201000000001' })},
        ${sql.json({ name: 'أحمد سمير', phone: '+201000000001', address1: '5 شارع النيل', address2: null, city: 'الجيزة', province: null, zip: null, country: 'Egypt' })}
      )`;

    // Re-runnable against the same database: put the scenario back to its
    // starting state (the unlinked variant unlinked, the order blocked, no
    // queued re-import) instead of skipping, or a second local run would start
    // from what the first one left behind.
    const [existing] = await sql`SELECT id FROM orders WHERE org_id = ${org.id} AND order_number = ${BLOCKED_ORDER_NUMBER}`;
    if (existing) {
      await sql`UPDATE product_variants SET shopify_variant_id = NULL WHERE org_id = ${org.id} AND sku = 'E2E-SERUM-50'`;
      await sql`UPDATE orders SET import_status = 'blocked', status = 'confirmed' WHERE id = ${existing.id}`;
      await sql`DELETE FROM outbox_events WHERE org_id = ${org.id}`;
      // Orders placed by an earlier run took stock; put it back.
      await sql`UPDATE inventory_items SET quantity = 20 WHERE org_id = ${org.id}`;
      return;
    }

    const [product] = await sql<{ id: string }[]>`
      INSERT INTO products (org_id, name, sku, price_minor, currency)
      VALUES (${org.id}, 'سيروم', 'E2E-SERUM', 25000, 'EGP') RETURNING id`;
    const [linked] = await sql<{ id: string }[]>`
      INSERT INTO product_variants (org_id, product_id, name, sku, price_minor, shopify_variant_id)
      VALUES (${org.id}, ${product.id}, '30 مل', 'E2E-SERUM-30', 25000, ${LINKED_GID}) RETURNING id`;
    const [unlinked] = await sql<{ id: string }[]>`
      INSERT INTO product_variants (org_id, product_id, name, sku, price_minor)
      VALUES (${org.id}, ${product.id}, '50 مل', 'E2E-SERUM-50', 40000) RETURNING id`;
    await sql`
      INSERT INTO inventory_items (org_id, variant_id, quantity)
      VALUES (${org.id}, ${linked.id}, 20), (${org.id}, ${unlinked.id}, 20)`;

    const payload = {
      id: 7700001,
      name: '#7701',
      line_items: [
        { variant_id: 7001, sku: 'S30', name: 'سيروم 30 مل', quantity: 2, price: '250.00' },
        { variant_id: 7002, sku: 'S50', name: UNMAPPED_LINE, quantity: 1, price: '400.00' },
      ],
    };
    await sql`
      INSERT INTO orders (
        org_id, order_number, status, total_amount_minor, currency, shopify_order_id,
        import_status, blocked_reason, source_payload, buyer, shipping_address,
        subtotal_minor, shipping_minor
      ) VALUES (
        ${org.id}, ${BLOCKED_ORDER_NUMBER}, 'confirmed', 96000, 'EGP', 'gid://shopify/Order/7700001',
        'blocked', ${`بنود غير مربوطة بمنتج في النظام: ${UNMAPPED_LINE}`}, ${sql.json(payload)},
        ${sql.json({ name: BUYER_NAME, email: 'mona@example.com', phone: '+201000000000' })},
        ${sql.json({ name: BUYER_NAME, phone: '+201000000000', address1: '12 شارع التحرير', address2: null, city: 'القاهرة', province: null, zip: null, country: 'Egypt' })},
        90000, 6000
      )`;
  } finally {
    await sql.end();
  }
});

setup('sign the owner in once for the tests that start signed in', async ({ request }) => {
  const res = await request.post('/api/auth/sign-in/email', {
    data: { email: OWNER.email, password: OWNER.password },
    headers: { origin: 'http://localhost:3100' },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  await request.storageState({ path: OWNER_STATE });
});
