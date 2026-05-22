export const SETTING_KEYS = {
  org: {
    name: 'org.name',
    currency: 'org.currency',
    phone: 'org.phone',
    email: 'org.email',
  },
  product: {
    sku_prefix: 'product.sku_prefix',
    sku_next_number: 'product.sku_next_number',
    sku_pad_length: 'product.sku_pad_length',
  },
  pricing: {
    vat_rate: 'pricing.vat_rate',
    currency: 'pricing.currency',
  },
  shipping: {
    flat_rate: 'shipping.flat_rate',
    free_threshold: 'shipping.free_threshold',
    provider: 'shipping.provider',
  },
  discount: {
    global_pct: 'discount.global_pct',
    max_pct: 'discount.max_pct',
  },
  integration: {
    fawry_merchant_code: 'integration.fawry_merchant_code',
    fawry_base_url: 'integration.fawry_base_url',
    whatsapp_api_key: 'integration.whatsapp_api_key',
    resend_api_key: 'integration.resend_api_key',
    resend_from: 'integration.resend_from',
    cf_account_id: 'integration.cf_account_id',
    cf_r2_bucket: 'integration.cf_r2_bucket',
    cf_r2_public_url: 'integration.cf_r2_public_url',
  },
} as const;

export type SettingKey = typeof SETTING_KEYS[keyof typeof SETTING_KEYS][keyof typeof SETTING_KEYS[keyof typeof SETTING_KEYS]];

export const SENSITIVE_KEYS = [
  SETTING_KEYS.integration.whatsapp_api_key,
  SETTING_KEYS.integration.resend_api_key,
];

export const DEFAULT_SETTINGS: Record<string, string> = {
  [SETTING_KEYS.pricing.vat_rate]: '14',
  [SETTING_KEYS.pricing.currency]: 'EGP',
  [SETTING_KEYS.org.currency]: 'EGP',
  [SETTING_KEYS.product.sku_prefix]: 'PRD',
  [SETTING_KEYS.product.sku_pad_length]: '4',
  [SETTING_KEYS.product.sku_next_number]: '1',
  [SETTING_KEYS.shipping.flat_rate]: '50',
  [SETTING_KEYS.shipping.free_threshold]: '500',
  [SETTING_KEYS.discount.global_pct]: '0',
  [SETTING_KEYS.discount.max_pct]: '100',
};
