import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

const { purchasingRouter } = await import('@/server/routers/purchasing');

function ctx(role: 'owner' | 'admin' | 'member' = 'owner'): Context {
  return {
    db: mockDb,
    withOrg: withOrgMock,
    idempotent: idempotentMock,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role,
  } as unknown as Context;
}

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

async function expectCode(p: Promise<unknown>, code: TRPCError['code']) {
  await expect(p).rejects.toSatisfy(
    (e: unknown) => e instanceof TRPCError && e.code === code
  );
}

// mockDb.query is {} — procedures using ctx.db.query.<table>.findFirst throw a
// TypeError instead of reaching their NOT_FOUND branch. Assert the call fails
// somewhere past authorization (i.e. not FORBIDDEN); we cannot assert NOT_FOUND
// without changing the shared mock.
async function expectRejectsPastAuthz(p: Promise<unknown>) {
  await expect(p).rejects.toSatisfy(
    (e: unknown) => !(e instanceof TRPCError && e.code === 'FORBIDDEN')
  );
}

describe('purchasing.suppliers', () => {
  const caller = purchasingRouter.createCaller(ctx('owner'));

  it('list resolves with an empty data envelope', async () => {
    const res = await caller.suppliers.list();
    expect(res.data).toEqual([]);
    expect(res.error).toBeNull();
    expect(res.meta).toBeNull();
  });

  it('create rejects invalid input with BAD_REQUEST', async () => {
    await expectCode(caller.suppliers.create({ name: '' }), 'BAD_REQUEST');
    await expectCode(
      caller.suppliers.create({ name: 'Acme', email: 'not-an-email' }),
      'BAD_REQUEST'
    );
  });

  it('create with valid input runs insert + real withAudit and returns the envelope', async () => {
    // insert().returning() resolves [] under the mock, so the row is undefined;
    // withAudit tolerates that (recordId falls back to unknown_id).
    const res = await caller.suppliers.create({ name: 'Acme Dates' });
    expect(res.data).toBeUndefined();
    expect(res.error).toBeNull();
    expect(res.meta).toBeNull();
  });

  it('update rejects a malformed uuid with BAD_REQUEST before any db access', async () => {
    await expectCode(
      caller.suppliers.update({ id: 'not-a-uuid', name: 'X' }),
      'BAD_REQUEST'
    );
  });

  it('update on a missing supplier reports NOT_FOUND from the UPDATE itself', async () => {
    // No pre-read to work around any more: the resolver takes existence from
    // the UPDATE's RETURNING, which the mock resolves as [], so this asserts
    // the real error code rather than "something past authz".
    await expectCode(
      caller.suppliers.update({ id: VALID_UUID, name: 'Renamed' }),
      'NOT_FOUND'
    );
  });

  it('delete on a missing supplier reports NOT_FOUND from the DELETE itself', async () => {
    // Code path: the linked-PO count runs first (it spans another table and
    // cannot fold into the DELETE's WHERE) and finds none under the mock, then
    // the DELETE returns no row -> NOT_FOUND. A supplier that does not exist
    // cannot have linked POs, so ordering the two this way cannot mask the
    // BAD_REQUEST case.
    await expectCode(caller.suppliers.delete({ id: VALID_UUID }), 'NOT_FOUND');
  });
});

describe('purchasing.po', () => {
  const caller = purchasingRouter.createCaller(ctx('owner'));

  it('list resolves with an empty data envelope', async () => {
    const res = await caller.po.list({});
    expect(res.data).toEqual([]);
    expect(res.error).toBeNull();
    expect(res.meta).toBeNull();
  });

  it('get rejects a malformed uuid with BAD_REQUEST', async () => {
    await expectCode(caller.po.get({ id: 'not-a-uuid' }), 'BAD_REQUEST');
  });

  it('create rejects an empty items array with BAD_REQUEST', async () => {
    await expectCode(caller.po.create({ items: [] }), 'BAD_REQUEST');
  });

  it('updateStatus rejects an invalid status enum with BAD_REQUEST', async () => {
    await expectCode(
      caller.po.updateStatus({ id: VALID_UUID, status: 'shipped' } as never),
      'BAD_REQUEST'
    );
  });

  it('get/updateStatus/receive on a missing PO reject past authz (mock db.query limitation)', async () => {
    // All three still read the PO through ctx.db.query.purchaseOrders.findFirst
    // — `get` to assemble the response, `updateStatus` for the audit's previous
    // status, `receive` for the PO number stamped on each stock movement. Those
    // reads no longer decide existence (each write reports NOT_FOUND from its
    // own result), but they run first, and mockDb.query is {} so the mock turns
    // them into a TypeError before that code is reached. Not FORBIDDEN either
    // way, which is all this can assert without changing the shared mock.
    await expectRejectsPastAuthz(caller.po.get({ id: VALID_UUID }));
    await expectRejectsPastAuthz(
      caller.po.updateStatus({ id: VALID_UUID, status: 'ordered' })
    );
    await expectRejectsPastAuthz(caller.po.receive({ id: VALID_UUID, items: [] }));
  });
});
