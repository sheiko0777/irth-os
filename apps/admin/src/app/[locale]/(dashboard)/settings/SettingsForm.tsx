"use client";

import { useState, useTransition } from "react";
import { saveSettingsAction } from "./actions";
import { SETTING_KEYS } from "../../../../lib/settings";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";

interface SettingsFormProps {
  initialSettings: Record<string, string>;
}

export function SettingsForm({ initialSettings }: SettingsFormProps) {
  const t = useTranslations("settings");
  const [settings, setSettings] = useState<Record<string, string>>(initialSettings);
  const [isPending, startTransition] = useTransition();
  const [messages, setMessages] = useState<Record<string, { type: 'success' | 'error', text: string }>>({});

  const handleInputChange = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = (section: string, keys: string[]) => {
    startTransition(async () => {
      const payload = keys.map((key) => ({ key, value: settings[key] || "" }));
      const result = await saveSettingsAction(payload);

      if (result.success) {
        setMessages((prev) => ({ ...prev, [section]: { type: 'success', text: t("actions.saveSuccess") } }));
      } else {
        setMessages((prev) => ({ ...prev, [section]: { type: 'error', text: result.error || t("actions.saveError") } }));
      }

      setTimeout(() => {
        setMessages((prev) => {
          const newMessages = { ...prev };
          delete newMessages[section];
          return newMessages;
        });
      }, 3000);
    });
  };

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
    <div className="space-y-6" dir="rtl">

      {/* Section 1: General */}
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
            <span className={`text-sm ${messages['general'].type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
              {messages['general'].text}
            </span>
          )}
        </CardFooter>
      </Card>

      {/* Section 2: Product Numbering */}
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

      {/* Section 3: Pricing+Tax */}
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
            <span className={`text-sm ${messages['pricing'].type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
              {messages['pricing'].text}
            </span>
          )}
        </CardFooter>
      </Card>

      {/* Section 4: Shipping */}
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

      {/* Section 5: Integrations */}
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
            <span className={`text-sm ${messages['integrations'].type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
              {messages['integrations'].text}
            </span>
          )}
        </CardFooter>
      </Card>

    </div>
  );
}
