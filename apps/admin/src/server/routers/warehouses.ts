import { z } from 'zod';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { inventoryLotBalances, inventoryLots, products, productVariants, warehouses, withAudit } from '@irth/db';
import { requirePermission, router } from '../trpc';

function warehouseScope(ctx: { role: string; accessPolicy: unknown; assignedWarehouseIds: string[] }) {
  if (ctx.role === 'owner' || !ctx.accessPolicy) return undefined;
  return ctx.assignedWarehouseIds.length ? inArray(warehouses.id, ctx.assignedWarehouseIds) : undefined;
}

export const warehousesRouter = router({
  list: requirePermission('inventory', 'view').query(async ({ ctx }) => ({
    data: await ctx.db.select().from(warehouses)
      .where(warehouseScope(ctx) ? and(eq(warehouses.orgId, ctx.orgId), warehouseScope(ctx)) : eq(warehouses.orgId, ctx.orgId))
      .orderBy(asc(warehouses.name)),
    error: null,
    meta: null,
  })),

  variants: requirePermission('inventory', 'view').query(async ({ ctx }) => ({
    data: await ctx.db.select({
      id: productVariants.id,
      name: productVariants.name,
      sku: productVariants.sku,
      productName: products.name,
      productNameAr: products.nameAr,
    })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(productVariants.orgId, ctx.orgId), eq(products.orgId, ctx.orgId)))
      .orderBy(asc(products.name), asc(productVariants.name)),
    error: null,
    meta: null,
  })),

  create: requirePermission('inventory', 'write')
    .input(z.object({ name: z.string().trim().min(2).max(100), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/), isDefault: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => ctx.withOrg(async (tx) => {
      if (input.isDefault) await tx.update(warehouses).set({ isDefault: false }).where(eq(warehouses.orgId, ctx.orgId));
      const warehouse = await withAudit(tx, async () => {
        const [row] = await tx.insert(warehouses).values({ orgId: ctx.orgId, ...input }).returning();
        return row;
      }, { orgId: ctx.orgId, userId: ctx.userId, action: 'CREATE_WAREHOUSE', tableName: 'warehouses', changes: { name: input.name, code: input.code } });
      return { data: warehouse, error: null, meta: null };
    })),

  lots: requirePermission('inventory', 'view')
    .input(z.object({ warehouseId: z.string().uuid().optional(), variantId: z.string().uuid().optional(), includeUnavailable: z.boolean().default(false) }).optional())
    .query(async ({ ctx, input }) => {
      const scope = warehouseScope(ctx);
      const conditions = [eq(inventoryLots.orgId, ctx.orgId)];
      if (scope) conditions.push(scope);
      if (input?.warehouseId) conditions.push(eq(inventoryLots.warehouseId, input.warehouseId));
      if (input?.variantId) conditions.push(eq(inventoryLots.variantId, input.variantId));
      if (!input?.includeUnavailable) conditions.push(eq(inventoryLots.status, 'available'));
      const data = await ctx.db.select({ lot: inventoryLots, balance: inventoryLotBalances, warehouse: warehouses, variant: productVariants })
        .from(inventoryLots)
        .innerJoin(inventoryLotBalances, eq(inventoryLotBalances.lotId, inventoryLots.id))
        .innerJoin(warehouses, eq(warehouses.id, inventoryLots.warehouseId))
        .innerJoin(productVariants, eq(productVariants.id, inventoryLots.variantId))
        .where(and(...conditions)).orderBy(asc(inventoryLots.expiresOn));
      return { data, error: null, meta: null };
    }),

  receiveLot: requirePermission('inventory', 'write')
    .input(z.object({ warehouseId: z.string().uuid(), variantId: z.string().uuid(), lotNumber: z.string().trim().min(1).max(100), expiresOn: z.string().date().nullable(), quantity: z.number().int().positive().max(1_000_000) }))
    .mutation(async ({ ctx, input }) => ctx.withOrg(async (tx) => {
      const scope = warehouseScope(ctx);
      if (scope && !ctx.assignedWarehouseIds.includes(input.warehouseId)) throw new Error('Warehouse is outside your assigned scope');
      const [warehouse] = await tx.select({ id: warehouses.id }).from(warehouses)
        .where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.orgId, ctx.orgId))).limit(1);
      if (!warehouse) throw new Error('Warehouse not found');
      const [variant] = await tx.select({ id: productVariants.id }).from(productVariants)
        .where(and(eq(productVariants.id, input.variantId), eq(productVariants.orgId, ctx.orgId))).limit(1);
      if (!variant) throw new Error('Product variant not found');
      const expiresOn = input.expiresOn ? new Date(`${input.expiresOn}T00:00:00.000Z`) : null;
      const lot = await withAudit(tx, async () => {
        const [row] = await tx.insert(inventoryLots).values({
          orgId: ctx.orgId, warehouseId: input.warehouseId, variantId: input.variantId, lotNumber: input.lotNumber,
          expiresOn, status: 'available',
        }).onConflictDoUpdate({
          target: [inventoryLots.orgId, inventoryLots.warehouseId, inventoryLots.variantId, inventoryLots.lotNumber],
          set: { expiresOn, status: 'available' },
        }).returning();
        await tx.insert(inventoryLotBalances).values({ orgId: ctx.orgId, lotId: row.id, quantity: input.quantity })
          .onConflictDoUpdate({ target: inventoryLotBalances.lotId, set: { quantity: sql`${inventoryLotBalances.quantity} + ${input.quantity}`, updatedAt: new Date() } });
        return row;
      }, { orgId: ctx.orgId, userId: ctx.userId, action: 'RECEIVE_INVENTORY_LOT', tableName: 'inventory_lots', changes: { warehouseId: input.warehouseId, variantId: input.variantId, lotNumber: input.lotNumber, quantity: input.quantity } });
      return { data: lot, error: null, meta: null };
    })),
});
