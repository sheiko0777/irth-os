import { vi } from 'vitest';

// Stub Next.js server env
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.BETTER_AUTH_SECRET = 'test-secret-32-chars-minimum-ok';
process.env.PLATFORM_ADMIN_EMAIL = 'admin@test.com';
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';

// Stub @irth/db so tests don't need a real DB
vi.mock('@irth/db', async () => {
  const { mockDb } = await import('./helpers/mockDb');
  return {
    db: mockDb,
    organizations: { id: 'organizations.id' },
    orgMembers: { id: 'orgMembers.id', orgId: 'orgMembers.orgId', userId: 'orgMembers.userId', role: 'orgMembers.role' },
    orgFeatureFlags: { orgId: 'orgFeatureFlags.orgId' },
    orgInvites: { id: 'orgInvites.id', orgId: 'orgInvites.orgId', email: 'orgInvites.email', token: 'orgInvites.token', role: 'orgInvites.role', expiresAt: 'orgInvites.expiresAt', createdAt: 'orgInvites.createdAt' },
    // Enums referenced inside router input schemas (evaluated at import)
    brandEnum: { enumValues: ['irth'] as const },
    orderStatusEnum: { enumValues: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'returned'] as const },
    createDb: () => mockDb,
  };
});
