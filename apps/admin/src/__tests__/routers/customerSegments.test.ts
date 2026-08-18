import { describe, it, expect, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { mockDb, withOrgMock } from '../helpers/mockDb';

const { customerSegmentsRouter } = await import('@/server/routers/customerSegments');

function ctx(role: 'owner' | 'admin' | 'member' = 'owner'): Context {
  return {
    db: mockDb,
    withOrg: withOrgMock,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role,
  } as unknown as Context;
}

const UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const forbidden = (e: unknown) => e instanceof TRPCError && e.code === 'FORBIDDEN';

async function expectCode(p: Promise<unknown>, code: TRPCError['code']) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === code);
}

beforeEach(() => {
  mockDb._reset();
});

describe('customerSegments', () => {
  it('list resolves with an array on an empty db', async () => {
    const res = await customerSegmentsRouter.createCaller(ctx()).list();
    expect(Array.isArray(res.data ?? res)).toBe(true);
  });

  it('create rejects an empty name', async () => {
    await expectCode(
      customerSegmentsRouter.createCaller(ctx()).create({ name: '', color: '#B0885E' } as never),
      'BAD_REQUEST'
    );
  });

  it('getMembers rejects a malformed segmentId', async () => {
    await expectCode(
      customerSegmentsRouter.createCaller(ctx()).getMembers({ segmentId: 'nope' } as never),
      'BAD_REQUEST'
    );
  });

  it('getMembers reports NOT_FOUND for a segment that does not exist', async () => {
    // The resolver checks the segment belongs to this org before listing —
    // that check is what keeps one tenant from reading another's members.
    await expectCode(
      customerSegmentsRouter.createCaller(ctx()).getMembers({ segmentId: UUID }),
      'NOT_FOUND'
    );
  });

  it('addMembers rejects an empty customerIds array', async () => {
    await expectCode(
      customerSegmentsRouter.createCaller(ctx()).addMembers({ segmentId: UUID, customerIds: [] } as never),
      'BAD_REQUEST'
    );
  });

  it('addMembers reports NOT_FOUND for a segment outside the org', async () => {
    await expectCode(
      customerSegmentsRouter.createCaller(ctx()).addMembers({ segmentId: UUID, customerIds: [UUID] }),
      'NOT_FOUND'
    );
  });

  it('removeMember reports NOT_FOUND when the membership row is absent', async () => {
    await expectCode(
      customerSegmentsRouter.createCaller(ctx()).removeMember({ memberId: UUID }),
      'NOT_FOUND'
    );
  });

  it('getCustomersNotInSegment resolves with an array', async () => {
    const res = await customerSegmentsRouter.createCaller(ctx()).getCustomersNotInSegment({ segmentId: UUID });
    expect(Array.isArray(res.data ?? res)).toBe(true);
  });

  it('a member cannot create, update, add or remove members', async () => {
    const member = customerSegmentsRouter.createCaller(ctx('member'));
    await expect(member.create({ name: 'VIP', color: '#B0885E' })).rejects.toSatisfy(forbidden);
    await expect(member.update({ id: UUID, name: 'VIP' })).rejects.toSatisfy(forbidden);
    await expect(member.addMembers({ segmentId: UUID, customerIds: [UUID] })).rejects.toSatisfy(forbidden);
    await expect(member.removeMember({ memberId: UUID })).rejects.toSatisfy(forbidden);
  });

  it('an admin cannot delete a segment — delete is owner-only', async () => {
    await expect(
      customerSegmentsRouter.createCaller(ctx('admin')).delete({ id: UUID })
    ).rejects.toSatisfy(forbidden);
  });
});
