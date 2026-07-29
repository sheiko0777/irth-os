import { useTranslations } from "next-intl";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { SETTING_KEYS } from "@/lib/settings";

interface GeneralSectionProps {
  settings: Record<string, string>;
  isPending: boolean;
  messages: Record<string, { type: 'success' | 'error', text: string }>;
  handleInputChange: (key: string, value: string) => void;
  handleSave: (section: string, keys: string[]) => void;
}

export function GeneralSection({ settings, isPending, messages, handleInputChange, handleSave }: GeneralSectionProps) {
  const t = useTranslations("settings");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("sections.general")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>{t("fields.org_name")}</Label>
          <Input
            value={settings[SETTING_KEYS.org.name] || ""}
            onChange={(e) => handleInputChange(SETTING_KEYS.org.name, e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("fields.org_currency")}</Label>
          <Select
            value={settings[SETTING_KEYS.org.currency] || "EGP"}
            onValueChange={(val) => handleInputChange(SETTING_KEYS.org.currency, val)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EGP">EGP</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="SAR">SAR</SelectItem>
              <SelectItem value="AED">AED</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{t("fields.org_phone")}</Label>
          <Input
            dir="ltr"
            value={settings[SETTING_KEYS.org.phone] || ""}
            onChange={(e) => handleInputChange(SETTING_KEYS.org.phone, e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("fields.org_email")}</Label>
          <Input
            type="email"
            dir="ltr"
            value={settings[SETTING_KEYS.org.email] || ""}
            onChange={(e) => handleInputChange(SETTING_KEYS.org.email, e.target.value)}
          />
        </div>
      </CardContent>
      <CardFooter className="flex justify-between items-center">
        <Button
          disabled={isPending}
          onClick={() => handleSave('general', [
            SETTING_KEYS.org.name,
            SETTING_KEYS.org.currency,
            SETTING_KEYS.org.phone,
            SETTING_KEYS.org.email
          ])}
        >
          {t("actions.save")}
        </Button>
        {messages['general'] && (
          <span className={`text-sm ${messages['general'].type === 'success' ? 'text-emerald' : 'text-crimson'}`}>
            {messages['general'].text}
          </span>
        )}
      </CardFooter>
    </Card>
  );
}
