import { router, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import { suppliers, purchaseOrders, purchaseOrderItems, inventoryItems, inventoryMovements, productVariants, withAudit } from '@irth/db';
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

    create: protectedProcedure
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
        const result = await withAudit(
          ctx.db,
          async () => {
            const [supplier] = await ctx.db
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
        );
        return { data: result, error: null, meta: null };
      }),

    update: protectedProcedure
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

        const supplier = await ctx.db.query.suppliers.findFirst({
            where: and(eq(suppliers.id, id), eq(suppliers.orgId, ctx.orgId))
        });

        if (!supplier) throw new TRPCError({ code: 'NOT_FOUND' });

        const mappedData = {
          ...updateData,
          email: updateData.email === '' ? null : updateData.email,
          updatedAt: new Date(),
        };

        const result = await withAudit(
          ctx.db,
          async () => {
            const [updated] = await ctx.db
              .update(suppliers)
              .set(mappedData)
              .where(and(eq(suppliers.id, id), eq(suppliers.orgId, ctx.orgId)))
              .returning();
            return updated;
          },
          {
            orgId: ctx.orgId,
            userId: ctx.userId,
            action: 'UPDATE_SUPPLIER',
            tableName: 'suppliers',
            changes: updateData,
          }
        );
        return { data: result, error: null, meta: null };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const supplier = await ctx.db.query.suppliers.findFirst({
            where: and(eq(suppliers.id, input.id), eq(suppliers.orgId, ctx.orgId))
        });

        if (!supplier) throw new TRPCError({ code: 'NOT_FOUND' });

        // Ensure no POs are linked to the supplier
        const [linkedPo] = await ctx.db
            .select({ count: count() })
            .from(purchaseOrders)
            .where(and(eq(purchaseOrders.supplierId, input.id), eq(purchaseOrders.orgId, ctx.orgId)));

        if (linkedPo && linkedPo.count > 0) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot delete supplier with linked purchase orders' });
        }

        const result = await withAudit(
          ctx.db,
          async () => {
            const [deleted] = await ctx.db
              .delete(suppliers)
              .where(and(eq(suppliers.id, input.id), eq(suppliers.orgId, ctx.orgId)))
              .returning();
            return deleted;
          },
          {
            orgId: ctx.orgId,
            userId: ctx.userId,
            action: 'DELETE_SUPPLIER',
            tableName: 'suppliers',
            changes: { id: input.id },
          }
        );
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
            totalAmount: purchaseOrders.totalAmount,
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
        // Batch independent queries to reduce database roundtrips
        // We use left join since no relations object is created in schema
        const [poRows, items] = await Promise.all([
          ctx.db
              .select({
                  order: purchaseOrders,
                  supplier: suppliers
              })
              .from(purchaseOrders)
              .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
              .where(and(eq(purchaseOrders.id, input.id), eq(purchaseOrders.orgId, ctx.orgId)))
              .limit(1),
          ctx.db
            .select()
            .from(purchaseOrderItems)
            .where(eq(purchaseOrderItems.poId, input.id))
        ]);

        const po = poRows[0];
        if (!po) throw new TRPCError({ code: 'NOT_FOUND' });

        return { data: { ...po.order, supplier: po.supplier, items }, error: null, meta: null };
      }),

    create: protectedProcedure
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
        // Generate PO number: PO-YYYY-XXXX
        const year = new Date().getFullYear();

        // Get latest PO for this year to sequence
        const latestPoRows = await ctx.db
            .select({ poNumber: purchaseOrders.poNumber })
            .from(purchaseOrders)
            .where(and(
                eq(purchaseOrders.orgId, ctx.orgId),
                sql`${purchaseOrders.poNumber} LIKE ${`PO-${year}-%`}`
            ))
            .orderBy(desc(purchaseOrders.poNumber))
            .limit(1);
        const latestPo = latestPoRows[0];

        let seq = 1;
        if (latestPo && latestPo.poNumber) {
            const parts = latestPo.poNumber.split('-');
            if (parts.length === 3) {
                seq = parseInt(parts[2], 10) + 1;
            }
        }

        const poNumber = `PO-${year}-${seq.toString().padStart(4, '0')}`;
        const totalAmt = typeof input.totalAmount === 'number' ? input.totalAmount.toString() : input.totalAmount;

        // @ts-expect-error Drizzle transaction generic
        const result = await ctx.db.transaction(async (tx) => {
          const [po] = await tx
            .insert(purchaseOrders)
            .values({
              orgId: ctx.orgId,
              supplierId: input.supplierId,
              poNumber,
              status: 'draft',
              notes: input.notes,
              totalAmount: totalAmt,
            })
            .returning();

          const itemsData = input.items.map((item) => ({
            poId: po.id,
            productName: item.productName,
            variantName: item.variantName,
            sku: item.sku,
            quantity: item.quantity,
            unitCost: typeof item.unitCost === 'number' ? item.unitCost.toString() : item.unitCost,
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

    updateStatus: protectedProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          status: z.enum(['draft', 'ordered', 'partial', 'received', 'cancelled']),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const po = await ctx.db.query.purchaseOrders.findFirst({
            where: and(eq(purchaseOrders.id, input.id), eq(purchaseOrders.orgId, ctx.orgId))
        });

        if (!po) throw new TRPCError({ code: 'NOT_FOUND' });

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

        const result = await withAudit(
          ctx.db,
          async () => {
            const [updated] = await ctx.db
              .update(purchaseOrders)
              .set(updateData)
              .where(and(eq(purchaseOrders.id, input.id), eq(purchaseOrders.orgId, ctx.orgId)))
              .returning();
            return updated;
          },
          {
            orgId: ctx.orgId,
            userId: ctx.userId,
            action: 'UPDATE_PO_STATUS',
            tableName: 'purchase_orders',
            changes: { from: po.status, to: input.status },
          }
        );
        return { data: result, error: null, meta: null };
      }),

    receive: protectedProcedure
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
        })
      )
      .mutation(async ({ ctx, input }) => {
        const po = await ctx.db.query.purchaseOrders.findFirst({
            where: and(eq(purchaseOrders.id, input.id), eq(purchaseOrders.orgId, ctx.orgId))
        });
        if (!po) throw new TRPCError({ code: 'NOT_FOUND' });

        // @ts-expect-error Drizzle tx limitation
        const result = await ctx.db.transaction(async (tx) => {
            let fullyReceived = true;

            for (const itemInput of input.items) {
                // Get item to know its original requested qty and sku
                const [poItem] = await tx.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.id, itemInput.id)).limit(1);
                if (!poItem || poItem.poId !== po.id) continue;

                const currentReceived = poItem.receivedQuantity || 0;
                const newReceivedTotal = currentReceived + itemInput.receivedQuantity;

                if (newReceivedTotal < poItem.quantity) {
                    fullyReceived = false;
                }

                await tx.update(purchaseOrderItems)
                    .set({ receivedQuantity: newReceivedTotal })
                    .where(eq(purchaseOrderItems.id, itemInput.id));

                // Update inventory if requested and SKU exists
                if (itemInput.updateInventory && poItem.sku && itemInput.receivedQuantity > 0) {
                    // Find variant by SKU
                    const [variant] = await tx.select().from(productVariants).where(eq(productVariants.sku, poItem.sku)).limit(1);
                    if (variant) {
                        // Find inventory item
                        const [invItem] = await tx.select().from(inventoryItems).where(and(eq(inventoryItems.variantId, variant.id), eq(inventoryItems.orgId, ctx.orgId))).limit(1);
                        if (invItem) {
                            await tx.update(inventoryItems)
                                .set({
                                    quantity: invItem.quantity + itemInput.receivedQuantity,
                                    updatedAt: new Date()
                                })
                                .where(eq(inventoryItems.id, invItem.id));

                            await tx.insert(inventoryMovements).values({
                                orgId: ctx.orgId,
                                itemId: invItem.id,
                                type: 'in',
                                quantity: itemInput.receivedQuantity,
                                note: `PO ${po.poNumber} receipt`,
                            });
                        }
                    }
                }
            }

            const newStatus = fullyReceived ? 'received' : 'partial';
            const [updatedPo] = await tx.update(purchaseOrders)
                .set({ status: newStatus, receivedAt: new Date(), updatedAt: new Date() })
                .where(eq(purchaseOrders.id, po.id))
                .returning();

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
      }),
  }),
});
