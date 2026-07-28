import { useTranslations } from "next-intl";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { SETTING_KEYS } from "@/lib/settings";

interface ShippingSectionProps {
  settings: Record<string, string>;
  isPending: boolean;
  messages: Record<string, { type: 'success' | 'error', text: string }>;
  handleInputChange: (key: string, value: string) => void;
  handleSave: (section: string, keys: string[]) => void;
}

export function ShippingSection({ settings, isPending, messages, handleInputChange, handleSave }: ShippingSectionProps) {
  const t = useTranslations("settings");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("sections.shipping")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>{t("fields.shipping_provider")}</Label>
          <Select
            value={settings[SETTING_KEYS.shipping.provider] || "bosta"}
            onValueChange={(val) => handleInputChange(SETTING_KEYS.shipping.provider, val)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bosta">Bosta</SelectItem>
              <SelectItem value="aramex">Aramex</SelectItem>
              <SelectItem value="other">أخرى</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{t("fields.shipping_flat_rate")}</Label>
          <Input
            type="number"
            dir="ltr"
            value={settings[SETTING_KEYS.shipping.flat_rate] || ""}
            onChange={(e) => handleInputChange(SETTING_KEYS.shipping.flat_rate, e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("fields.shipping_free_threshold")}</Label>
          <Input
            type="number"
            dir="ltr"
            value={settings[SETTING_KEYS.shipping.free_threshold] || ""}
            onChange={(e) => handleInputChange(SETTING_KEYS.shipping.free_threshold, e.target.value)}
          />
        </div>
      </CardContent>
      <CardFooter className="flex justify-between items-center">
        <Button
          disabled={isPending}
          onClick={() => handleSave('shipping', [
            SETTING_KEYS.shipping.provider,
            SETTING_KEYS.shipping.flat_rate,
            SETTING_KEYS.shipping.free_threshold
          ])}
        >
          {t("actions.save")}
        </Button>
        {messages['shipping'] && (
          <span className={`text-sm ${messages['shipping'].type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
            {messages['shipping'].text}
          </span>
        )}
      </CardFooter>
    </Card>
  );
}
