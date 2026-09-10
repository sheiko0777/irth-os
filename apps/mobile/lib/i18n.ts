import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { OrderStatus } from '@irth/types';
import ar from '../locales/ar.json';

const resources = {
  ar: ar,
};

// Compile-time guard: locales/ar.json's `status` block must carry a label for
// every OrderStatus. Without this, a status added to the enum (or dropped from
// the json) silently falls back to the raw enum string for Arabic users — see
// the `t(`status.${...}`, fallback)` call sites in app/(tabs)/orders/*.
// Mirrors components/ui/Badge.tsx's statusColors map.
export const arStatusLabels: Record<OrderStatus, string> = ar.translation.status;

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'ar',
    fallbackLng: 'ar',
    interpolation: {
      escapeValue: false, // react already safes from xss
    },
  });

export default i18n;
