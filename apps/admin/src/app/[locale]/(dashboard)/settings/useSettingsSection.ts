import { useState, useTransition } from "react";
import { saveSettingsAction } from "./actions";

export function useSettingsSection(initialSettings: Record<string, string>, t: (key: string) => string) {
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

  return {
    settings,
    isPending,
    messages,
    handleInputChange,
    handleSave,
  };
}
