import { router, protectedProcedure, adminProcedure, ownerProcedure } from '../trpc';
import { z } from 'zod';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import { suppliers, purchaseOrders, purchaseOrderItems, inventoryItems, inventoryMovements, productVariants, products, withAudit, nextDocumentNumber, formatDocumentNumber, recordCostedReceipt, postJournalEntry, ACCOUNT_CODES } from '@irth/db';
import { parseDecimal } from '@irth/domain';
import { TRPCError } from '@trpc/server';

export const purchasingRouter = router({
  suppliers: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const data = await ctx.db
        .select()
        .from(suppliers)
        .where(eq(suppliers.orgId, ctx.orgId))
        .orderBy(desc(suppliers.createdAt));
      return { data, error: null, meta: null };
    }),

    create: adminProcedure
      .input(
        z.object({
          name: z.string().min(1),
          email: z.string().email().optional().or(z.literal('')),
          phone: z.string().optional(),
          address: z.string().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.withOrg((tx) => withAudit(
          tx,
          async () => {
            const [supplier] = await tx
              .insert(suppliers)
              .values({
                orgId: ctx.orgId,
                name: input.name,
                email: input.email || null,
                phone: input.phone,
                address: input.address,
                notes: input.notes,
              })
              .returning();
            return supplier;
          },
          {
            orgId: ctx.orgId,
            userId: ctx.userId,
            action: 'CREATE_SUPPLIER',
            tableName: 'suppliers',
            changes: input,
          }
        ));
        return { data: result, error: null, meta: null };
      }),

    update: adminProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().min(1).optional(),
          email: z.string().email().optional().or(z.literal('')),
          phone: z.string().optional(),
          address: z.string().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...updateData } = input;

        const mappedData = {
          ...updateData,
          email: updateData.email === '' ? null : updateData.email,
          updatedAt: new Date(),
        };

        const result = await ctx.withOrg((tx) => withAudit(
          tx,
          async () => {
            // The UPDATE's own result is the existence check. Looking the
            // supplier up first and updating after are two statements — a
            // delete landing between them left this reporting success with an
            // undefined row and writing an audit entry for a write that never
            // happened.
            const [updated] = await tx
              .update(suppliers)
              .set(mappedData)
              .where(and(eq(suppliers.id, id), eq(suppliers.orgId, ctx.orgId)))
              .returning();
            if (!updated) throw new TRPCError({ code: 'NOT_FOUND' });
            return updated;
          },
          {
            orgId: ctx.orgId,
            userId: ctx.userId,
            action: 'UPDATE_SUPPLIER',
            tableName: 'suppliers',
            changes: updateData,
          }
        ));
        return { data: result, error: null, meta: null };
      }),

    delete: ownerProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        // Stays a separate read: the condition is a count over ANOTHER table,
        // which the DELETE's own WHERE cannot express. It is safe to leave
        // split because the outcome it guards is enforced by the database
        // regardless — purchase_orders.supplier_id references suppliers.id with
        // no ON DELETE action, so a purchase order created concurrently makes
        // the DELETE fail on the foreign key rather than orphan anything. This
        // check only turns that 500 into a message the caller can act on.
        const [linkedPo] = await ctx.db
            .select({ count: count() })
            .from(purchaseOrders)
            .where(and(eq(purchaseOrders.supplierId, input.id), eq(purchaseOrders.orgId, ctx.orgId)));

        if (linkedPo && linkedPo.count > 0) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot delete supplier with linked purchase orders' });
        }

        const result = await ctx.withOrg((tx) => withAudit(
          tx,
          async () => {
            // Existence comes from the DELETE's RETURNING, not from a lookup
            // before it. A supplier with no linked POs cannot exist and match
            // nothing here, so an empty result means no such supplier.
            const [deleted] = await tx
              .delete(suppliers)
              .where(and(eq(suppliers.id, input.id), eq(suppliers.orgId, ctx.orgId)))
              .returning();
            if (!deleted) throw new TRPCError({ code: 'NOT_FOUND' });
            return deleted;
          },
          {
            orgId: ctx.orgId,
            userId: ctx.userId,
            action: 'DELETE_SUPPLIER',
            tableName: 'suppliers',
            changes: { id: input.id },
          }
        ));
        return { data: result, error: null, meta: null };
      }),
  }),

  po: router({
    list: protectedProcedure
      .input(z.object({
        page: z.number().default(1),
        pageSize: z.number().default(20),
      }))
      .query(async ({ ctx, input }) => {
        const offset = (input.page - 1) * input.pageSize;

        const data = await ctx.db
          .select({
            id: purchaseOrders.id,
            poNumber: purchaseOrders.poNumber,
            status: purchaseOrders.status,
            totalAmountMinor: purchaseOrders.totalAmountMinor,
            currency: purchaseOrders.currency,
            orderedAt: purchaseOrders.orderedAt,
            createdAt: purchaseOrders.createdAt,
            supplierName: suppliers.name,
            itemsCount: sql<number>`count(${purchaseOrderItems.id})::int`,
          })
          .from(purchaseOrders)
          .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
          .leftJoin(purchaseOrderItems, eq(purchaseOrderItems.poId, purchaseOrders.id))
          .where(eq(purchaseOrders.orgId, ctx.orgId))
          .groupBy(purchaseOrders.id, suppliers.name)
          .orderBy(desc(purchaseOrders.createdAt))
          .limit(input.pageSize)
          .offset(offset);

        return { data, error: null, meta: null };
      }),

    get: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const order = await ctx.db.query.purchaseOrders.findFirst({
          where: and(eq(purchaseOrders.id, input.id), eq(purchaseOrders.orgId, ctx.orgId)),
          with: {
            supplier: true, // Assuming relation exists, but since not defined in schema relation we need left join or separate query
          }
        });

        // Since no relations object is created in schema, query separately:
        const poRows = await ctx.db
            .select({
                order: purchaseOrders,
                supplier: suppliers
            })
            .from(purchaseOrders)
            .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
            .where(and(eq(purchaseOrders.id, input.id), eq(purchaseOrders.orgId, ctx.orgId)))
            .limit(1);

        const po = poRows[0];
        if (!po) throw new TRPCError({ code: 'NOT_FOUND' });

        const items = await ctx.db
          .select()
          .from(purchaseOrderItems)
          .where(eq(purchaseOrderItems.poId, po.order.id));

        return { data: { ...po.order, supplier: po.supplier, items }, error: null, meta: null };
      }),

    create: adminProcedure
      .input(
        z.object({
          supplierId: z.string().uuid().optional(),
          notes: z.string().optional(),
          totalAmount: z.string().or(z.number()).optional(),
          items: z.array(
            z.object({
              productName: z.string().min(1),
              variantName: z.string().optional(),
              sku: z.string().optional(),
              quantity: z.number().int().min(1),
              unitCost: z.string().or(z.number()).optional(),
            })
          ).min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // The PO number is claimed inside the transaction below, from the
        // tenant's counter.
        //
        // What this replaced read the highest existing PO number and added one,
        // which was wrong twice over:
        //
        //   - Read-then-write, so two concurrent creates both derived the same
        //     next number. Nothing rejected the duplicate until 0035.
        //   - It ordered by the number as TEXT. 'PO-2026-10000' sorts before
        //     'PO-2026-9999', so on the ten-thousandth PO of a year the "latest"
        //     is no longer the highest and the series silently restarts into
        //     numbers already issued.
        // parseDecimal both when the client sends a string and when it sends a
        // number: routing the number through String() first means the value
        // never becomes a float here, only its decimal text.
        const totalAmountMinor =
          input.totalAmount === undefined || input.totalAmount === null
            ? null
            : parseDecimal(String(input.totalAmount)).minor;

        const result = await ctx.withOrg(async (tx) => {
          const poNumber = formatDocumentNumber(
            'purchase_order',
            await nextDocumentNumber(tx, ctx.orgId, 'purchase_order'),
          );

          const [po] = await tx
            .insert(purchaseOrders)
            .values({
              orgId: ctx.orgId,
              supplierId: input.supplierId,
              poNumber,
              status: 'draft',
              notes: input.notes,
              totalAmountMinor,
            })
            .returning();

          const itemsData = input.items.map((item) => ({
            // Denormalised from the parent so RLS can use the same
            // `org_id = current_setting(...)` predicate as every other table.
            // The composite FK in 0030 rejects any value that disagrees with
            // the purchase order's own org.
            orgId: ctx.orgId,
            poId: po.id,
            productName: item.productName,
            variantName: item.variantName,
            sku: item.sku,
            quantity: item.quantity,
            unitCostMinor:
              item.unitCost === undefined || item.unitCost === null
                ? null
                : parseDecimal(String(item.unitCost)).minor,
          }));

          const insertedItems = await tx.insert(purchaseOrderItems).values(itemsData).returning();

          await withAudit(
              tx,
              async () => po,
              {
                orgId: ctx.orgId,
                userId: ctx.userId,
                action: 'CREATE_PURCHASE_ORDER',
                tableName: 'purchase_orders',
                changes: { poNumber, supplierId: input.supplierId, itemCount: itemsData.length }
              }
          );

          return { ...po, items: insertedItems };
        });

        return { data: result, error: null, meta: null };
      }),

    updateStatus: adminProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          status: z.enum(['draft', 'ordered', 'partial', 'received', 'cancelled']),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Read purely to record where the status came FROM: RETURNING hands
        // back the new row, never the old one, so the previous value has to be
        // read to be audited. The existence check is deliberately not taken
        // from here — it is the UPDATE's own result below, so a PO deleted
        // between the two statements reports NOT_FOUND instead of succeeding
        // with an undefined row.
        const po = await ctx.db.query.purchaseOrders.findFirst({
            where: and(eq(purchaseOrders.id, input.id), eq(purchaseOrders.orgId, ctx.orgId))
        });

        const updateData: {
          status: typeof input.status;
          updatedAt: Date;
          orderedAt?: Date;
          receivedAt?: Date;
        } = { status: input.status, updatedAt: new Date() };
        if (input.status === 'ordered') {
            updateData.orderedAt = new Date();
        } else if (input.status === 'received' || input.status === 'partial') {
            updateData.receivedAt = new Date();
        }

        const result = await ctx.withOrg((tx) => withAudit(
          tx,
          async () => {
            const [updated] = await tx
              .update(purchaseOrders)
              .set(updateData)
              .where(and(eq(purchaseOrders.id, input.id), eq(purchaseOrders.orgId, ctx.orgId)))
              .returning();
            if (!updated) throw new TRPCError({ code: 'NOT_FOUND' });
            return updated;
          },
          {
            orgId: ctx.orgId,
            userId: ctx.userId,
            action: 'UPDATE_PO_STATUS',
            tableName: 'purchase_orders',
            changes: { from: po?.status ?? null, to: input.status },
          }
        ));
        return { data: result, error: null, meta: null };
      }),

    receive: adminProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          items: z.array(
            z.object({
              id: z.string().uuid(),
              receivedQuantity: z.number().int().min(0),
              updateInventory: z.boolean().default(false),
            })
          ),
          // The highest-consequence of the three: receiving twice adds the
          // quantity to stock twice, and nothing downstream can tell the
          // difference between that and a genuine second delivery.
          idempotencyKey: z.string().min(1).max(255).optional(),
        })
      )
      .mutation(async ({ ctx, input }) =>
        ctx.idempotent('purchasing.receive', input.idempotencyKey, input, async () => {
        const po = await ctx.db.query.purchaseOrders.findFirst({
            where: and(eq(purchaseOrders.id, input.id), eq(purchaseOrders.orgId, ctx.orgId))
        });
        if (!po) throw new TRPCError({ code: 'NOT_FOUND' });

        const result = await ctx.withOrg(async (tx) => {
            let fullyReceived = true;
            // Total cost of everything costed in this call, across every line —
            // what the goods-received ledger posting debits to Inventory. Stays
            // 0n (and posts nothing) when no line had a known unit cost, rather
            // than silently valuing free stock at zero and posting a fictitious
            // liability.
            let totalReceivedCostMinor = 0n;

            for (const itemInput of input.items) {
                // One statement does the lot: the "line belongs to this PO and
                // this org" check is the UPDATE's own WHERE, and the quantity
                // is incremented in SQL. Reading the line first, adding in JS
                // and writing back an absolute total let two concurrent
                // receipts both read the same figure and the second overwrite
                // the first — stock credited, but the line still short.
                // RETURNING then supplies the sku and the total the database
                // actually holds.
                const [poItem] = await tx.update(purchaseOrderItems)
                    .set({
                        receivedQuantity: sql`COALESCE(${purchaseOrderItems.receivedQuantity}, 0) + ${itemInput.receivedQuantity}`,
                    })
                    .where(and(
                        eq(purchaseOrderItems.id, itemInput.id),
                        eq(purchaseOrderItems.orgId, ctx.orgId),
                        eq(purchaseOrderItems.poId, po.id),
                    ))
                    .returning();
                // No such line, or it belongs to a different PO — the same
                // silent skip as before, now decided by the database.
                if (!poItem) continue;

                if ((poItem.receivedQuantity ?? 0) < poItem.quantity) {
                    fullyReceived = false;
                }

                // Update inventory if requested and SKU exists
                if (itemInput.updateInventory && poItem.sku && itemInput.receivedQuantity > 0) {
                    // Scope the SKU lookup to this org by joining through products:
                    // productVariants has no orgId and `sku` is globally unique, so an
                    // unscoped lookup silently resolves another tenant's variant and the
                    // org-scoped inventory read below then finds nothing — received stock
                    // would vanish with no error.
                    const [variant] = await tx.select({ id: productVariants.id })
                        .from(productVariants)
                        .innerJoin(products, eq(productVariants.productId, products.id))
                        .where(and(eq(productVariants.sku, poItem.sku), eq(products.orgId, ctx.orgId)))
                        .limit(1);
                    if (variant) {
                        // Find inventory item
                        const [invItem] = await tx.select().from(inventoryItems).where(and(eq(inventoryItems.variantId, variant.id), eq(inventoryItems.orgId, ctx.orgId))).limit(1);
                        if (invItem) {
                            // recordCostedReceipt MUST run before the quantity
                            // increment below, not after: it reads
                            // inventory_items.quantity to compute the weighted
                            // average, and that read has to see the count as it
                            // stood BEFORE this receipt. Reversing the order would
                            // have it average against a total that already
                            // includes the units being priced, understating the
                            // new average every time.
                            //
                            // unitCostMinor is nullable — a PO line entered with no
                            // cost has no basis to average against. Recording it as
                            // zero would drag the item's weighted average toward
                            // zero, valuing every unit already held as if this batch
                            // arrived free. Skip the cost update and fall back to a
                            // plain (uncosted) movement, matching what this line did
                            // before costing existed at all.
                            if (poItem.unitCostMinor != null) {
                                const lineCostMinor = poItem.unitCostMinor * BigInt(itemInput.receivedQuantity);
                                await recordCostedReceipt(tx, {
                                    orgId: ctx.orgId,
                                    itemId: invItem.id,
                                    quantity: itemInput.receivedQuantity,
                                    totalCostMinor: lineCostMinor,
                                    note: `PO ${po.poNumber} receipt`,
                                });
                                totalReceivedCostMinor += lineCostMinor;
                            } else {
                                await tx.insert(inventoryMovements).values({
                                    orgId: ctx.orgId,
                                    itemId: invItem.id,
                                    type: 'in',
                                    quantity: itemInput.receivedQuantity,
                                    note: `PO ${po.poNumber} receipt`,
                                });
                            }

                            // Increment in SQL — reading the quantity and writing back an
                            // absolute value loses concurrent receipts.
                            await tx.update(inventoryItems)
                                .set({
                                    quantity: sql`${inventoryItems.quantity} + ${itemInput.receivedQuantity}`,
                                    updatedAt: new Date()
                                })
                                .where(and(
                                  eq(inventoryItems.id, invItem.id),
                                  eq(inventoryItems.orgId, ctx.orgId),
                                ));
                        }
                    }
                }
            }

            // Re-asserts the org scope the lookup above established rather than
            // trusting it across statements, and takes NOT_FOUND from this
            // write's own result: without the predicate this was the one write
            // in the procedure the tenant filter never reached.
            const newStatus = fullyReceived ? 'received' : 'partial';
            const [updatedPo] = await tx.update(purchaseOrders)
                .set({ status: newStatus, receivedAt: new Date(), updatedAt: new Date() })
                .where(and(eq(purchaseOrders.id, po.id), eq(purchaseOrders.orgId, ctx.orgId)))
                .returning();

            if (!updatedPo) throw new TRPCError({ code: 'NOT_FOUND' });

            // Goods received: inventory (an asset) increases, accounts payable
            // (what is owed the supplier) increases by the same figure. Posted
            // only when at least one line had a known cost — a call that only
            // received uncosted lines (or received nothing this time) has
            // nothing to post, and posting a zero/zero entry would be a journal
            // entry that documents no event.
            if (totalReceivedCostMinor > 0n) {
                await postJournalEntry(tx, {
                    orgId: ctx.orgId,
                    journalType: 'purchases',
                    description: `Goods received — PO ${po.poNumber}`,
                    sourceTable: 'purchase_orders',
                    sourceId: po.id,
                    createdBy: ctx.userId,
                    lines: [
                        { accountCode: ACCOUNT_CODES.INVENTORY, debitMinor: totalReceivedCostMinor },
                        { accountCode: ACCOUNT_CODES.ACCOUNTS_PAYABLE, creditMinor: totalReceivedCostMinor },
                    ],
                });
            }

            await withAudit(
              tx,
              async () => updatedPo,
              {
                orgId: ctx.orgId,
                userId: ctx.userId,
                action: 'RECEIVE_PO',
                tableName: 'purchase_orders',
                changes: { poId: po.id, items: input.items, newStatus },
              }
            );

            return updatedPo;
        });

        return { data: result, error: null, meta: null };
      })),
  }),
});
