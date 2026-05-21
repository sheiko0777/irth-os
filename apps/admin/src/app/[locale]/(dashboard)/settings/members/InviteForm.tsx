import type React from "react";
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";

export function InviteForm({ orgId }: { orgId: string }) {
  const t = useTranslations("settings");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus("loading");

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      const res = await fetch(`${apiUrl}/api/orgs/${orgId}/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "org_id": orgId,
        },
        body: JSON.stringify({ email, role }),
      });

      if (!res.ok) throw new Error("Failed to invite");
      
      setStatus("success");
      setEmail("");
    } catch (error) {
      setStatus("error");
    }
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
          onChange={(e) => setRole(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="admin">مدير</option>
          <option value="member">عضو</option>
        </select>
      </div>
      <Button type="submit" disabled={status === "loading"}>
        {status === "loading" ? "جاري الإرسال..." : t("invite")}
      </Button>
      {status === "success" && (
        <p className="text-sm text-green-600">{t("inviteSuccess")}</p>
      )}
      {status === "error" && (
        <p className="text-sm text-red-600">حدث خطأ</p>
      )}
    </form>
  );
}
