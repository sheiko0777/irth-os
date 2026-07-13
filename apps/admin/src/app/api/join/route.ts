import { NextRequest, NextResponse } from 'next/server';
import { db, orgInvites, orgMembers } from '@irth/db';
import { eq } from 'drizzle-orm';
import { verifySession } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const session = await verifySession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token : null;
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 });

  const [invite] = await db
    .select()
    .from(orgInvites)
    .where(eq(orgInvites.token, token))
    .limit(1);

  if (!invite) return NextResponse.json({ error: 'Invalid invite token' }, { status: 404 });

  if (invite.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Invite has expired' }, { status: 410 });
  }

  if (invite.email.toLowerCase() !== (session.user.email ?? '').toLowerCase()) {
    return NextResponse.json({ error: 'This invite is for a different email address' }, { status: 403 });
  }

  // Check not already a member
  const [existing] = await db
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(eq(orgMembers.userId, session.user.id))
    .limit(1);

  if (!existing) {
    await db.insert(orgMembers).values({
      orgId: invite.orgId,
      userId: session.user.id,
      role: invite.role,
    });
  }

  await db.delete(orgInvites).where(eq(orgInvites.id, invite.id));

  return NextResponse.json({ data: { orgId: invite.orgId, role: invite.role } });
}
