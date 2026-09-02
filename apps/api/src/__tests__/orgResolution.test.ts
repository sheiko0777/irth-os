/**
 * `authContext` sets `orgId`/`role` from the shared resolver
 * (packages/db/src/orgContext.ts) rather than running its own query — this is
 * the drift fix described there. `authContext.test.ts` is deliberately scoped
 * to `isPublic` only (see its own docstring), so this file exists to cover
 * the actual middleware body instead.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../db', () => ({ db: {} }));
vi.mock('@irth/db', () => ({ resolveActiveOrgMembership: vi.fn() }));
vi.mock('../auth', () => ({ auth: { api: { getSession: vi.fn() } } }));

import { resolveActiveOrgMembership } from '@irth/db';
import { auth } from '../auth';
import { authContext } from '../middlewares/authContext';

function buildApp() {
  const app = new Hono();
  app.use('*', authContext());
  app.get('/api/whoami', (c) => c.json({ userId: c.get('userId'), orgId: c.get('orgId'), role: c.get('role') }));
  return app;
}

describe('authContext', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockReset();
    vi.mocked(resolveActiveOrgMembership).mockReset();
  });

  it('401s a request with no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await buildApp().request('/api/whoami');
    expect(res.status).toBe(401);
  });

  it('sets userId/orgId/role from the shared resolver when a membership exists', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: 'user-1' } } as never);
    vi.mocked(resolveActiveOrgMembership).mockResolvedValue({
      orgId: 'org-1',
      role: 'admin',
      accessPolicy: { allow: ['orders.view'] },
      permissionOverrides: { deny: ['finance.view'] },
      assignedWarehouseIds: ['warehouse-1'],
      jobTitle: null,
    });

    const res = await buildApp().request('/api/whoami');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'user-1', orgId: 'org-1', role: 'admin' });
    expect(resolveActiveOrgMembership).toHaveBeenCalledWith({}, 'user-1');
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
