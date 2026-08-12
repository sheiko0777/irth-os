import {
    pgTable,
    uuid,
    text,
    timestamp,
    boolean,
    integer,
    uniqueIndex,
    index,
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
        // `value` used to be one numeric column holding two different kinds of
        // number: a RATE when type='percentage', MONEY when type='fixed'. Any
        // blanket "money x 100" conversion would have turned a 10% coupon into
        // 1000%. Split so the type system and a CHECK constraint both know
        // which applies — see 0028_money_minor_units.sql.
        percentBp: integer('percent_bp'),
        amountMinor: bigint('amount_minor', { mode: 'bigint' }),
        minOrderAmountMinor: bigint('min_order_amount_minor', { mode: 'bigint' }),
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
