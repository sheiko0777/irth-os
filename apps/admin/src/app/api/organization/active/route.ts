import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, orgMembers, ACTIVE_ORGANIZATION_COOKIE, isOrganizationId } from '@irth/db';
import { verifySession } from '@/lib/auth';

const bodySchema = z.object({ organizationId: z.string().uuid() });

export async function POST(request: Request) {
  const session = await verifySession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success || !isOrganizationId(parsed.data.organizationId)) return NextResponse.json({ error: 'Invalid organizationId' }, { status: 400 });

  const [membership] = await db.select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, session.user.id), eq(orgMembers.orgId, parsed.data.organizationId)))
    .limit(1);
  if (!membership) return NextResponse.json({ error: 'Organization access denied' }, { status: 403 });

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORGANIZATION_COOKIE, membership.orgId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return NextResponse.json({ data: { organizationId: membership.orgId }, error: null });
}

export async function DELETE() {
  const session = await verifySession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_ORGANIZATION_COOKIE);
  return NextResponse.json({ data: null, error: null });
}
