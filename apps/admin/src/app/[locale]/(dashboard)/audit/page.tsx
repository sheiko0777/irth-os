import { serverCaller } from '@/server/caller';
import { AuditClient } from './AuditClient';

export default async function AuditLogsPage() {
  const caller = await serverCaller();
  const [initialData, stats] = await Promise.all([
    caller.audit.list({ page: 1, pageSize: 25 }),
    caller.audit.stats(),
  ]);

  return <AuditClient initialData={initialData} initialStats={stats} />;
}
