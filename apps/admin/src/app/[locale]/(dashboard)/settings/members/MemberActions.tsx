'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useCan } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MemberAccessDialog } from "./MemberAccessDialog";
import { TemporaryPasswordNotice } from "./TemporaryPasswordNotice";

export interface MemberRow {
  id: string;
  name: string;
  accessRoleId: string | null;
  roleName: string | null;
  systemKey: string | null;
  status: string;
  mustChangePassword: boolean;
}

/**
 * Per-member controls (PR-1d): role, personal exceptions, suspend/reactivate,
 * password reset. Each shows only if the viewer holds the permission; the
 * server re-checks all of it, plus delegation — you cannot hand out more than
 * you hold, or touch someone who holds more than you.
 */
export function MemberActions({ member, isSelf }: { member: MemberRow; isSelf: boolean }) {
  const can = useCan();
  const router = useRouter();
  const [accessOpen, setAccessOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState<string | null>(null);
  const canChange = can("members", "changeRole") && !isSelf;
  const roles = trpc.roles.list.useQuery(undefined, { enabled: canChange });

  const onError = (err: { message: string }) => toast.error(err.message || "تعذر تنفيذ العملية");
  const assign = trpc.accounts.assignRole.useMutation({
    onSuccess: () => { toast.success("تم تغيير الدور"); router.refresh(); },
    onError,
  });
  const setStatus = trpc.accounts.setStatus.useMutation({
    onSuccess: () => { toast.success("تم تحديث حالة الحساب"); router.refresh(); },
    onError,
  });
  const reset = trpc.accounts.resetPassword.useMutation({
    onSuccess: (res) => { setResetPassword(res.data.temporaryPassword); router.refresh(); },
    onError,
  });

  const suspended = member.status === "suspended";

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {suspended && <Badge variant="outline" className="text-[var(--critical)]">موقوف</Badge>}
      {member.mustChangePassword && <Badge variant="outline">بانتظار تغيير كلمة السر</Badge>}

      {canChange && roles.data ? (
        <select
          aria-label={`دور ${member.name}`}
          className="h-9 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2 text-sm"
          value={member.accessRoleId ?? ""}
          disabled={assign.isPending}
          onChange={(e) => assign.mutate({ memberId: member.id, accessRoleId: e.target.value })}
        >
          {roles.data.data.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      ) : (
        <Badge variant="outline">{member.roleName ?? "—"}</Badge>
      )}

      {can("members", "view") && (
        <Button size="sm" variant="outline" onClick={() => setAccessOpen(true)}>الصلاحيات</Button>
      )}

      {can("members", "suspend") && !isSelf && (
        <ConfirmDialog
          title={suspended ? `تفعيل حساب ${member.name}؟` : `إيقاف حساب ${member.name}؟`}
          description={suspended ? "هيقدر يدخل ويشتغل تاني بنفس صلاحياته." : "مش هيقدر يعمل أي حاجة في المؤسسة لحد ما يتفعّل تاني."}
          confirmLabel={suspended ? "تفعيل" : "إيقاف"}
          destructive={!suspended}
          pending={setStatus.isPending}
          onConfirm={() => setStatus.mutateAsync({ memberId: member.id, status: suspended ? "active" : "suspended" }).then(() => undefined)}
        >
          <Button size="sm" variant={suspended ? "outline" : "destructive"}>{suspended ? "تفعيل" : "إيقاف"}</Button>
        </ConfirmDialog>
      )}

      {can("members", "resetPassword") && !isSelf && (
        <ConfirmDialog
          title={`كلمة سر جديدة لـ ${member.name}؟`}
          description="هيخرج من كل الأجهزة، وهيدخل بكلمة سر مؤقتة لازم يغيّرها."
          confirmLabel="إعادة التعيين"
          pending={reset.isPending}
          onConfirm={() => reset.mutateAsync({ memberId: member.id }).then(() => undefined)}
        >
          <Button size="sm" variant="ghost">كلمة سر جديدة</Button>
        </ConfirmDialog>
      )}

      {resetPassword && (
        <div className="basis-full">
          <TemporaryPasswordNotice temporaryPassword={resetPassword} onDismiss={() => setResetPassword(null)} />
        </div>
      )}
      {accessOpen && (
        <MemberAccessDialog memberId={member.id} name={member.name} canEdit={canChange} onClose={() => setAccessOpen(false)} />
      )}
    </div>
  );
}
