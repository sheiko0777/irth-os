'use client';

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCan } from "@/lib/permissions";
import { PRINCIPAL_KIND_LABELS } from "@/lib/permissionCatalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { RoleEditor, type PrincipalKind, type RoleDraft } from "./RoleEditor";

type Editing =
  | { mode: "create"; initial: RoleDraft }
  | { mode: "edit"; id: string; initial: RoleDraft }
  | { mode: "view"; initial: RoleDraft };

const EMPTY: RoleDraft = { name: "", principalKind: "staff", permissions: {} };

// PR-2a: a starting point for a delivery rep — their own deliveries, cash
// collection, the end-of-day handover, and the customer's phone and address.
// Edited like any other new role before it is saved.
const DELIVERY_REP_TEMPLATE: RoleDraft = {
  name: "مندوب توصيل",
  principalKind: "delivery_rep",
  permissions: {
    deliveries: ["view", "update", "collect"],
    repCash: ["handover"],
    sensitive: ["customerContact"],
  },
};

// PR-2b: a sales rep — their own customers, orders and quotes, and the
// customer's contact details. Which price lists they may use is a data scope
// on the member (نطاق البيانات), not part of the role.
const SALES_REP_TEMPLATE: RoleDraft = {
  name: "مندوب مبيعات",
  principalKind: "sales_rep",
  permissions: {
    sales: ["view", "customers", "order", "quote"],
    sensitive: ["customerContact"],
  },
};

function countPermissions(list: Record<string, string[]>): number {
  return Object.values(list).reduce((n, actions) => n + actions.length, 0);
}

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "تعذر حفظ الدور";
}

export function RolesManager() {
  const can = useCan();
  const canManage = can("roles", "manage");
  const utils = trpc.useUtils();
  const { data, isLoading, error, refetch } = trpc.roles.list.useQuery();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const done = (message: string) => {
    toast.success(message);
    setEditing(null);
    setSaveError(null);
    void utils.roles.list.invalidate();
  };
  const create = trpc.roles.create.useMutation({
    onSuccess: () => done("تم إنشاء الدور"),
    onError: (err) => setSaveError(errorText(err)),
  });
  const update = trpc.roles.update.useMutation({
    onSuccess: () => done("تم حفظ الدور"),
    onError: (err) => setSaveError(errorText(err)),
  });
  const remove = trpc.roles.delete.useMutation({
    onSuccess: () => {
      toast.success("تم حذف الدور");
      void utils.roles.list.invalidate();
    },
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (error) return <ErrorState title="تعذر تحميل الأدوار" onRetry={() => void refetch()} />;
  const roles = data?.data ?? [];

  const open = (next: Editing) => { setSaveError(null); setEditing(next); };
  const save = (draft: RoleDraft) => {
    if (!editing) return;
    if (editing.mode === "edit") update.mutate({ id: editing.id, ...draft });
    else if (editing.mode === "create") create.mutate(draft);
  };

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex flex-wrap gap-2">
        <Button onClick={() => open({ mode: "create", initial: EMPTY })}>
          <Plus aria-hidden="true" /> دور جديد
        </Button>
        <Button variant="outline" onClick={() => open({ mode: "create", initial: DELIVERY_REP_TEMPLATE })}>
          قالب مندوب توصيل
        </Button>
        <Button variant="outline" onClick={() => open({ mode: "create", initial: SALES_REP_TEMPLATE })}>
          قالب مندوب مبيعات
        </Button>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {roles.map((role) => {
          const draft: RoleDraft = {
            name: role.name,
            principalKind: role.principalKind as PrincipalKind,
            permissions: role.permissions,
          };
          return (
            <Card key={role.id} data-testid="role-card">
              <CardContent className="space-y-3 pt-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[var(--t1)]">{role.name}</p>
                    <p className="text-xs text-[var(--t3)]">
                      {PRINCIPAL_KIND_LABELS[role.principalKind as PrincipalKind]}
                      {" · "}
                      {role.memberCount} عضو
                      {" · "}
                      {countPermissions(role.permissions)} صلاحية
                    </p>
                  </div>
                  {role.isSystem && (
                    <Badge variant="outline" className="shrink-0">
                      <ShieldCheck className="me-1 size-3" aria-hidden="true" /> دور نظام
                    </Badge>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {role.isSystem || !canManage ? (
                    <Button size="sm" variant="outline" onClick={() => open({ mode: "view", initial: draft })}>
                      عرض الصلاحيات
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => open({ mode: "edit", id: role.id, initial: draft })}>
                      <Pencil aria-hidden="true" /> تعديل
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => open({ mode: "create", initial: { ...draft, name: `نسخة من ${role.name}`.slice(0, 60) } })}
                    >
                      <Copy aria-hidden="true" /> نسخ
                    </Button>
                  )}
                  {canManage && !role.isSystem && (
                    <ConfirmDialog
                      title={`حذف الدور «${role.name}»؟`}
                      description={role.memberCount > 0
                        ? "الدور مُسند لأعضاء. انقلهم لدور تاني الأول."
                        : "الحذف نهائي، والعملية بتتسجل في سجل الرقابة."}
                      confirmLabel="حذف"
                      pending={remove.isPending}
                      onConfirm={() => remove.mutateAsync({ id: role.id }).then(() => undefined)}
                    >
                      <Button size="sm" variant="destructive" disabled={role.memberCount > 0}>
                        <Trash2 aria-hidden="true" /> حذف
                      </Button>
                    </ConfirmDialog>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {editing && (
        <RoleEditor
          key={editing.mode === "edit" ? editing.id : editing.initial.name}
          open
          title={editing.mode === "create" ? "دور جديد" : editing.mode === "edit" ? "تعديل الدور" : editing.initial.name}
          initial={editing.initial}
          readOnly={editing.mode === "view"}
          pending={create.isPending || update.isPending}
          error={saveError}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}
