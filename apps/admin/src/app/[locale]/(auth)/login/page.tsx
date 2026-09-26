"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { signIn } from "@/lib/auth-client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// One field for both: staff sign in with their email, and accounts the owner
// creates directly (reps, suppliers — PR-1d) with their username, usually a
// mobile number. An "@" decides which.
const loginSchema = z.object({
  identifier: z.string().trim().min(3, "اكتب البريد الإلكتروني أو اسم المستخدم").max(254),
  password: z.string().min(1, "كلمة المرور مطلوبة"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormValues) => {
    setError(null);
    try {
      const res = data.identifier.includes("@")
        ? await signIn.email({ email: data.identifier, password: data.password })
        : await signIn.username({ username: data.identifier, password: data.password });

      if (res.error) {
        setError(t("loginError"));
      } else {
        // `/[locale]` is the dashboard. It used to point at `/[locale]/dashboard`,
        // a stale duplicate that sat outside the (dashboard) group and so
        // rendered with no sidebar and no header.
        router.push(`/${locale}`);
        router.refresh();
      }
    } catch (err) {
      setError(t("loginError"));
    }
  };

  return (
    <div className="w-full max-w-md" dir={locale === "ar" ? "rtl" : "ltr"}>
      <Card>
        <CardHeader>
          <CardTitle>{t("login")}</CardTitle>
          <CardDescription>{t("loginSuccess")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-crimson bg-crimson/10 rounded-md">
                {error}
              </div>
            )}
            
            <div className="space-y-2">
              <label htmlFor="login-identifier" className="text-sm font-medium">{t("identifier")}</label>
              <Input
                id="login-identifier"
                type="text"
                autoComplete="username"
                inputMode="email"
                dir="ltr"
                {...register("identifier")}
                disabled={isSubmitting}
                className={`text-start ${errors.identifier ? "border-crimson focus-visible:ring-crimson" : ""}`}
              />
              {errors.identifier && (
                <p className="text-xs text-crimson">{errors.identifier.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="login-password" className="text-sm font-medium">{t("password")}</label>
              <Input
                id="login-password"
                type="password"
                {...register("password")}
                disabled={isSubmitting}
                className={`text-start ${errors.password ? "border-crimson focus-visible:ring-crimson" : ""}`}
              />
              {errors.password && (
                <p className="text-xs text-crimson">{errors.password.message}</p>
              )}
            </div>
            
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "..." : t("login")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
