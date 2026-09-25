import { pgTable, uuid, text, jsonb, timestamp, unique, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from '../schema';

// Mirrors migration 0074 (owner decision A5). The composite same-org FKs
// (org_members.access_role_id, member_scopes.member_id) live in the migration
// rather than here, the same way schema/dimensions.ts avoids a cycle with
// schema.ts.

export const PRINCIPAL_KINDS = ['staff', 'delivery_rep', 'sales_rep', 'supplier'] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

export const SCOPE_KINDS = ['warehouse', 'brand', 'channel', 'supplier'] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

/** {resource: [action, ...]} — the shape a custom role stores. */
export type PermissionList = Record<string, string[]>;

/**
 * A role an org can assign. System roles (systemKey owner|admin|member) store
 * no permission list: theirs is the code matrix in permissions.ts, by
 * definition. Custom roles (systemKey null) store their own.
 */
export const accessRoles = pgTable('access_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  principalKind: text('principal_kind').$type<PrincipalKind>().notNull().default('staff'),
  systemKey: text('system_key').$type<'owner' | 'admin' | 'member'>(),
  permissions: jsonb('permissions').$type<PermissionList>().notNull().default({}),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  unique('access_roles_org_name_uq').on(t.orgId, t.name),
  unique('access_roles_id_org_uq').on(t.id, t.orgId),
  uniqueIndex('access_roles_org_system_key_uq').on(t.orgId, t.systemKey).where(sql`${t.systemKey} IS NOT NULL`),
  index('access_roles_org_id_idx').on(t.orgId),
  check('access_roles_principal_kind_check', sql`${t.principalKind} IN ('staff', 'delivery_rep', 'sales_rep', 'supplier')`),
  check('access_roles_system_key_check', sql`${t.systemKey} IS NULL OR ${t.systemKey} IN ('owner', 'admin', 'member')`),
  check('access_roles_system_has_no_list_check', sql`${t.systemKey} IS NULL OR ${t.permissions} = '{}'::jsonb`),
  check('access_roles_permissions_object_check', sql`jsonb_typeof(${t.permissions}) = 'object'`),
]);

/** Limits a member to specific warehouses/brands/channels/a supplier. No rows = unrestricted. */
export const memberScopes = pgTable('member_scopes', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  memberId: uuid('member_id').notNull(),
  scopeKind: text('scope_kind').$type<ScopeKind>().notNull(),
  scopeId: uuid('scope_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  unique('member_scopes_member_kind_scope_uq').on(t.memberId, t.scopeKind, t.scopeId),
  index('member_scopes_org_id_idx').on(t.orgId),
  check('member_scopes_kind_check', sql`${t.scopeKind} IN ('warehouse', 'brand', 'channel', 'supplier')`),
]);
