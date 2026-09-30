import { describe, expect, it } from 'vitest';
import { blockedReasonFor, snapshotShopifyOrder, type ShopifyOrderPayload } from '../services/shopifyOrderImport';

const BASE: ShopifyOrderPayload = {
  id: 1,
  name: '#1001',
  financial_status: 'pending',
  cancelled_at: null,
  currency: 'EGP',
  total_price: '1150.00',
  line_items: [],
};

describe('snapshotShopifyOrder', () => {
  it('captures buyer, addresses, note and every money field as bigint minor units', () => {
    const snap = snapshotShopifyOrder({
      ...BASE,
      email: 'mona@example.com',
      phone: null,
      note: '  اتصل قبل التوصيل  ',
      subtotal_price: '1000.00',
      total_discounts: '50.5',
      total_tax: '140.00',
      total_shipping_price_set: { shop_money: { amount: '60.00' } },
      customer: { id: 7, first_name: 'Mona', last_name: 'Ali', phone: '+201000000000' },
      shipping_address: { first_name: 'Mona', last_name: 'Ali', address1: '12 El Tahrir', city: 'Cairo', country: 'Egypt', phone: '+201111111111' },
    });

    expect(snap.buyer).toEqual({ name: 'Mona Ali', email: 'mona@example.com', phone: '+201000000000' });
    expect(snap.shippingAddress).toMatchObject({ name: 'Mona Ali', address1: '12 El Tahrir', city: 'Cairo', phone: '+201111111111' });
    expect(snap.billingAddress).toBeNull();
    expect(snap.subtotalMinor).toBe(100000n);
    expect(snap.discountMinor).toBe(5050n);
    expect(snap.taxMinor).toBe(14000n);
    expect(snap.shippingMinor).toBe(6000n);
    expect(snap.customerNote).toBe('اتصل قبل التوصيل');
  });

  it('records a missing or malformed amount as unknown, never as zero', () => {
    const snap = snapshotShopifyOrder({ ...BASE, subtotal_price: 'abc', total_discounts: null });
    expect(snap.subtotalMinor).toBeNull();
    expect(snap.discountMinor).toBeNull();
    expect(snap.shippingMinor).toBeNull();
    expect(snap.taxMinor).toBeNull();
  });

  it('bounds free text before it is stored', () => {
    const snap = snapshotShopifyOrder({ ...BASE, note: 'x'.repeat(5000) });
    expect(snap.customerNote).toHaveLength(2000);
  });
});

describe('blockedReasonFor', () => {
  it('names the unmapped lines and caps the list', () => {
    const lines = Array.from({ length: 12 }, (_, i) => ({ label: `Item ${i}`, shopifyVariantId: null, quantity: 1 }));
    const reason = blockedReasonFor(lines);
    expect(reason).toContain('Item 0');
    expect(reason).toContain('Item 9');
    expect(reason).not.toContain('Item 10');
    expect(reason).toContain('(+2)');
  });
});
