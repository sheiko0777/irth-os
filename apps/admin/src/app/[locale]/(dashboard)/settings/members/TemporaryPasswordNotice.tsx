'use client';

import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Shown once: the server never stores or returns this password again. */
export function TemporaryPasswordNotice({
  username,
  temporaryPassword,
  onDismiss,
}: {
  username?: string;
  temporaryPassword: string;
  onDismiss: () => void;
}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(username ? `${username}\n${temporaryPassword}` : temporaryPassword);
      toast.success("تم النسخ");
    } catch {
      toast.error("تعذر النسخ، انسخها يدويًا");
    }
  };

  return (
    <div role="status" className="space-y-2 rounded-md border border-[var(--gold-br)] bg-[var(--gold-bg)] p-3 text-sm">
      <p className="font-semibold">سلّم البيانات دي للشخص. كلمة السر مش هتظهر تاني.</p>
      {username && (
        <p>اسم المستخدم: <code dir="ltr" data-testid="temp-username">{username}</code></p>
      )}
      <p>كلمة السر المؤقتة: <code dir="ltr" data-testid="temp-password">{temporaryPassword}</code></p>
      <p className="text-xs text-[var(--t3)]">أول ما يدخل هيُطلب منه يغيّرها.</p>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>نسخ</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>تم</Button>
      </div>
    </div>
  );
}
