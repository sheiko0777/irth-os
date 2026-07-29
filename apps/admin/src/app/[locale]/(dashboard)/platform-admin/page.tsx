import { serverCaller } from '@/server/caller';
import PlatformAdminClient, { type OrgRow } from './PlatformAdminClient';

export const metadata = { title: 'لوحة الأدمن | IRTH' };

interface Props { params: Promise<{ locale: string }> }

export default async function PlatformAdminPage({ params }: Props) {
  const { locale } = await params;
  try {
    const caller = await serverCaller();
    const res = await caller.platformAdmin.listOrgs({});
    const initialOrgs = (res.data ?? []) as OrgRow[];
    return (
      <div>
        <PlatformAdminClient initialOrgs={initialOrgs} locale={locale} />
      </div>
    );
  } catch {
    return (
      <div className="p-8 text-center" style={{ color: 'var(--crimson)' }}>
        غير مصرح بالوصول — لوحة الأدمن للنظام فقط
      </div>
    );
  }
}
