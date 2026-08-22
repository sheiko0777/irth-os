import {
    pgTable,
    uuid,
    text,
    timestamp,
    boolean,
    integer,
    uniqueIndex,
    index,
    numeric,
    bigint,
} from 'drizzle-orm/pg-core';
import { organizations } from '../schema';

export const coupons = pgTable(
    'coupons',
    {
        id: uuid('id').defaultRandom().primaryKey(),
        orgId: uuid('org_id')
            .notNull()
            .references(() => organizations.id, { onDelete: 'cascade' }),
        code: text('code').notNull(),
        type: text('type').notNull().$type<'percentage' | 'fixed' | 'free_shipping'>(),
        // `value` is polymorphic — a percentage (0-100) when type='percentage',
        // an EGP amount when type='fixed' — so it stays a plain decimal rather
        // than joining the minor-units migration; application code branches on
        // `type` before deciding whether to treat it as money at all.
        value: numeric('value', { precision: 10, scale: 2 }).notNull().default('0'),
        minOrderAmount: numeric('min_order_amount', { precision: 12, scale: 2 }),
        minOrderAmountMinor: bigint('min_order_amount_minor', { mode: 'number' }),
        maxUses: integer('max_uses'),
        usedCount: integer('used_count').notNull().default(0),
        expiresAt: timestamp('expires_at'),
        isActive: boolean('is_active').notNull().default(true),
        description: text('description'),
        createdAt: timestamp('created_at').defaultNow(),
        updatedAt: timestamp('updated_at').defaultNow(),
    },
    (table) => ({
        orgCodeIdx: uniqueIndex('coupons_org_code_idx').on(table.orgId, table.code),
        orgIdIdx: index('coupons_org_id_idx').on(table.orgId),
    })
);
