"use client";

import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";

export function InviteForm() {
  const t = useTranslations("settings");
  const [bulk, setBulk] = useState(false);
  const [email, setEmail] = useState("");
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");

  const utils = trpc.useUtils();
  const inviteMutation = trpc.members.invite.useMutation({
    onSuccess: () => {
      setEmail("");
      utils.members.list.invalidate();
      utils.members.listInvites.invalidate();
    },
  });
  const bulkInviteMutation = trpc.members.bulkInvite.useMutation({
    onSuccess: () => {
      setEmails("");
      utils.members.list.invalidate();
      utils.members.listInvites.invalidate();
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (bulk) {
      const list = emails.split("\n").map((s) => s.trim()).filter(Boolean);
      if (list.length === 0) return;
      bulkInviteMutation.mutate({ emails: list, role });
    } else {
      inviteMutation.mutate({ email, role });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setBulk(false)}
          className="text-xs underline"
          style={{ color: bulk ? 'var(--t3)' : 'var(--gold)' }}
        >
          دعوة واحدة
        </button>
        <span className="text-xs" style={{ color: 'var(--t3)' }}>·</span>
        <button
          type="button"
          onClick={() => setBulk(true)}
          className="text-xs underline"
          style={{ color: bulk ? 'var(--gold)' : 'var(--t3)' }}
        >
          دعوات متعددة
        </button>
      </div>

      {bulk ? (
        <div className="space-y-2">
          <label htmlFor="emails" className="text-sm font-medium leading-none">بريد إلكتروني في كل سطر (حتى ٥٠)</label>
          <textarea
            id="emails"
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            required
            rows={5}
            dir="ltr"
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            placeholder={"a@example.com\nb@example.com"}
          />
        </div>
      ) : (
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
      )}

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

      <Button type="submit" disabled={inviteMutation.isPending || bulkInviteMutation.isPending}>
        {inviteMutation.isPending || bulkInviteMutation.isPending ? "جاري الإرسال..." : t("invite")}
      </Button>

      {inviteMutation.isSuccess && (
        <p className="text-sm text-emerald">{t("inviteSuccess")}</p>
      )}
      {inviteMutation.isError && (
        <p className="text-sm text-crimson">{inviteMutation.error.message || "حدث خطأ"}</p>
      )}
      {bulkInviteMutation.isSuccess && bulkInviteMutation.data && (
        <p className="text-sm text-emerald">
          تم إرسال {bulkInviteMutation.data.data.invited} من {bulkInviteMutation.data.data.results.length} دعوة
          {bulkInviteMutation.data.data.results.some((r) => !r.ok) && (
            <span className="block text-crimson">
              فشل: {bulkInviteMutation.data.data.results.filter((r) => !r.ok).map((r) => r.email).join('، ')}
            </span>
          )}
        </p>
      )}
      {bulkInviteMutation.isError && (
        <p className="text-sm text-crimson">{bulkInviteMutation.error.message || "حدث خطأ"}</p>
      )}
    </form>
  );
}
