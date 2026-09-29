'use client';

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PRINCIPAL_KIND_LABELS } from "@/lib/permissionCatalog";
import { TemporaryPasswordNotice } from "./TemporaryPasswordNotice";

/**
 * إنشاء حساب مباشر (PR-1d): for reps and suppliers who have no email, and any
 * staff member the owner would rather set up than invite. The server returns a
 * temporary password once; the person must replace it on first sign-in.
 */
export function CreateAccountForm() {
  const router = useRouter();
  const roles = trpc.roles.list.useQuery();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [accessRoleId, setAccessRoleId] = useState("");
  const [created, setCreated] = useState<{ username: string; temporaryPassword: string } | null>(null);

  const create = trpc.accounts.create.useMutation({
    onSuccess: (res) => {
      setCreated({ username: res.data.username, temporaryPassword: res.data.temporaryPassword });
      setName(""); setUsername(""); setEmail("");
      toast.success("تم إنشاء الحساب");
      router.refresh();
    },
    onError: (err) => toast.error(err.message || "تعذر إنشاء الحساب"),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ name, username, email: email.trim() || undefined, accessRoleId });
  };

  const options = (roles.data?.data ?? []).filter((r) => r.systemKey !== "owner");

  return (
    <div className="space-y-4">
      {created && <TemporaryPasswordNotice {...created} onDismiss={() => setCreated(null)} />}
      <form onSubmit={submit} className="space-y-3" aria-busy={create.isPending}>
        <div className="space-y-1.5">
          <Label htmlFor="account-name">الاسم</Label>
          <Input id="account-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="account-username">اسم المستخدم أو رقم الموبايل</Label>
          <Input id="account-username" required minLength={3} maxLength={30} dir="ltr" inputMode="tel"
            pattern="[A-Za-z0-9_.]+" title="حروف إنجليزية وأرقام و _ و . فقط"
            value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="account-email">البريد الإلكتروني (اختياري)</Label>
          <Input id="account-email" type="email" maxLength={254} dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="account-role">الدور</Label>
          <select
            id="account-role"
            required
            className="h-11 w-full rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-3 text-sm"
            value={accessRoleId}
            onChange={(e) => setAccessRoleId(e.target.value)}
          >
            <option value="" disabled>اختار دور</option>
            {options.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — {PRINCIPAL_KIND_LABELS[r.principalKind as keyof typeof PRINCIPAL_KIND_LABELS]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={create.isPending || !accessRoleId}>
          {create.isPending ? "جارٍ الإنشاء…" : "إنشاء الحساب"}
        </Button>
      </form>
    </div>
  );
}
