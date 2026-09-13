"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * The 2FA challenge page. twoFactorClient({ twoFactorPage }) sends the user
 * here when signIn.email returns a two-factor redirect instead of a session.
 *
 * TOTP only — the user types the 6-digit code from their authenticator app.
 * No email-OTP fallback (see auth-server.ts for why); a lost-device recovery
 * path is the backup codes issued at enable time, entered as the account's
 * password would be, not through this page.
 */
export default function TwoFactorPage() {
  const t = useTranslations("auth.twoFactor");
  const locale = useLocale();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setBusy(true); setError(null);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({ code, trustDevice: true });
      if (error) {
        setError(t("invalidCode"));
        return;
      }
      router.push(`/${locale}`);
      router.refresh();
    } catch {
      setError(t("unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-md" dir={locale === "ar" ? "rtl" : "ltr"}>
      <Card>
        <CardHeader>
          <CardTitle>{t("challengeTitle")}</CardTitle>
          <CardDescription>{t("challengeDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-crimson bg-crimson/10 rounded-md" role="alert">{error}</div>
            )}

            <div className="space-y-2">
              <Label htmlFor="tf-code">{t("codeLabel")}</Label>
              <Input
                id="tf-code"
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="text-center text-2xl tracking-[0.5em] font-mono"
                disabled={busy}
                autoFocus
              />
            </div>

            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
              {busy ? t("busy") : t("verify")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
