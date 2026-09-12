import { db, organizations, getValidInvite } from '@irth/db';
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

  const result = await getValidInvite(db, token);

  if (!result.ok) {
    return (
      <div className="text-center" style={{ color: 'var(--crimson)' }}>
        {result.reason === 'expired'
          ? 'انتهت صلاحية الدعوة — تواصل مع المسؤول للحصول على دعوة جديدة'
          : 'الدعوة غير موجودة أو تم استخدامها'}
      </div>
    );
  }

  const { invite } = result;

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
