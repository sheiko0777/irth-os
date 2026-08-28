/**
 * POST /invite/accept — now a thin delegate to the shared acceptOrgInvite
 * (packages/db/src/invites.ts), same as apps/admin's app/api/join/route.ts.
 * acceptOrgInvite's own logic (token/expiry/email/OTP checks) is covered by
 * packages/db/src/__tests__/invites.test.ts; this file only proves the
 * route wires userId/userEmail/otpCode through correctly and maps every
 * failure reason to the right HTTP status.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../db', () => ({ db: {}, withOrg: vi.fn() }));
vi.mock('@irth/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@irth/db')>();
  return { ...actual, acceptOrgInvite: vi.fn() };
});

import { acceptOrgInvite } from '@irth/db';
import { orgsRouter } from '../routes/orgs';

function buildApp(ctx: { userId?: string; userEmail?: string }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (ctx.userId !== undefined) c.set('userId', ctx.userId);
    if (ctx.userEmail !== undefined) c.set('userEmail', ctx.userEmail);
    await next();
  });
  app.route('/api/orgs', orgsRouter);
  return app;
}

function accept(app: Hono, body: Record<string, unknown>) {
  return app.request('/api/orgs/invite/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(acceptOrgInvite).mockReset();
});

describe('POST /api/orgs/invite/accept', () => {
  it('401 when no session userId is set', async () => {
    const app = buildApp({});
    const res = await accept(app, { token: 't' });
    expect(res.status).toBe(401);
    expect(acceptOrgInvite).not.toHaveBeenCalled();
  });

  it('passes userId, userEmail, and otpCode straight through to acceptOrgInvite', async () => {
    vi.mocked(acceptOrgInvite).mockResolvedValue({ ok: true, orgId: 'org-1', role: 'member' });
    const app = buildApp({ userId: 'user-1', userEmail: 'a@test.com' });

    await accept(app, { token: 'tok', otpCode: '123456' });

    expect(acceptOrgInvite).toHaveBeenCalledWith(
      expect.anything(),
      { token: 'tok', otpCode: '123456', userId: 'user-1', userEmail: 'a@test.com' },
    );
  });

  it('success returns 201 with orgId/role', async () => {
    vi.mocked(acceptOrgInvite).mockResolvedValue({ ok: true, orgId: 'org-1', role: 'admin' });
    const app = buildApp({ userId: 'user-1', userEmail: 'a@test.com' });

    const res = await accept(app, { token: 'tok' });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { orgId: string; role: string } };
    expect(body.data).toEqual({ orgId: 'org-1', role: 'admin' });
  });

  const cases: Array<[string, number]> = [
    ['invalid_token', 404],
    ['expired', 410],
    ['email_mismatch', 403],
    ['otp_required', 400],
    ['otp_invalid', 400],
    ['otp_expired', 410],
    ['otp_locked', 429],
  ];

  for (const [reason, status] of cases) {
    it(`maps reason "${reason}" to HTTP ${status}`, async () => {
      vi.mocked(acceptOrgInvite).mockResolvedValue({ ok: false, reason: reason as never });
      const app = buildApp({ userId: 'user-1', userEmail: 'a@test.com' });

      const res = await accept(app, { token: 'tok' });

      expect(res.status).toBe(status);
    });
  }
});
