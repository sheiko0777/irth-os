'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { FormDialog } from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RESOURCE_LABELS, actionLabel, catalog } from "@/lib/permissionCatalog";

type Mode = "role" | "grant" | "revoke";
type List = Record<string, string[]>;

const MODE_LABELS: Record<Mode, string> = { role: "حسب الدور", grant: "منح", revoke: "سحب" };

function modesFrom(overrides: { grant?: List; revoke?: List }): Map<string, Mode> {
  const out = new Map<string, Mode>();
  for (const [r, actions] of Object.entries(overrides.grant ?? {})) for (const a of actions) out.set(`${r}.${a}`, "grant");
  for (const [r, actions] of Object.entries(overrides.revoke ?? {})) for (const a of actions) out.set(`${r}.${a}`, "revoke");
  return out;
}

function listOf(modes: Map<string, Mode>, mode: Mode): List {
  const out: List = {};
  for (const [k, m] of modes) {
    if (m !== mode) continue;
    const [resource, action] = k.split(".");
    (out[resource] ??= []).push(action);
  }
  return out;
}

/**
 * "الصلاحيات الفعلية" plus per-person exceptions (PR-1d): what this member can
 * do right now, and, for each permission, whether it follows the role, is
 * granted to them personally, or is taken from them personally.
 */
export function MemberAccessDialog({
  memberId, name, canEdit, onClose,
}: { memberId: string; name: string; canEdit: boolean; onClose: () => void }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const effective = trpc.accounts.effective.useQuery({ memberId });
  const [modes, setModes] = useState<Map<string, Mode> | null>(null);
  const current = modes ?? (effective.data ? modesFrom(effective.data.data.overrides) : new Map<string, Mode>());
  const held = new Set(effective.data?.data.permissions ?? []);

  const save = trpc.accounts.setOverrides.useMutation({
    onSuccess: () => {
      toast.success("تم حفظ الاستثناءات");
      void utils.accounts.effective.invalidate({ memberId });
      router.refresh();
      onClose();
    },
    onError: (err) => toast.error(err.message || "تعذر الحفظ"),
  });

  const setMode = (k: string, mode: Mode) => {
    const next = new Map(current);
    if (mode === "role") next.delete(k); else next.set(k, mode);
    setModes(next);
  };

  return (
    <FormDialog open title={`صلاحيات ${name}`} onClose={onClose} width="760px">
      {effective.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-[var(--t3)]">
            الدور: <strong>{effective.data?.data.roleName ?? "—"}</strong>
            {" · "}يقدر يعمل {held.size} عملية دلوقتي
            {effective.data?.data.status === "suspended" && " · الحساب موقوف"}
          </p>
          <div className="max-h-[55vh] overflow-y-auto rounded-md border border-[var(--rim1)]">
            <table className="w-full text-sm">
              <caption className="sr-only">صلاحيات العضو لكل شاشة</caption>
              <thead className="sticky top-0 bg-[var(--raised)] text-[var(--t2)]">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-medium">الصلاحية</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">فعليًا</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">استثناء</th>
                </tr>
              </thead>
              <tbody>
                {catalog().flatMap(({ resource, actions }) => actions.map((action) => {
                  const k = `${resource}.${action}`;
                  const label = `${RESOURCE_LABELS[resource]}: ${actionLabel(resource, action)}`;
                  return (
                    <tr key={k} className="border-t border-[var(--rim1)]">
                      <th scope="row" className="px-3 py-1.5 text-start font-normal">{label}</th>
                      <td className="px-3 py-1.5">{held.has(k) ? "✓" : "—"}</td>
                      <td className="px-3 py-1.5">
                        <select
                          aria-label={`استثناء ${label}`}
                          className="h-9 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2 text-xs"
                          value={current.get(k) ?? "role"}
                          disabled={!canEdit}
                          onChange={(e) => setMode(k, e.target.value as Mode)}
                        >
                          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
                            <option key={m} value={m}>{MODE_LABELS[m]}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{canEdit ? "إلغاء" : "إغلاق"}</Button>
            {canEdit && (
              <Button
                type="button"
                disabled={save.isPending}
                onClick={() => save.mutate({ memberId, grant: listOf(current, "grant"), revoke: listOf(current, "revoke") })}
              >
                {save.isPending ? "جارٍ الحفظ…" : "حفظ الاستثناءات"}
              </Button>
            )}
          </div>
        </div>
      )}
    </FormDialog>
  );
}
