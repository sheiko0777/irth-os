import { useTranslations } from "next-intl";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SETTING_KEYS } from "@/lib/settings";

interface PricingTaxSectionProps {
  settings: Record<string, string>;
  isPending: boolean;
  messages: Record<string, { type: 'success' | 'error', text: string }>;
  handleInputChange: (key: string, value: string) => void;
  handleSave: (section: string, keys: string[]) => void;
}

export function PricingTaxSection({ settings, isPending, messages, handleInputChange, handleSave }: PricingTaxSectionProps) {
  const t = useTranslations("settings");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("sections.pricing")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>{t("fields.vat_rate")}</Label>
          <Input
            type="number"
            min="0" max="30" step="0.5"
            dir="ltr"
            value={settings[SETTING_KEYS.pricing.vat_rate] || ""}
            onChange={(e) => handleInputChange(SETTING_KEYS.pricing.vat_rate, e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("fields.global_pct")}</Label>
          <Input
            type="number"
            min="0" max="100"
            dir="ltr"
            value={settings[SETTING_KEYS.discount.global_pct] || ""}
            onChange={(e) => handleInputChange(SETTING_KEYS.discount.global_pct, e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("fields.max_pct")}</Label>
          <Input
            type="number"
            min="0" max="100"
            dir="ltr"
            value={settings[SETTING_KEYS.discount.max_pct] || ""}
            onChange={(e) => handleInputChange(SETTING_KEYS.discount.max_pct, e.target.value)}
          />
        </div>
      </CardContent>
      <CardFooter className="flex justify-between items-center">
        <Button
          disabled={isPending}
          onClick={() => handleSave('pricing', [
            SETTING_KEYS.pricing.vat_rate,
            SETTING_KEYS.discount.global_pct,
            SETTING_KEYS.discount.max_pct
          ])}
        >
          {t("actions.save")}
        </Button>
        {messages['pricing'] && (
          <span className={`text-sm ${messages['pricing'].type === 'success' ? 'text-emerald' : 'text-crimson'}`}>
            {messages['pricing'].text}
          </span>
        )}
      </CardFooter>
    </Card>
  );
}
