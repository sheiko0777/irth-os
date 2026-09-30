/** PR-1e: the Worker API strips sensitive fields with the admin's rule table. */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { effectiveAccess, type EffectiveAccess } from '@irth/db';
import { apiRulePath, redactResponse } from '../middlewares/redactResponse';

function app(access: EffectiveAccess) {
  const a = new Hono();
  a.use('*', async (c, next) => { c.set('access', access); await next(); });
  a.use('/api/*', redactResponse());
  a.get('/api/orders/:id', (c) => c.json({ data: { id: 'o1', totalAmountMinor: '11400', phone: '0100', shippingAddress: { city: 'القاهرة' } } }));
  a.get('/api/inventory', (c) => c.json({ data: [{ id: 'i1', averageCostMinor: '700', quantity: 3 }] }));
  return a;
}

describe('redactResponse', () => {
  it('maps request paths onto procedure paths', () => {
    expect(apiRulePath('/api/orders/abc')).toBe('orders.abc');
    expect(apiRulePath('/api/products')).toBe('products.');
    expect(apiRulePath('/health')).toBeNull();
  });

  it('a موظف loses cost but keeps customer contact; a revoked contact disappears too', async () => {
    const member = effectiveAccess({ systemKey: 'member' });
    expect(await (await app(member).request('/api/inventory')).json()).toEqual({ data: [{ id: 'i1', quantity: 3 }] });
    expect(await (await app(member).request('/api/orders/o1')).json()).toMatchObject({ data: { phone: '0100' } });

    const noContact = effectiveAccess({ systemKey: 'member', overrides: { revoke: { sensitive: ['customerContact'] } } });
    expect(await (await app(noContact).request('/api/orders/o1')).json()).toEqual({ data: { id: 'o1', totalAmountMinor: '11400' } });
  });

  it('an admin gets everything', async () => {
    const res = await app(effectiveAccess({ systemKey: 'admin' })).request('/api/inventory');
    expect(await res.json()).toEqual({ data: [{ id: 'i1', averageCostMinor: '700', quantity: 3 }] });
  });
});
