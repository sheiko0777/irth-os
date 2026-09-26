"use client";

import { useState, type FormEvent } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * First sign-in on an account the owner created (PR-1d), or after a password
 * reset: the temporary password must be replaced before anything else works.
 * The server refuses every other procedure until me.changePassword succeeds;
 * the dashboard layout sends the member here.
 */
export default function ChangePasswordPage() {
  const locale = useLocale();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const change = trpc.me.changePassword.useMutation({
    onSuccess: async () => {
      await utils.me.get.invalidate();
      router.push(`/${locale}`);
      router.refresh();
    },
    onError: (err) => setError(err.message || "تعذر تغيير كلمة السر"),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 8) return setError("كلمة السر الجديدة 8 حروف على الأقل.");
    if (next !== confirm) return setError("كلمتا السر الجديدتان غير متطابقتين.");
    change.mutate({ currentPassword: current, newPassword: next });
  };

  return (
    <div className="w-full max-w-md" dir={locale === "ar" ? "rtl" : "ltr"}>
      <Card>
        <CardHeader>
          <CardTitle>غيّر كلمة السر</CardTitle>
          <CardDescription>
            حسابك معمول بكلمة سر مؤقتة. اختار كلمة سر خاصة بيك قبل ما تكمل.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4" aria-busy={change.isPending}>
            {error && (
              <div role="alert" className="rounded-md bg-crimson/10 p-3 text-sm text-crimson">{error}</div>
            )}
            <div className="space-y-2">
              <label htmlFor="current-password" className="text-sm font-medium">كلمة السر المؤقتة</label>
              <Input id="current-password" type="password" autoComplete="current-password" required
                value={current} onChange={(e) => setCurrent(e.target.value)} disabled={change.isPending} />
            </div>
            <div className="space-y-2">
              <label htmlFor="new-password" className="text-sm font-medium">كلمة السر الجديدة</label>
              <Input id="new-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128}
                value={next} onChange={(e) => setNext(e.target.value)} disabled={change.isPending} />
            </div>
            <div className="space-y-2">
              <label htmlFor="confirm-password" className="text-sm font-medium">أكّد كلمة السر الجديدة</label>
              <Input id="confirm-password" type="password" autoComplete="new-password" required
                value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={change.isPending} />
            </div>
            <Button type="submit" className="w-full" disabled={change.isPending}>
              {change.isPending ? "جارٍ الحفظ…" : "احفظ كلمة السر"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
