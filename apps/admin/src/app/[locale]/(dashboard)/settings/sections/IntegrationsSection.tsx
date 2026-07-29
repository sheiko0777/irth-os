import { useTranslations } from "next-intl";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SETTING_KEYS } from "@/lib/settings";

interface IntegrationsSectionProps {
  settings: Record<string, string>;
  isPending: boolean;
  messages: Record<string, { type: 'success' | 'error', text: string }>;
  handleInputChange: (key: string, value: string) => void;
  handleSave: (section: string, keys: string[]) => void;
}

export function IntegrationsSection({ settings, isPending, messages, handleInputChange, handleSave }: IntegrationsSectionProps) {
  const t = useTranslations("settings");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("sections.integrations")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>{t("fields.fawry_merchant_code")}</Label>
          <Input
            dir="ltr"
            value={settings[SETTING_KEYS.integration.fawry_merchant_code] || ""}
            onChange={(e) => handleInputChange(SETTING_KEYS.integration.fawry_merchant_code, e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("fields.fawry_base_url")}</Label>
          <Input
            dir="ltr"
            value={settings[SETTING_KEYS.integration.fawry_base_url] || ""}
            onChange={(e) => handleInputChange(SETTING_KEYS.integration.fawry_base_url, e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("fields.whatsapp_api_key")}</Label>
          <Input
            type="password"
            dir="ltr"
            value={settings[SETTING_KEYS.integration.whatsapp_api_key] || ""}
            onChange={(e) => handleInputChange(SETTING_KEYS.integration.whatsapp_api_key, e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("fields.resend_api_key")}</Label>
          <Input
            type="password"
            dir="ltr"
            value={settings[SETTING_KEYS.integration.resend_api_key] || ""}
            onChange={(e) => handleInputChange(SETTING_KEYS.integration.resend_api_key, e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("fields.resend_from")}</Label>
          <Input
            type="email"
            dir="ltr"
            value={settings[SETTING_KEYS.integration.resend_from] || ""}
            onChange={(e) => handleInputChange(SETTING_KEYS.integration.resend_from, e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("fields.cf_account_id")}</Label>
          <Input
            dir="ltr"
            value={settings[SETTING_KEYS.integration.cf_account_id] || ""}
            onChange={(e) => handleInputChange(SETTING_KEYS.integration.cf_account_id, e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("fields.cf_r2_bucket")}</Label>
          <Input
            dir="ltr"
            value={settings[SETTING_KEYS.integration.cf_r2_bucket] || ""}
            onChange={(e) => handleInputChange(SETTING_KEYS.integration.cf_r2_bucket, e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("fields.cf_r2_public_url")}</Label>
          <Input
            dir="ltr"
            value={settings[SETTING_KEYS.integration.cf_r2_public_url] || ""}
            onChange={(e) => handleInputChange(SETTING_KEYS.integration.cf_r2_public_url, e.target.value)}
          />
        </div>
      </CardContent>
      <CardFooter className="flex justify-between items-center">
        <Button
          disabled={isPending}
          onClick={() => handleSave('integrations', [
            SETTING_KEYS.integration.fawry_merchant_code,
            SETTING_KEYS.integration.fawry_base_url,
            SETTING_KEYS.integration.whatsapp_api_key,
            SETTING_KEYS.integration.resend_api_key,
            SETTING_KEYS.integration.resend_from,
            SETTING_KEYS.integration.cf_account_id,
            SETTING_KEYS.integration.cf_r2_bucket,
            SETTING_KEYS.integration.cf_r2_public_url
          ])}
        >
          {t("actions.save")}
        </Button>
        {messages['integrations'] && (
          <span className={`text-sm ${messages['integrations'].type === 'success' ? 'text-emerald' : 'text-crimson'}`}>
            {messages['integrations'].text}
          </span>
        )}
      </CardFooter>
    </Card>
  );
}
