import { test as setup, expect } from '@playwright/test';
import postgres from 'postgres';
import {
  BLOCKED_ORDER_NUMBER, BUYER_NAME, LINKED_GID, ORG_SLUG, OWNER, UNMAPPED_LINE,
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
    // Roles a previous run created through the roles screen.
    await sql`DELETE FROM access_roles WHERE org_id = ${org.id} AND system_key IS NULL`;

    // Re-runnable against the same database: put the scenario back to its
    // starting state (the unlinked variant unlinked, the order blocked, no
    // queued re-import) instead of skipping, or a second local run would start
    // from what the first one left behind.
    const [existing] = await sql`SELECT id FROM orders WHERE org_id = ${org.id} AND order_number = ${BLOCKED_ORDER_NUMBER}`;
    if (existing) {
      await sql`UPDATE product_variants SET shopify_variant_id = NULL WHERE org_id = ${org.id} AND sku = 'E2E-SERUM-50'`;
      await sql`UPDATE orders SET import_status = 'blocked', status = 'confirmed' WHERE id = ${existing.id}`;
      await sql`DELETE FROM outbox_events WHERE org_id = ${org.id}`;
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
