"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Two-factor account settings. Talks to the Better Auth plugin endpoints
 * directly via the auth client — NOT to org settings. 2FA belongs to the
 * identity, not the tenant, so none of this touches SETTING_KEYS.
 *
 * TOTP (authenticator app) + backup codes only — see auth-server.ts for why
 * there is no email-OTP fallback here.
 *
 * Flow (Better Auth twoFactor plugin):
 *   enable  → requires the account password (plugin enforces it for
 *             credential users). Returns totpURI (paste into Google
 *             Authenticator etc.) + backup codes (shown ONCE). The account
 *             stays twoFactorEnabled=false until verifyTotp succeeds with a
 *             code from the app.
 *   disable → requires the account password; deletes the twoFactor row.
 */
export function TwoFactorSection() {
  const t = useTranslations("auth.twoFactor");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // enable flow state
  const [password, setPassword] = useState("");
  const [totpURI, setTotpURI] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [verifyCode, setVerifyCode] = useState("");

  // one-time status check on mount
  if (enabled === null) {
    void authClient
      .getSession()
      .then(({ data }) => {
        setEnabled(Boolean((data?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled));
      })
      .catch(() => setEnabled(false));
  }

  async function onEnable() {
    setBusy(true); setError(null);
    try {
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error) throw new Error(error.message || t("enableError"));
      setTotpURI(data?.totpURI ?? null);
      setBackupCodes(data?.backupCodes ?? null);
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  async function onVerify() {
    setBusy(true); setError(null);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({ code: verifyCode });
      if (error) throw new Error(t("invalidCode"));
      setEnabled(true);
      setTotpURI(null);
      setBackupCodes(null);
      setVerifyCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  async function onDisable() {
    setBusy(true); setError(null);
    try {
      const { error } = await authClient.twoFactor.disable({ password });
      if (error) throw new Error(error.message || t("disableError"));
      setEnabled(false);
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <p className="text-sm text-[var(--t2)] mt-1">{t("description")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md" role="alert">{error}</div>
        )}

        {enabled === false && !totpURI && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("passwordToEnable")}</Label>
              <Input
                type="password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button onClick={onEnable} disabled={busy || !password}>
              {busy ? t("busy") : t("enable")}
            </Button>
          </div>
        )}

        {/* Step: paste the secret into the authenticator app, then confirm with a code */}
        {totpURI && (
          <div className="space-y-4">
            <div className="p-3 text-sm bg-blue-50 text-blue-700 rounded-md">
              {t("setupInstructions")}
            </div>
            <div className="space-y-2">
              <Label>{t("totpUriLabel")}</Label>
              <Input dir="ltr" readOnly value={totpURI} className="font-mono text-xs" />
            </div>
            {backupCodes && (
              <div className="space-y-2">
                <Label>{t("backupCodesLabel")}</Label>
                <div dir="ltr" className="p-3 bg-[var(--paper)] border border-[var(--rim1)] rounded-md font-mono text-xs grid grid-cols-2 gap-1">
                  {backupCodes.map((code) => <span key={code}>{code}</span>)}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>{t("verifyCodeLabel")}</Label>
              <Input
                dir="ltr"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
              />
            </div>
            <Button onClick={onVerify} disabled={busy || verifyCode.length !== 6}>
              {busy ? t("busy") : t("confirmAndEnable")}
            </Button>
          </div>
        )}

        {enabled === true && (
          <div className="space-y-4">
            <div className="p-3 text-sm text-green-700 bg-green-50 rounded-md">
              {t("enabledNotice")}
            </div>
            <div className="space-y-2">
              <Label>{t("passwordToDisable")}</Label>
              <Input
                type="password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button variant="destructive" onClick={onDisable} disabled={busy || !password}>
              {busy ? t("busy") : t("disable")}
            </Button>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <p className="text-xs text-[var(--t2)]">{t("footer")}</p>
      </CardFooter>
    </Card>
  );
}
