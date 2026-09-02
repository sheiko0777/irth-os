import { z } from 'zod';
import { and, asc, count, desc, eq, gte, ilike, lte, sum } from 'drizzle-orm';
import {
  canWithPolicy,
  inventoryItems,
  orders,
  products,
  productVariants,
  type ActionFor,
  type DbTx,
  type Resource,
} from '@irth/db';
import type { AiRequestContext, AiToolDefinition, AiToolResult } from './types';

type ToolPermission = { resource: Resource; action: ActionFor<Resource> };
type ToolExecuteContext = AiRequestContext & { db: DbTx };

type AiTool = {
  definition: AiToolDefinition;
  permission: ToolPermission;
  input: z.ZodTypeAny;
  execute(ctx: ToolExecuteContext, input: unknown): Promise<AiToolResult>;
};

const orderStatusSchema = z.enum(['pending', 'confirmed', 'payment_failed', 'shipped', 'delivered', 'cancelled']);
const limitSchema = z.number().int().min(1).max(10).default(5);

function stateOf(quantity: number, reorderPoint: number): 'out' | 'low' | 'ok' {
  if (quantity <= 0) return 'out';
  if (quantity <= reorderPoint) return 'low';
  return 'ok';
}

function asMinor(value: string | number | bigint | null | undefined): string {
  if (value == null) return '0';
  return typeof value === 'bigint' ? value.toString() : String(value);
}

