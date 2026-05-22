"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";

type Props = {
  actionType: "create" | "updateStatus" | "receive";
  poId?: string;
  status?: "draft" | "ordered" | "partial" | "received" | "cancelled";
  label?: string;
};

export default function PurchasingActions({ actionType, poId, status, label }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const createPoMutation = trpc.purchasing.po.create.useMutation();
  const updateStatusMutation = trpc.purchasing.po.updateStatus.useMutation();

  const handleAction = async () => {
    setLoading(true);
    try {
      if (actionType === "create") {
        // Quick create stub for demo
        await createPoMutation.mutateAsync({
          items: [{ productName: "عنصر جديد", quantity: 1 }],
        });
        router.refresh();
      } else if (actionType === "updateStatus" && poId && status) {
        await updateStatusMutation.mutateAsync({
          id: poId,
          status,
        });
        router.refresh();
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  if (actionType === "create") {
    return (
      <Button onClick={handleAction} disabled={loading}>
        {loading ? "جاري الإنشاء..." : "إنشاء أمر شراء"}
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={handleAction} disabled={loading}>
      {loading ? "..." : label || "إجراء"}
    </Button>
  );
}
