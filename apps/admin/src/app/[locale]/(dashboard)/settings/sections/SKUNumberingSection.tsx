import { useTranslations } from "next-intl";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { SETTING_KEYS } from "@/lib/settings";

interface SKUNumberingSectionProps {
  settings: Record<string, string>;
  isPending: boolean;
  messages: Record<string, { type: 'success' | 'error', text: string }>;
  handleInputChange: (key: string, value: string) => void;
  handleSave: (section: string, keys: string[]) => void;
}

export function SKUNumberingSection({ settings, isPending, messages, handleInputChange, handleSave }: SKUNumberingSectionProps) {
  const t = useTranslations("settings");

  const padSKU = (num: string, pad: string) => {
    const padLength = parseInt(pad) || 4;
    return num.padStart(padLength, '0');
  };

  const getSKUPreview = () => {
    const prefix = settings[SETTING_KEYS.product.sku_prefix] || '';
    const num = settings[SETTING_KEYS.product.sku_next_number] || '1';
    const pad = settings[SETTING_KEYS.product.sku_pad_length] || '4';
    return `${prefix}-${padSKU(num, pad)}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("sections.product")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>{t("fields.sku_prefix")}</Label>
          <Input
            maxLength={10}
            dir="ltr"
            value={settings[SETTING_KEYS.product.sku_prefix] || ""}
            onChange={(e) => handleInputChange(SETTING_KEYS.product.sku_prefix, e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("fields.sku_next_number")}</Label>
          <Input
            type="number"
            dir="ltr"
            value={settings[SETTING_KEYS.product.sku_next_number] || ""}
            onChange={(e) => handleInputChange(SETTING_KEYS.product.sku_next_number, e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("fields.sku_pad_length")}</Label>
          <Select
            value={settings[SETTING_KEYS.product.sku_pad_length] || "4"}
            onValueChange={(val) => handleInputChange(SETTING_KEYS.product.sku_pad_length, val)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="4">4</SelectItem>
              <SelectItem value="5">5</SelectItem>
              <SelectItem value="6">6</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="pt-2">
          <Label className="text-muted-foreground">{t("fields.sku_preview")}</Label>
          <p className="text-lg font-mono mt-1" dir="ltr">{getSKUPreview()}</p>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between items-center">
        <Button
          disabled={isPending}
          onClick={() => handleSave('product', [
            SETTING_KEYS.product.sku_prefix,
            SETTING_KEYS.product.sku_next_number,
            SETTING_KEYS.product.sku_pad_length
          ])}
        >
          {t("actions.save")}
        </Button>
        {messages['product'] && (
          <span className={`text-sm ${messages['product'].type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
            {messages['product'].text}
          </span>
        )}
      </CardFooter>
    </Card>
  );
}
