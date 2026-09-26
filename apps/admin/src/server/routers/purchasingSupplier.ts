import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { hashPassword } from 'better-auth/crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  ACCOUNT_CODES, MAX_IDEMPOTENCY_KEY_LENGTH, accessRoles, canDelegate, permissionKeys, postJournalEntry,
  purchaseOrderShipmentItems, purchaseOrderShipments, purchaseOrders, supplierPayments, suppliers, withAudit, withinScopes,
  type DbTx, type PermissionList,
} from '@irth/db';
import { assertSupportedCurrency, parseDecimal } from '@irth/domain';
import { requirePermission } from '../trpc';
import { inheritedScopes, insertAccount, rethrowAccountError, temporaryPassword, usernameSchema } from '../accountCreation';
import { supplierScope } from '../scopes';
import { supplierStatement } from './portal';

/**
 * The office's side of the supplier portal (PR-3), spread into the purchasing
 * router: answering a proposed delivery date, reading shipping notices,
 * opening a supplier's portal account, and paying suppliers.
 *
 * A payment closes the payable a goods receipt opened — Dr 2010 / Cr 1020
 * bank or 1010 cash — in the same transaction as its row and audit row, and
 * never for more than is owed: the supplier row is locked, and what is owed is
 * read from the ledger (supplier_statement) inside that lock.
 */

const amountInput = z.string().trim().max(20).regex(/^\d+(\.\d{1,2})?$/, 'اكتب المبلغ بالأرقام');

/** The role every portal account gets: portal.* only, kind supplier. Made once per org. */
const SUPPLIER_ROLE_NAME = 'مورد';
const SUPPLIER_ROLE_PERMISSIONS: PermissionList = { portal: ['view', 'respond', 'ship', 'payments'] };

async function supplierRole(tx: DbTx, orgId: string, createdBy: string) {
  const [existing] = await tx.select().from(accessRoles)
    .where(and(eq(accessRoles.orgId, orgId), eq(accessRoles.name, SUPPLIER_ROLE_NAME), eq(accessRoles.principalKind, 'supplier')));
  if (existing) return existing;
  const [created] = await tx.insert(accessRoles).values({
    orgId, name: SUPPLIER_ROLE_NAME, principalKind: 'supplier', permissions: SUPPLIER_ROLE_PERMISSIONS, createdBy,
  }).returning();
  return created;
}

export const poSupplierProcedures = {
  /** Accept the supplier's proposed date: it becomes the expected delivery. */
  acceptProposedDate: requirePermission('purchasing', 'write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.withOrg((tx) => withAudit(tx, async () => {
        const [po] = await tx.update(purchaseOrders)
          .set({ supplierStatus: 'confirmed', expectedDeliveryAt: sql`${purchaseOrders.proposedDeliveryAt}`, proposedDeliveryAt: null, updatedAt: new Date() })
          .where(and(eq(purchaseOrders.id, input.id), eq(purchaseOrders.orgId, ctx.orgId), eq(purchaseOrders.supplierStatus, 'date_proposed'),
            supplierScope(ctx, purchaseOrders.supplierId)))
          .returning({ id: purchaseOrders.id, expectedDeliveryAt: purchaseOrders.expectedDeliveryAt });
        if (!po) throw new TRPCError({ code: 'CONFLICT', message: 'مفيش تاريخ مقترح مستني.' });
        return po;
      }, { orgId: ctx.orgId, userId: ctx.userId, action: 'ACCEPT_SUPPLIER_DATE', tableName: 'purchase_orders', changes: { poId: input.id } }));
      return { data: row, error: null, meta: null };
    }),

  rejectProposedDate: requirePermission('purchasing', 'write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.withOrg((tx) => withAudit(tx, async () => {
        const [po] = await tx.update(purchaseOrders)
          .set({ supplierStatus: 'pending', proposedDeliveryAt: null, updatedAt: new Date() })
          .where(and(eq(purchaseOrders.id, input.id), eq(purchaseOrders.orgId, ctx.orgId), eq(purchaseOrders.supplierStatus, 'date_proposed'),
            supplierScope(ctx, purchaseOrders.supplierId)))
          .returning({ id: purchaseOrders.id });
        if (!po) throw new TRPCError({ code: 'CONFLICT', message: 'مفيش تاريخ مقترح مستني.' });
        return po;
      }, { orgId: ctx.orgId, userId: ctx.userId, action: 'REJECT_SUPPLIER_DATE', tableName: 'purchase_orders', changes: { poId: input.id } }));
      return { data: row, error: null, meta: null };
    }),

  /** The supplier's shipping notices for one purchase order. */
  shipments: requirePermission('purchasing', 'view')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.withOrg(async (tx) => {
        const list = await tx.select().from(purchaseOrderShipments)
          .where(and(eq(purchaseOrderShipments.poId, input.id), eq(purchaseOrderShipments.orgId, ctx.orgId)))
          .orderBy(desc(purchaseOrderShipments.shippedAt));
        const items = list.length === 0 ? [] : await tx.select().from(purchaseOrderShipmentItems)
          .where(and(eq(purchaseOrderShipmentItems.orgId, ctx.orgId), inArray(purchaseOrderShipmentItems.shipmentId, list.map((s) => s.id))));
        return list.map((s) => ({ ...s, items: items.filter((i) => i.shipmentId === s.id) }));
      });
      return { data: rows, error: null, meta: null };
    }),
};

