"use client";

import { useTranslations } from "next-intl";
import { useSettingsSection } from "./useSettingsSection";
import { GeneralSection } from "./sections/GeneralSection";
import { SKUNumberingSection } from "./sections/SKUNumberingSection";
import { PricingTaxSection } from "./sections/PricingTaxSection";
import { ShippingSection } from "./sections/ShippingSection";
import { EnvVarsSection } from "./sections/EnvVarsSection";
import { IntegrationsSection } from "./sections/IntegrationsSection";

interface SettingsFormProps {
  initialSettings: Record<string, string>;
}

export function SettingsForm({ initialSettings }: SettingsFormProps) {
  const t = useTranslations("settings");
  const {
    settings,
    isPending,
    messages,
    handleInputChange,
    handleSave,
  } = useSettingsSection(initialSettings, t);

  const sharedProps = {
    settings,
    isPending,
    messages,
    handleInputChange,
    handleSave,
  };

  return (
    <div className="space-y-6" dir="rtl">
      <GeneralSection {...sharedProps} />
      <SKUNumberingSection {...sharedProps} />
      <PricingTaxSection {...sharedProps} />
      <ShippingSection {...sharedProps} />
      <EnvVarsSection {...sharedProps} />
      <IntegrationsSection {...sharedProps} />
    </div>
  );
}
