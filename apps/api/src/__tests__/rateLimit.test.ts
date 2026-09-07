import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { rateLimit } from '../middlewares/rateLimit';

describe('rateLimit middleware', () => {
  it('maintains independent limits for different route instances', async () => {
    const app = new Hono();
    
    // Route 1 with max=2
    app.get('/route1', rateLimit(2, 60_000, 0), (c) => c.text('ok1'));
    // Route 2 with max=5
    app.get('/route2', rateLimit(5, 60_000, 0), (c) => c.text('ok2'));

    // Exhaust route1 limit
    const req1_1 = new Request('http://localhost/route1', { headers: { 'CF-Connecting-IP': '1.2.3.4' } });
    const req1_2 = new Request('http://localhost/route1', { headers: { 'CF-Connecting-IP': '1.2.3.4' } });
    const req1_3 = new Request('http://localhost/route1', { headers: { 'CF-Connecting-IP': '1.2.3.4' } });
    
    let res = await app.request(req1_1);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('1');
    
    res = await app.request(req1_2);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    
    res = await app.request(req1_3);
    expect(res.status).toBe(429); // Exceeded route1

    // But route2 should still be completely fine for the SAME IP
    const req2_1 = new Request('http://localhost/route2', { headers: { 'CF-Connecting-IP': '1.2.3.4' } });
    res = await app.request(req2_1);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('4'); // 5 - 1
  });

  it('enforces single limit behavior correctly', async () => {
    const app = new Hono();
    app.get('/limit', rateLimit(3, 60_000, 0), (c) => c.text('ok'));

    const ip = '10.0.0.1';
    
    // req 1
    let res = await app.request(new Request('http://localhost/limit', { headers: { 'CF-Connecting-IP': ip } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('3');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('2');

    // req 2
    res = await app.request(new Request('http://localhost/limit', { headers: { 'CF-Connecting-IP': ip } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('1');

    // req 3
    res = await app.request(new Request('http://localhost/limit', { headers: { 'CF-Connecting-IP': ip } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');

    // req 4 - blocked
    res = await app.request(new Request('http://localhost/limit', { headers: { 'CF-Connecting-IP': ip } }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ data: null, error: 'Too Many Requests', meta: null });
    const retryAfter = res.headers.get('Retry-After');
    expect(retryAfter).toMatch(/^\d+$/);
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it('keeps /chat budgets independent for different organizations sharing an IP', async () => {
    const app = new Hono();
    app.use('/chat', async (c, next) => {
      c.set('orgId', c.req.header('X-Org-ID'));
      await next();
    });
    app.post('/chat', rateLimit(2, 60_000, 0, (c) => c.get('orgId') as string | undefined), (c) => c.text('ok'));

    const requestFor = (orgId: string) => new Request('http://localhost/chat', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '10.0.0.1', 'X-Org-ID': orgId },
    });

    expect((await app.request(requestFor('org-a'))).status).toBe(200);
    expect((await app.request(requestFor('org-a'))).status).toBe(200);
    expect((await app.request(requestFor('org-a'))).status).toBe(429);
    expect((await app.request(requestFor('org-b'))).status).toBe(200);
  });

  describe('IP resolution logic', () => {
    it('uses CF-Connecting-IP if present', async () => {
      const app = new Hono();
      app.get('/ip', rateLimit(1, 60_000, 0), (c) => c.text('ok'));
      
      const res = await app.request(new Request('http://localhost/ip', { 
        headers: { 
          'CF-Connecting-IP': '9.9.9.9',
          'X-Forwarded-For': '8.8.8.8' // Should be ignored
        } 
      }));
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');

      // Another request with same CF-Connecting-IP should be blocked
      const res2 = await app.request(new Request('http://localhost/ip', { 
        headers: { 
          'CF-Connecting-IP': '9.9.9.9'
        } 
      }));
      expect(res2.status).toBe(429);
      
      // Another request with different CF-Connecting-IP should pass
      const res3 = await app.request(new Request('http://localhost/ip', { 
        headers: { 
          'CF-Connecting-IP': '10.10.10.10'
        } 
      }));
      expect(res3.status).toBe(200);
    });

    it('falls back to "unknown" bucket if no CF-Connecting-IP and trusted proxies = 0', async () => {
      const app = new Hono();
      app.get('/ip', rateLimit(1, 60_000, 0), (c) => c.text('ok'));
      
      // Req 1 (no IP headers)
      let res = await app.request(new Request('http://localhost/ip'));
      expect(res.status).toBe(200);

      // Req 2 (has X-Forwarded-For, but trusted proxies = 0, so it goes to "unknown")
      res = await app.request(new Request('http://localhost/ip', {
        headers: { 'X-Forwarded-For': '1.2.3.4' }
      }));
      expect(res.status).toBe(429); // Blocks because "unknown" limit is 1
    });

    it('uses correct hop from X-Forwarded-For when trusted proxies > 0', async () => {
      const app = new Hono();
      app.get('/ip', rateLimit(1, 60_000, 2), (c) => c.text('ok'));
      
      // Client (1.1.1.1) -> Proxy1 (2.2.2.2) -> Proxy2 (3.3.3.3) -> Us
      // X-Forwarded-For: 1.1.1.1, 2.2.2.2, 3.3.3.3
      // trustedProxies = 2.
      // ips array = ['1.1.1.1', '2.2.2.2', '3.3.3.3']
      // ips.length (3) >= trustedProxies (2).
      // key = ips[3 - 2] = ips[1] = '2.2.2.2'. Wait, let's trace logic:
      // "Trust the rightmost `trustedProxies` hops... take the IP recorded by the outermost trusted hop."
      // Code: ips.length >= trustedProxies ? ips[ips.length - trustedProxies] : ips[0];
      // ips.length = 3. 3 >= 2. ips[3 - 2] = ips[1] = '2.2.2.2'. (Outermost trusted proxy recorded the client IP or next proxy)
      
      const req = new Request('http://localhost/ip', {
        headers: { 'X-Forwarded-For': '1.1.1.1, 2.2.2.2, 3.3.3.3' }
      });
      let res = await app.request(req);
      expect(res.status).toBe(200);

      // A request that shares 2.2.2.2 at that position should be blocked
      const req2 = new Request('http://localhost/ip', {
        headers: { 'X-Forwarded-For': '4.4.4.4, 2.2.2.2, 3.3.3.3' } // '4.4.4.4' spoofed client, but outermost trusted recorded 2.2.2.2
      });
      res = await app.request(req2);
      expect(res.status).toBe(429);
      
      // A request with a different IP at that position should pass
      const req3 = new Request('http://localhost/ip', {
        headers: { 'X-Forwarded-For': '1.1.1.1, 5.5.5.5, 3.3.3.3' }
      });
      res = await app.request(req3);
      expect(res.status).toBe(200);
    });
    
    it('uses ips[0] from X-Forwarded-For when trusted proxies > hops', async () => {
      const app = new Hono();
      app.get('/ip', rateLimit(1, 60_000, 5), (c) => c.text('ok'));
      
      const req = new Request('http://localhost/ip', {
        headers: { 'X-Forwarded-For': '10.0.0.1, 10.0.0.2' }
      });
      let res = await app.request(req);
      expect(res.status).toBe(200);
      
      // Same first IP should be blocked
      const req2 = new Request('http://localhost/ip', {
        headers: { 'X-Forwarded-For': '10.0.0.1, 10.0.0.3' }
      });
      res = await app.request(req2);
      expect(res.status).toBe(429);
    });

    it('supports lazy evaluation of trustedProxiesCount', async () => {
      let count = 0;
      const getTrustedProxiesCount = () => count;
      
      const app = new Hono();
      app.get('/ip', rateLimit(1, 60_000, getTrustedProxiesCount), (c) => c.text('ok'));
      
      // Req 1: count=0, so "unknown" bucket used for both
      let res = await app.request(new Request('http://localhost/ip', { headers: { 'X-Forwarded-For': '1.1.1.1' }}));
      expect(res.status).toBe(200);
      
      res = await app.request(new Request('http://localhost/ip', { headers: { 'X-Forwarded-For': '2.2.2.2' }}));
      expect(res.status).toBe(429); // 2.2.2.2 gets mapped to "unknown" and blocked
      
      // Let's reset testing by creating a new app to test count=1
      count = 1;
      const app2 = new Hono();
      app2.get('/ip', rateLimit(1, 60_000, getTrustedProxiesCount), (c) => c.text('ok'));
      
      res = await app2.request(new Request('http://localhost/ip', { headers: { 'X-Forwarded-For': '1.1.1.1' }}));
      expect(res.status).toBe(200);
      
      res = await app2.request(new Request('http://localhost/ip', { headers: { 'X-Forwarded-For': '2.2.2.2' }}));
      expect(res.status).toBe(200); // 2.2.2.2 is mapped to its own bucket, not unknown!
    });
  });
});