export const supplierAccountProcedures = {
  /**
   * A portal account for this supplier: kind supplier, the "مورد" role
   * (portal.* only), scoped to exactly this supplier, on a temporary password
   * shown once. One transaction with its audit row.
   */
  createPortalAccount: requirePermission('purchasing', 'portalAccounts')
    .input(z.object({ supplierId: z.string().uuid(), name: z.string().trim().min(1).max(80), username: usernameSchema }))
    .mutation(async ({ ctx, input }) => {
      // Nobody opens an account that sees more than they do (PR-1e).
      if (!withinScopes(ctx.access.scopes, { ...ctx.access.scopes, supplier: [input.supplierId] })) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'المورد ده خارج نطاقك.' });
      }
      if (!canDelegate(ctx.access, permissionKeys(SUPPLIER_ROLE_PERMISSIONS))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'لا يمكنك منح صلاحيات لا تملكها.' });
      }
      const password = temporaryPassword();
      const hash = await hashPassword(password);
      const userId = crypto.randomUUID();
      try {
        const member = await ctx.withOrg(async (tx) => {
          const [supplier] = await tx.select({ id: suppliers.id, name: suppliers.name }).from(suppliers)
            .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.orgId, ctx.orgId)));
          if (!supplier) throw new TRPCError({ code: 'NOT_FOUND', message: 'المورد غير موجود.' });
          const role = await supplierRole(tx, ctx.orgId, ctx.userId);
          return withAudit(tx, async () => insertAccount(tx, ctx, {
            userId, name: input.name, username: input.username, passwordHash: hash, role,
            // Exactly this supplier — plus the creator's own brand and price
            // list limits, never their other suppliers.
            scopes: [
              ...inheritedScopes(ctx).filter((s) => s.scopeKind !== 'supplier'),
              { scopeKind: 'supplier' as const, scopeId: supplier.id },
            ],
          }), {
            orgId: ctx.orgId, userId: ctx.userId, action: 'CREATE_SUPPLIER_PORTAL_ACCOUNT', tableName: 'org_members',
            changes: { supplierId: supplier.id, supplier: supplier.name, username: input.username },
          });
        });
        return { data: { memberId: member.id, username: input.username, temporaryPassword: password }, error: null, meta: null };
      } catch (err) {
        rethrowAccountError(err);
      }
    }),

  /** Received (ledger), paid, and outstanding, per purchase order. */
  statement: requirePermission('purchasing', 'view')
    .input(z.object({ supplierId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const data = await ctx.withOrg((tx) => supplierStatement(tx, ctx.orgId, input.supplierId));
      return { data, error: null, meta: null };
    }),

  /** Pay a supplier — never more than is owed them, or than a named PO is owed. */
  recordPayment: requirePermission('purchasing', 'pay')
    .input(z.object({
      supplierId: z.string().uuid(),
      poId: z.string().uuid().optional(),
      amount: amountInput,
      method: z.enum(['cash', 'bank']),
      reference: z.string().trim().max(200).optional(),
      idempotencyKey: z.string().min(1).max(MAX_IDEMPOTENCY_KEY_LENGTH),
    }))
    .mutation(async ({ ctx, input }) =>
      ctx.idempotent('purchasing.recordPayment', input.idempotencyKey, input, async () => {
        const currency = assertSupportedCurrency('EGP');
        const amountMinor = parseDecimal(input.amount, currency).minor;
        if (amountMinor <= 0n) throw new TRPCError({ code: 'BAD_REQUEST', message: 'المبلغ لازم يكون أكبر من صفر.' });
        const payment = await ctx.withOrg(async (tx) => {
          // Serialises payments to this supplier: the balance read below is
          // current when the payment commits.
          const [supplier] = await tx.select({ id: suppliers.id }).from(suppliers)
            .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.orgId, ctx.orgId), supplierScope(ctx, suppliers.id)))
            .for('update');
          if (!supplier) throw new TRPCError({ code: 'NOT_FOUND', message: 'المورد غير موجود.' });
          const statement = await supplierStatement(tx, ctx.orgId, supplier.id);
          if (amountMinor > statement.outstandingMinor) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'المبلغ أكبر من المستحق للمورد.' });
          }
          if (input.poId) {
            const row = statement.rows.find((r) => r.poId === input.poId);
            if (!row || amountMinor > row.receivedMinor - row.paidMinor) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: 'المبلغ أكبر من المستحق على أمر الشراء ده.' });
            }
          }
          const paymentId = crypto.randomUUID();
          return withAudit(tx, async () => {
            const entry = await postJournalEntry(tx, {
              orgId: ctx.orgId,
              journalType: 'cash',
              description: 'سداد لمورد',
              sourceTable: 'supplier_payments',
              sourceId: paymentId,
              createdBy: ctx.userId,
              lines: [
                { accountCode: ACCOUNT_CODES.ACCOUNTS_PAYABLE, currency, debitMinor: amountMinor },
                { accountCode: input.method === 'bank' ? ACCOUNT_CODES.BANK : ACCOUNT_CODES.CASH, currency, creditMinor: amountMinor },
              ],
            });
            const [row] = await tx.insert(supplierPayments).values({
              id: paymentId, orgId: ctx.orgId, supplierId: supplier.id, poId: input.poId ?? null, amountMinor, currency,
              method: input.method, reference: input.reference ?? null, journalEntryId: entry.id, createdBy: ctx.userId,
            }).returning({ id: supplierPayments.id });
            return row;
          }, {
            orgId: ctx.orgId, userId: ctx.userId, action: 'SUPPLIER_PAYMENT', tableName: 'supplier_payments',
            changes: { supplierId: supplier.id, poId: input.poId ?? null, amountMinor: amountMinor.toString(), method: input.method },
          });
        });
        // No bigint: a replay is read back from jsonb.
        return { data: { id: payment.id }, error: null, meta: null };
      })),
};

