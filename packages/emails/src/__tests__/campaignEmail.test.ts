import { describe, expect, it } from 'vitest';
import { renderCampaignEmail } from '../index';

describe('renderCampaignEmail', () => {
  it('renders the customer name and campaign message', async () => {
    const html = await renderCampaignEmail({
      customerName: 'محمد علي',
      message: 'خصم 20% على كل المنتجات هذا الأسبوع فقط.',
    });

    expect(html).toContain('محمد علي');
    expect(html).toContain('خصم 20% على كل المنتجات هذا الأسبوع فقط.');
  });

  it('escapes markup in an admin-authored campaign message instead of executing it', async () => {
    const html = await renderCampaignEmail({
      customerName: 'Test',
      message: '<script>alert(1)</script>',
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
