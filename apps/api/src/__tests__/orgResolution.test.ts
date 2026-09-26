/**
 * `authContext` sets `orgId`/`role`/`access` from the shared resolvers
 * (packages/db/src/orgContext.ts) rather than running its own query — this is
 * the drift fix described there. `authContext.test.ts` is deliberately scoped
 * to `isPublic` only (see its own docstring), so this file exists to cover
 * the actual middleware body instead.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../db', () => ({ db: {} }));
vi.mock('@irth/db', async (importOriginal) => ({
  effectiveAccess: (await importOriginal<typeof import('@irth/db')>()).effectiveAccess,
  resolveActiveOrgMembership: vi.fn(),
  resolveEffectiveAccess: vi.fn(),
}));
vi.mock('../auth', () => ({ auth: { api: { getSession: vi.fn() } } }));

import { effectiveAccess, resolveActiveOrgMembership, resolveEffectiveAccess } from '@irth/db';
import { auth } from '../auth';
import { authContext } from '../middlewares/authContext';

function buildApp() {
  const app = new Hono();
  app.use('*', authContext());
  app.get('/api/whoami', (c) => c.json({
    userId: c.get('userId'), orgId: c.get('orgId'), role: c.get('role'),
    canWriteOrders: c.get('access')?.perms.has('orders.write'),
  }));
  return app;
}

describe('authContext', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockReset();
    vi.mocked(resolveActiveOrgMembership).mockReset();
    vi.mocked(resolveEffectiveAccess).mockReset();
  });

  it('401s a request with no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await buildApp().request('/api/whoami');
    expect(res.status).toBe(401);
  });

  it('sets userId/orgId/role from the shared resolver when a membership exists', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: 'user-1' } } as never);
    vi.mocked(resolveActiveOrgMembership).mockResolvedValue({ orgId: 'org-1', role: 'admin' });
    vi.mocked(resolveEffectiveAccess).mockResolvedValue(effectiveAccess({ systemKey: 'admin' }));

    const res = await buildApp().request('/api/whoami');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'user-1', orgId: 'org-1', role: 'admin', canWriteOrders: true });
    expect(resolveActiveOrgMembership).toHaveBeenCalledWith({}, 'user-1');
    expect(resolveEffectiveAccess).toHaveBeenCalledWith({}, 'org-1', 'user-1');
  });

  it('treats a suspended member like one with no membership: no orgId, so org-scoped routes refuse them', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: 'user-3' } } as never);
    vi.mocked(resolveActiveOrgMembership).mockResolvedValue({ orgId: 'org-1', role: 'owner' });
    vi.mocked(resolveEffectiveAccess).mockResolvedValue(effectiveAccess({ systemKey: 'owner', status: 'suspended' }));

    const res = await buildApp().request('/api/whoami');

    expect(await res.json()).toEqual({ userId: 'user-3' });
  });

  it('leaves orgId/role unset (not fatal) when the user has no membership — onboarding routes still need userId', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: 'user-2' } } as never);
    vi.mocked(resolveActiveOrgMembership).mockResolvedValue(null);

    const res = await buildApp().request('/api/whoami');

    expect(res.status).toBe(200);
    // c.get('orgId')/c.get('role') are unset (undefined), not null — and
    // JSON.stringify drops undefined keys entirely, so they're simply absent.
    expect(await res.json()).toEqual({ userId: 'user-2' });
  });
});
