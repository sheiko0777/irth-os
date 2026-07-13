import { db, orgInvites, organizations } from '@irth/db';
import { eq } from 'drizzle-orm';
import JoinClient from './JoinClient';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}

export const metadata = { title: 'قبول الدعوة | IRTH' };

export default async function JoinPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="text-center" style={{ color: 'var(--crimson)' }}>
        رابط الدعوة غير صالح
      </div>
    );
  }

  const [invite] = await db
    .select({
      id: orgInvites.id,
      email: orgInvites.email,
      role: orgInvites.role,
      expiresAt: orgInvites.expiresAt,
      orgId: orgInvites.orgId,
    })
    .from(orgInvites)
    .where(eq(orgInvites.token, token))
    .limit(1);

  if (!invite) {
    return (
      <div className="text-center font-cairo" style={{ color: 'var(--crimson)' }}>
        الدعوة غير موجودة أو تم استخدامها
      </div>
    );
  }

  if (invite.expiresAt < new Date()) {
    return (
      <div className="text-center font-cairo" style={{ color: 'var(--crimson)' }}>
        انتهت صلاحية الدعوة — تواصل مع المسؤول للحصول على دعوة جديدة
      </div>
    );
  }

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, invite.orgId))
    .limit(1);

  return (
    <JoinClient
      token={token}
      email={invite.email}
      orgName={org?.name ?? ''}
      locale={locale}
    />
  );
}
