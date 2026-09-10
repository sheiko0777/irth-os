import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../../../../../src/app/api/join/resend-otp/route';
import { db, orgInvites, organizations, outboxEvents } from '@irth/db';

vi.mock('@irth/db', async () => {
  const actual = await vi.importActual('@irth/db');
  return {
    ...actual,
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{
              id: 'test-invite',
              orgId: 'test-org',
              token: 'valid-token',
              expiresAt: new Date(Date.now() + 10000),
              email: 'test@example.com',
              role: 'admin'
            }])
          })
        })
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({})
        })
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue({})
      })
    },
    orgInvites: {},
    organizations: {},
    outboxEvents: {},
    generateInviteOtp: vi.fn().mockReturnValue({ code: '123456', expiresAt: new Date() }),
  };
});

describe('POST /api/join/resend-otp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createReq = (token: string, ip: string | null = null, headers: Record<string, string> = {}) => {
    const req = new NextRequest('http://localhost/api/join/resend-otp', {
      method: 'POST',
      body: JSON.stringify({ token }),
      headers: new Headers(headers)
    });
    if (ip) {
      Object.defineProperty(req, 'ip', { value: ip, writable: false });
    }
    return req;
  };

  it('allows the first request and blocks an immediate second request', async () => {
    const token = 'test-token-1';
    const req1 = createReq(token, '192.168.1.1');
    const res1 = await POST(req1);
    expect(res1.status).not.toBe(429); // Usually 200, or 404/410 based on mock, but not 429

    const req2 = createReq(token, '192.168.1.1');
    const res2 = await POST(req2);
    expect(res2.status).toBe(429);
    const body = await res2.json();
    expect(body).toEqual({ error: 'Too Many Requests' });
  });

  it('allows another request after 30 seconds', async () => {
    const token = 'test-token-2';
    const req1 = createReq(token, '192.168.1.2');
    const res1 = await POST(req1);
    expect(res1.status).not.toBe(429);

    vi.advanceTimersByTime(30_001);

    const req2 = createReq(token, '192.168.1.2');
    const res2 = await POST(req2);
    expect(res2.status).not.toBe(429);
  });

  it('does not block a different token with the same IP', async () => {
    const req1 = createReq('test-token-3a', '192.168.1.3');
    const res1 = await POST(req1);
    expect(res1.status).not.toBe(429);

    const req2 = createReq('test-token-3b', '192.168.1.3');
    const res2 = await POST(req2);
    expect(res2.status).not.toBe(429);
  });

  it('does not block the same token with a different IP', async () => {
    const token = 'test-token-4-different';
    const req1 = createReq(token, '192.168.1.4a');
    const res1 = await POST(req1);
    expect(res1.status).not.toBe(429);

    const req2 = createReq(token, '192.168.1.4b');
    const res2 = await POST(req2);
    expect(res2.status).not.toBe(429);
  });

  it('falls back to x-forwarded-for if ip is missing', async () => {
    const token = 'test-token-5';
    // first IP
    const req1 = createReq(token, null, { 'x-forwarded-for': '203.0.113.1' });
    const res1 = await POST(req1);
    expect(res1.status).not.toBe(429);

    // immediate second IP (same)
    const req2 = createReq(token, null, { 'x-forwarded-for': '203.0.113.1' });
    const res2 = await POST(req2);
    expect(res2.status).toBe(429);
  });
});
