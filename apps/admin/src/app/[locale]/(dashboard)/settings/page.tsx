import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { SettingsForm } from "./SettingsForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { Settings } from "lucide-react";
// No explicit React import!

export default async function SettingsPage() {
  const t = await getTranslations("settings");
  
  const caller = await serverCaller();
  const settingsRes = await caller.settings.getAll();

  const initialSettings = settingsRes.data || {};

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="الإعدادات والرقابة"
        title={t("title")}
        icon={<Settings />}
      />
      <SettingsForm initialSettings={initialSettings} />
    </div>
  );
}
