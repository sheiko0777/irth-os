import { serverCaller } from '@/server/caller';
import PlatformAdminClient, { type OrgRow } from './PlatformAdminClient';

export const metadata = { title: 'لوحة الأدمن | IRTH' };

export default async function PlatformAdminPage() {
  try {
    const caller = await serverCaller();
    const res = await caller.platformAdmin.listOrgs({});
    const initialOrgs = (res.data ?? []) as OrgRow[];
    return (
      <div dir="rtl">
        <PlatformAdminClient initialOrgs={initialOrgs} />
      </div>
    );
  } catch {
    return (
      <div dir="rtl" className="font-cairo p-8 text-center" style={{ color: 'var(--crimson)' }}>
        غير مصرح بالوصول — لوحة الأدمن للنظام فقط
      </div>
    );
  }
}
