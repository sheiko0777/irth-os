import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { channels, legalEntities } from './schema/dimensions';
import { organizations } from './schema';
import type { DbTx } from './index';

export interface LedgerEntity {
  legalEntityId: string;
  functionalCurrency: string;
  /** The entity's default selling channel (code 'shopify-main' first), if it has one. */
  channelId: string | null;
  brandId: string | null;
  warehouseId: string | null;
}

/**
 * The legal entity a posting belongs to — `legalEntityId` if given, else the
 * org's default (organizations.stock_owner_entity_id, 0069) — with its
 * functional currency and default selling channel. One query. Used by
 * postJournalEntry (ledger.ts).
 */
export async function resolveLedgerEntity(
  tx: Pick<DbTx, 'select'>,
  orgId: string,
  legalEntityId?: string,
): Promise<LedgerEntity> {
  const entityMatch = legalEntityId
    ? eq(legalEntities.id, legalEntityId)
    : eq(legalEntities.id, sql`(SELECT ${organizations.stockOwnerEntityId} FROM ${organizations} WHERE ${organizations.id} = ${orgId})`);
  const [row] = await tx
    .select({
      legalEntityId: legalEntities.id,
      functionalCurrency: legalEntities.functionalCurrency,
      channelId: channels.id,
      brandId: channels.brandId,
      warehouseId: channels.defaultWarehouseId,
    })
    .from(legalEntities)
    .leftJoin(channels, and(
      eq(channels.orgId, legalEntities.orgId),
      eq(channels.sellingEntityId, legalEntities.id),
      eq(channels.isActive, true),
    ))
    .where(and(eq(legalEntities.orgId, orgId), entityMatch))
    .orderBy(desc(sql`${channels.code} = 'shopify-main'`), asc(channels.createdAt), asc(channels.id))
    .limit(1);
  if (!row) {
    throw new Error(`No legal entity ${legalEntityId ?? '(org default)'} for org ${orgId}.`);
  }
  return {
    legalEntityId: row.legalEntityId,
    functionalCurrency: row.functionalCurrency,
    channelId: row.channelId ?? null,
    brandId: row.brandId ?? null,
    warehouseId: row.warehouseId ?? null,
  };
}
