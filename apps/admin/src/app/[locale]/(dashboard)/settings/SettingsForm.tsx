"use client";

import { useTranslations } from "next-intl";
import { useSettingsSection } from "./useSettingsSection";
import { GeneralSection } from "./sections/GeneralSection";
import { SKUNumberingSection } from "./sections/SKUNumberingSection";
import { PricingTaxSection } from "./sections/PricingTaxSection";
import { ShippingSection } from "./sections/ShippingSection";
import { EnvVarsSection } from "./sections/EnvVarsSection";
import { IntegrationsSection } from "./sections/IntegrationsSection";
import { DeadLettersSection } from "./sections/DeadLettersSection";

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
      {/* TwoFactorSection removed — emergency revert, see auth-server.ts */}
      {/* Ops surface, not an org setting — hides itself for a member (see
          the component). */}
      <DeadLettersSection />
    </div>
  );
}
