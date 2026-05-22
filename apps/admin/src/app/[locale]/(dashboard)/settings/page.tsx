import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { SettingsForm } from "./SettingsForm";
// No explicit React import!

export default async function SettingsPage() {
  const t = await getTranslations("settings");
  
  const caller = await serverCaller();
  const settingsRes = await caller.settings.getAll();

  const initialSettings = settingsRes.data || {};

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
      <SettingsForm initialSettings={initialSettings} />
    </div>
  );
}
