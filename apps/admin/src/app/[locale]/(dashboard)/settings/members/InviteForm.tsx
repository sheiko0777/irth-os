"use client";

import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";

export function InviteForm() {
  const t = useTranslations("settings");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");

  const utils = trpc.useUtils();
  const inviteMutation = trpc.members.invite.useMutation({
    onSuccess: () => {
      setEmail("");
      utils.members.list.invalidate();
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    inviteMutation.mutate({ email, role });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">البريد الإلكتروني</label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="role" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">الدور</label>
        <select
          id="role"
          value={role}
          onChange={(e) => setRole(e.target.value as "admin" | "member")}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="admin">مدير</option>
          <option value="member">عضو</option>
        </select>
      </div>
      <Button type="submit" disabled={inviteMutation.isPending}>
        {inviteMutation.isPending ? "جاري الإرسال..." : t("invite")}
      </Button>
      {inviteMutation.isSuccess && (
        <p className="text-sm text-emerald">{t("inviteSuccess")}</p>
      )}
      {inviteMutation.isError && (
        <p className="text-sm text-crimson">{inviteMutation.error.message || "حدث خطأ"}</p>
      )}
    </form>
  );
}
