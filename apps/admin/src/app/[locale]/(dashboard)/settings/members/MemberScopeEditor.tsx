'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

type Kind = "brand" | "supplier";
const KIND_LABELS: Record<Kind, string> = { brand: "البراندات", supplier: "الموردين" };

/**
 * نطاق البيانات (PR-1e): limit a member to some brands and/or suppliers. None
 * ticked means no limit. Enforced by the database (0076) and the server, not
 * by this screen. Warehouse and channel scopes come once stock and orders
 * carry those columns.
 */
export function MemberScopeEditor({
  memberId, initial, canEdit,
}: { memberId: string; initial: { brand: readonly string[]; supplier: readonly string[] }; canEdit: boolean }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const options = trpc.accounts.scopeOptions.useQuery(undefined, { enabled: canEdit });
  const [picked, setPicked] = useState<Record<Kind, Set<string>>>({
    brand: new Set(initial.brand), supplier: new Set(initial.supplier),
  });

  const save = trpc.accounts.setScopes.useMutation({
    onSuccess: () => {
      toast.success("تم حفظ النطاق");
      void utils.accounts.effective.invalidate({ memberId });
      router.refresh();
    },
    onError: (err) => toast.error(err.message || "تعذر حفظ النطاق"),
  });

  const toggle = (kind: Kind, id: string) => setPicked((prev) => {
    const next = new Set(prev[kind]);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { ...prev, [kind]: next };
  });

  if (!canEdit) {
    const count = initial.brand.length + initial.supplier.length;
    return <p className="text-sm text-[var(--t3)]">النطاق: {count === 0 ? "كل البيانات" : `${count} عنصر محدد`}</p>;
  }

  const lists: Record<Kind, Array<{ id: string; name: string }>> = {
    brand: options.data?.data.brands ?? [],
    supplier: options.data?.data.suppliers ?? [],
  };

  return (
    <fieldset className="space-y-3 rounded-md border border-[var(--rim1)] p-3">
      <legend className="px-1 text-sm font-semibold">نطاق البيانات</legend>
      <p className="text-xs text-[var(--t3)]">من غير اختيار = يشوف كل البيانات. لو اخترت، هيشوف اللي اخترته بس.</p>
      {(Object.keys(KIND_LABELS) as Kind[]).map((kind) => (
        <div key={kind} className="space-y-1">
          <p className="text-sm font-medium">{KIND_LABELS[kind]}</p>
          {lists[kind].length === 0 ? (
            <p className="text-xs text-[var(--t3)]">لا يوجد.</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {lists[kind].map((opt) => (
                <label key={opt.id} className="inline-flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={picked[kind].has(opt.id)} onChange={() => toggle(kind, opt.id)}
                    aria-label={`${KIND_LABELS[kind]}: ${opt.name}`} />
                  {opt.name}
                </label>
              ))}
            </div>
          )}
        </div>
      ))}
      <Button
        type="button" size="sm" variant="outline" disabled={save.isPending}
        onClick={() => save.mutate({ memberId, brand: [...picked.brand], supplier: [...picked.supplier] })}
      >
        {save.isPending ? "جارٍ الحفظ…" : "حفظ النطاق"}
      </Button>
    </fieldset>
  );
}
