import { serverCaller } from '@/server/caller';
import { ReturnsClient, Return, SummaryData } from './ReturnsClient';

export const metadata = {
  title: 'Returns | IRTH',
};

type DbReturn = {
    id: string;
    createdAt: Date | null;
    orgId: string;
    status: "requested" | "approved" | "rejected" | "received" | "restocked" | "refunded" | "exchanged";
    updatedAt: Date | null;
    orderId: string;
    returnNumber: string;
    reason: "damaged" | "wrong_item" | "not_as_described" | "changed_mind" | "other";
    resolutionType: "refund" | "exchange" | "store_credit" | "none";
    notes: string | null;
    adminNotes: string | null;
    refundAmount: string | null;
    requestedAt: Date | null;
    resolvedAt: Date | null;
};

// Map the DB return type to our generic Return interface.
function mapReturn(dbRet: DbReturn): Return {
  return {
    id: dbRet.id,
    orderId: dbRet.orderId,
    returnNumber: dbRet.returnNumber,
    status: dbRet.status,
    reason: dbRet.reason,
    resolutionType: dbRet.resolutionType,
    notes: dbRet.notes,
    adminNotes: dbRet.adminNotes,
    refundAmount: dbRet.refundAmount,
    requestedAt: dbRet.requestedAt,
    resolvedAt: dbRet.resolvedAt,
    createdAt: dbRet.createdAt,
    updatedAt: dbRet.updatedAt,
  };
}

export default async function ReturnsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  const caller = await serverCaller();

  const [summaryRes, returnsRes] = await Promise.all([
    caller.returns.summary(),
    caller.returns.list({ page: 1, pageSize: 50 }),
  ]);

  const summary = summaryRes.data;
  const returns = (returnsRes.data as unknown as DbReturn[]).map(mapReturn);

  const mappedSummary: SummaryData = {
    total: summary.total,
    byStatus: {
      requested: summary.byStatus.requested,
      approved: summary.byStatus.approved,
      rejected: summary.byStatus.rejected,
      received: summary.byStatus.received,
      restocked: summary.byStatus.restocked,
      refunded: summary.byStatus.refunded,
      exchanged: summary.byStatus.exchanged,
    },
    pendingRefundAmount: summary.pendingRefundAmount
  };

  return (
    <ReturnsClient 
      returns={returns} 
      summary={mappedSummary} 
      locale={locale} 
    />
  );
}