export const AI_TOOLS: AiTool[] = [
  {
    definition: {
      name: 'orders_list',
      description: 'Read recent orders for the current organization. Use for order status, pending orders, and recent order questions.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: orderStatusSchema.options },
          limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
        },
      },
    },
    permission: { resource: 'orders', action: 'view' },
    input: z.object({
      status: orderStatusSchema.optional(),
      limit: limitSchema,
    }).strict(),
    async execute(ctx, input) {
      const args = this.input.parse(input) as { status?: z.infer<typeof orderStatusSchema>; limit: number };
      const rows = await ctx.db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          status: orders.status,
          totalAmountMinor: orders.totalAmountMinor,
          currency: orders.currency,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .where(args.status ? and(eq(orders.orgId, ctx.orgId), eq(orders.status, args.status)) : eq(orders.orgId, ctx.orgId))
        .orderBy(desc(orders.createdAt))
        .limit(args.limit);

      const items = rows.map((row) => ({
        ...row,
        totalAmountMinor: row.totalAmountMinor.toString(),
        createdAt: row.createdAt?.toISOString() ?? null,
      }));

      return {
        summary: `${items.length} order(s) returned.`,
        cards: [{ type: 'orders', title: ctx.locale === 'ar' ? 'الطلبات' : 'Orders', items }],
        data: items,
      };
    },
  },
  {
    definition: {
      name: 'products_search',
      description: 'Search or list products for the current organization. Use for SKU, price, stock, and product status questions.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          q: { type: 'string', maxLength: 100 },
          status: { type: 'string', enum: ['active', 'draft', 'archived'] },
          limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
        },
      },
    },
    permission: { resource: 'products', action: 'view' },
    input: z.object({
      q: z.string().max(100).optional(),
      status: z.enum(['active', 'draft', 'archived']).optional(),
      limit: limitSchema,
    }).strict(),
    async execute(ctx, input) {
      const args = this.input.parse(input) as { q?: string; status?: string; limit: number };
      const conditions = [eq(products.orgId, ctx.orgId)];
      if (args.q) conditions.push(ilike(products.name, `%${args.q}%`));
      if (args.status) conditions.push(eq(products.status, args.status));

      const rows = await ctx.db
        .select({
          id: products.id,
          name: products.name,
          nameAr: products.nameAr,
          sku: products.sku,
          status: products.status,
          priceMinor: products.priceMinor,
          currency: products.currency,
          stock: products.stock,
        })
        .from(products)
        .where(and(...conditions))
        .orderBy(asc(products.name))
        .limit(args.limit);

      const items = rows.map((row) => ({
        id: row.id,
        name: ctx.locale === 'ar' && row.nameAr ? row.nameAr : row.name,
        sku: row.sku,
        status: row.status,
        priceMinor: row.priceMinor.toString(),
        currency: row.currency,
        stock: row.stock,
      }));

      return {
        summary: `${items.length} product(s) returned.`,
        cards: [{ type: 'products', title: ctx.locale === 'ar' ? 'المنتجات' : 'Products', items }],
        data: items,
      };
    },
  },
  {
    definition: {
      name: 'inventory_snapshot',
      description: 'Read inventory levels for the current organization. Use for low stock, out-of-stock, reorder, and available quantity questions.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          state: { type: 'string', enum: ['out', 'low', 'ok'] },
          limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
        },
      },
    },
    permission: { resource: 'inventory', action: 'view' },
    input: z.object({
      state: z.enum(['out', 'low', 'ok']).optional(),
      limit: limitSchema,
    }).strict(),
    async execute(ctx, input) {
      const args = this.input.parse(input) as { state?: 'out' | 'low' | 'ok'; limit: number };
      const stateFilter =
        args.state === 'out' ? lte(inventoryItems.quantity, 0)
          : args.state === 'low' ? and(gte(inventoryItems.quantity, 1), lte(inventoryItems.quantity, inventoryItems.reorderPoint))
            : args.state === 'ok' ? gte(inventoryItems.quantity, inventoryItems.reorderPoint)
              : undefined;

      const rows = await ctx.db
        .select({
          id: inventoryItems.id,
          quantity: inventoryItems.quantity,
          reorderPoint: inventoryItems.reorderPoint,
          variantName: productVariants.name,
          sku: productVariants.sku,
          productName: products.name,
          productNameAr: products.nameAr,
        })
        .from(inventoryItems)
        .innerJoin(productVariants, eq(inventoryItems.variantId, productVariants.id))
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(stateFilter ? and(eq(inventoryItems.orgId, ctx.orgId), stateFilter) : eq(inventoryItems.orgId, ctx.orgId))
        .orderBy(asc(inventoryItems.quantity))
        .limit(args.limit);

      const items = rows.map((row) => ({
        id: row.id,
        productName: ctx.locale === 'ar' && row.productNameAr ? row.productNameAr : row.productName,
        variantName: row.variantName,
        sku: row.sku,
        quantity: row.quantity,
        reorderPoint: row.reorderPoint,
        state: stateOf(row.quantity, row.reorderPoint),
      }));

      return {
        summary: `${items.length} inventory item(s) returned.`,
        cards: [{ type: 'inventory', title: ctx.locale === 'ar' ? 'المخزون' : 'Inventory', items }],
        data: items,
      };
    },
  },
  {
    definition: {
      name: 'sales_summary',
      description: 'Read a sales summary for the current organization. Requires finance view permission.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          days: { type: 'integer', minimum: 1, maximum: 90, default: 30 },
        },
      },
    },
    permission: { resource: 'finance', action: 'view' },
    input: z.object({
      days: z.number().int().min(1).max(90).default(30),
    }).strict(),
    async execute(ctx, input) {
      const args = this.input.parse(input) as { days: number };
      const start = new Date();
      start.setDate(start.getDate() - args.days);

      const [allRows, deliveredRows, pendingRows, cancelledRows] = await Promise.all([
        ctx.db.select({ count: count(), total: sum(orders.totalAmountMinor) }).from(orders).where(and(eq(orders.orgId, ctx.orgId), gte(orders.createdAt, start))),
        ctx.db.select({ count: count(), total: sum(orders.totalAmountMinor) }).from(orders).where(and(eq(orders.orgId, ctx.orgId), gte(orders.createdAt, start), eq(orders.status, 'delivered'))),
        ctx.db.select({ count: count() }).from(orders).where(and(eq(orders.orgId, ctx.orgId), gte(orders.createdAt, start), eq(orders.status, 'pending'))),
        ctx.db.select({ count: count() }).from(orders).where(and(eq(orders.orgId, ctx.orgId), gte(orders.createdAt, start), eq(orders.status, 'cancelled'))),
      ]);

      const deliveredTotal = asMinor(deliveredRows[0]?.total as string | null);
      const totalOrders = allRows[0]?.count ?? 0;
      const deliveredCount = deliveredRows[0]?.count ?? 0;
      const pendingCount = pendingRows[0]?.count ?? 0;
      const cancelledCount = cancelledRows[0]?.count ?? 0;

      return {
        summary: `${totalOrders} order(s), ${deliveredCount} delivered, ${pendingCount} pending, delivered revenue ${deliveredTotal} minor units.`,
        cards: [{
          type: 'sales_summary',
          title: ctx.locale === 'ar' ? `ملخص آخر ${args.days} يوم` : `Last ${args.days} days`,
          metrics: [
            { label: ctx.locale === 'ar' ? 'إجمالي الطلبات' : 'Total orders', value: String(totalOrders) },
            { label: ctx.locale === 'ar' ? 'طلبات مسلّمة' : 'Delivered orders', value: String(deliveredCount), tone: 'good' },
            { label: ctx.locale === 'ar' ? 'طلبات معلقة' : 'Pending orders', value: String(pendingCount), tone: 'warning' },
            { label: ctx.locale === 'ar' ? 'طلبات ملغية' : 'Cancelled orders', value: String(cancelledCount) },
            { label: ctx.locale === 'ar' ? 'إيراد مسلّم' : 'Delivered revenue', value: `${deliveredTotal} EGP minor` },
          ],
        }],
        data: { days: args.days, totalOrders, deliveredCount, pendingCount, cancelledCount, deliveredRevenueMinor: deliveredTotal },
      };
    },
  },
];

// Legacy inventory_items are organization-wide and predate warehouse
// attribution. Do not let a warehouse-scoped profile obtain that aggregate
// through a conversational path while it is intentionally blocked in the UI.
function isAvailableToContext(tool: AiTool, ctx: AiRequestContext): boolean {
  if (tool.definition.name === 'inventory_snapshot' && ctx.accessPolicy && ctx.assignedWarehouseIds.length > 0) {
    return false;
  }
  return canWithPolicy(ctx.role, tool.permission.resource, tool.permission.action, ctx.accessPolicy, ctx.permissionOverrides);
}

export function allowedAiToolDefinitions(ctx: AiRequestContext): AiToolDefinition[] {
  return AI_TOOLS
    .filter((tool) => isAvailableToContext(tool, ctx))
    .map((tool) => tool.definition);
}

export async function executeAiTool(name: string, args: unknown, ctx: ToolExecuteContext): Promise<AiToolResult> {
  const tool = AI_TOOLS.find((candidate) => candidate.definition.name === name);
  if (!tool) {
    throw new Error(`Unknown AI tool: ${name}`);
  }

  if (!isAvailableToContext(tool, ctx)) {
    throw new Error(`Forbidden AI tool: ${name}`);
  }

  return tool.execute(ctx, args);
}
