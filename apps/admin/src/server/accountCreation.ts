import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { account, memberScopes, orgMembers, user, type DbTx } from '@irth/db';
import type { Context } from './trpc';
import { pgCode } from './permissionInput';

/**
 * Creating an account directly (PR-1d), shared by accounts.create and the
 * supplier portal account (PR-3) so both write the user, their credential,
 * their membership and their scopes the same way, inside the caller's
 * transaction.
 */

// Better Auth's username plugin normalises to lower case and allows these
// characters; 3–30 long. A mobile number fits.
export const usernameSchema = z.string().trim().toLowerCase().min(3).max(30).regex(/^[a-z0-9_.]+$/);

// No 0/O, 1/l/I: read aloud or copied from a screen without mistakes.
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function temporaryPassword(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join('');
}

/** Accounts without an email still need one (Better Auth requires it). `.invalid` never delivers. */
export function placeholderEmail(username: string): string {
  return `${username}@accounts.irth.invalid`;
}

export function rethrowAccountError(err: unknown): never {
  const code = pgCode(err);
  if (code === '23505') throw new TRPCError({ code: 'CONFLICT', message: 'اسم المستخدم أو البريد مستخدم بالفعل.' });
  if (code === '23514' && String((err as { cause?: { message?: string } }).cause?.message ?? err).includes('active owner')) {
    throw new TRPCError({ code: 'CONFLICT', message: 'لازم يفضل في المؤسسة مالك نشط واحد على الأقل.' });
  }
  throw err;
}

type Scope = { scopeKind: 'brand' | 'supplier' | 'pricelist'; scopeId: string };

/**
 * The user, their password credential (already hashed — hash outside the
 * transaction, scrypt is slow), their membership on a temporary password, and
 * their scopes. The caller runs this inside withAudit.
 */
export async function insertAccount(
  tx: DbTx,
  ctx: Pick<Context, 'orgId'>,
  input: {
    userId: string; name: string; username: string; email?: string | null; passwordHash: string;
    role: { id: string; systemKey: string | null; principalKind: 'staff' | 'delivery_rep' | 'sales_rep' | 'supplier' };
    scopes: readonly Scope[];
  },
) {
  await tx.insert(user).values({
    id: input.userId,
    name: input.name,
    email: input.email ?? placeholderEmail(input.username),
    emailVerified: false,
    username: input.username,
    displayUsername: input.username,
  });
  await tx.insert(account).values({
    id: crypto.randomUUID(),
    accountId: input.userId,
    providerId: 'credential',
    userId: input.userId,
    password: input.passwordHash,
    updatedAt: new Date(),
  });
  const [row] = await tx.insert(orgMembers).values({
    orgId: ctx.orgId,
    userId: input.userId,
    role: (input.role.systemKey ?? 'member') as 'owner' | 'admin' | 'member',
    accessRoleId: input.role.id,
    principalKind: input.role.principalKind,
    mustChangePassword: true,
  }).returning();
  if (input.scopes.length > 0) {
    await tx.insert(memberScopes).values(input.scopes.map((sc) => ({ ...sc, orgId: ctx.orgId, memberId: row.id })));
  }
  return row;
}

/** The creator's own scopes: nobody creates an account that sees more than they do. */
export function inheritedScopes(ctx: Pick<Context, 'access'>): Scope[] {
  return [
    ...ctx.access.scopes.brand.map((id) => ({ scopeKind: 'brand' as const, scopeId: id })),
    ...ctx.access.scopes.supplier.map((id) => ({ scopeKind: 'supplier' as const, scopeId: id })),
    ...ctx.access.scopes.pricelist.map((id) => ({ scopeKind: 'pricelist' as const, scopeId: id })),
  ];
}
