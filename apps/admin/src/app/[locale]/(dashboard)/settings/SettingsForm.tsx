"use client";

import { useTranslations } from "next-intl";
import { useSettingsSection } from "./useSettingsSection";
import { GeneralSection } from "./sections/GeneralSection";
import { SKUNumberingSection } from "./sections/SKUNumberingSection";
import { PricingTaxSection } from "./sections/PricingTaxSection";
import { ShippingSection } from "./sections/ShippingSection";
import { EnvVarsSection } from "./sections/EnvVarsSection";
import { IntegrationsSection } from "./sections/IntegrationsSection";
import { TwoFactorSection } from "./sections/TwoFactorSection";

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
    <div className="space-y-6">
      <GeneralSection {...sharedProps} />
      <SKUNumberingSection {...sharedProps} />
      <PricingTaxSection {...sharedProps} />
      <ShippingSection {...sharedProps} />
      <EnvVarsSection {...sharedProps} />
      <IntegrationsSection {...sharedProps} />
      {/* Account-level, not org-level — takes no settings props, manages its
          own state via the auth client directly (see the component). */}
      <TwoFactorSection />
    </div>
  );
}
