'use client';

import { toast } from "sonner";
import { formatDate } from "@irth/domain";
import { trpc } from "@/lib/trpc";
import { useCan } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

const LABELS = { pending: "مستني المورد", confirmed: "المورد أكد", date_proposed: "المورد اقترح موعد" } as const;

/** The supplier's answer on a purchase order, and the buyer's reply to a proposed date (PR-3). */
export function PoSupplierStatus({ po }: {
  po: { id: string; status: string; supplierStatus: keyof typeof LABELS; proposedDeliveryAt: Date | string | null; expectedDeliveryAt: Date | string | null };
}) {
  const can = useCan();
  const utils = trpc.useUtils();
  const done = () => void utils.purchasing.po.list.invalidate();
  const accept = trpc.purchasing.po.acceptProposedDate.useMutation({ onSuccess: () => { toast.success("اتقبل الموعد"); done(); }, onError: (e) => toast.error(e.message) });
  const reject = trpc.purchasing.po.rejectProposedDate.useMutation({ onSuccess: () => { toast.success("اترفض الموعد"); done(); }, onError: (e) => toast.error(e.message) });
  if (po.status === "draft") return <>—</>;
  return (
    <div className="space-y-1 text-xs">
      <p>{LABELS[po.supplierStatus]}{po.expectedDeliveryAt ? ` · ${formatDate(po.expectedDeliveryAt)}` : ""}</p>
      {po.supplierStatus === "date_proposed" && po.proposedDeliveryAt && (
        <div className="flex items-center gap-1">
          <span>{formatDate(po.proposedDeliveryAt)}</span>
          {can("purchasing", "write") && (
            <>
              <Button size="sm" variant="outline" disabled={accept.isPending} onClick={() => accept.mutate({ id: po.id })}>قبول</Button>
              <Button size="sm" variant="outline" disabled={reject.isPending} onClick={() => reject.mutate({ id: po.id })}>رفض</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
