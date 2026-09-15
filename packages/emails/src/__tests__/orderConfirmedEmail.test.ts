import { describe, expect, it } from 'vitest';
import { renderOrderConfirmedEmail } from '../index';

describe('renderOrderConfirmedEmail', () => {
  it('renders the customer name, order number, and RTL Arabic layout', async () => {
    const html = await renderOrderConfirmedEmail({
      customerName: 'سارة أحمد',
      orderNumber: 'ORD-1042',
    });

    expect(html).toContain('سارة أحمد');
    expect(html).toContain('ORD-1042');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
  });

  it('escapes a customer name containing markup instead of injecting it as HTML', async () => {
    const html = await renderOrderConfirmedEmail({
      customerName: '<img src=x onerror=alert(1)>',
      orderNumber: 'ORD-1',
    });

    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });
});
