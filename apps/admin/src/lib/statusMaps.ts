/**
 * Canonical status → { label, color, bg } maps for every domain.
 * Single source of truth — do not redeclare STATUS_LABELS / STATUS_COLORS
 * in feature components; render via <StatusBadge domain="..." />.
 */

export type StatusStyle = { label: string; color: string; bg: string };
export type StatusMap = Record<string, StatusStyle>;

const tone = {
  amber:   { color: 'var(--amber)',   bg: 'rgba(245,165,0,.10)' },
  azure:   { color: 'var(--azure)',   bg: 'rgba(46,143,255,.10)' },
  crimson: { color: 'var(--crimson)', bg: 'rgba(232,56,56,.10)' },
  gold:    { color: 'var(--gold)',    bg: 'rgba(224,144,0,.10)' },
  emerald: { color: 'var(--emerald)', bg: 'rgba(0,196,120,.10)' },
  muted:   { color: 'var(--t3)',      bg: 'var(--rim1)' },
  neutral: { color: 'var(--t2)',      bg: 'var(--rim1)' },
} as const;

export const orderStatusMap: StatusMap = {
  pending:        { label: 'قيد الانتظار', ...tone.amber },
  confirmed:      { label: 'مؤكد',         ...tone.azure },
  payment_failed: { label: 'فشل الدفع',    ...tone.crimson },
  shipped:        { label: 'تم الشحن',     ...tone.gold },
  delivered:      { label: 'تم التسليم',   ...tone.emerald },
  cancelled:      { label: 'ملغي',         ...tone.muted },
  returned:       { label: 'مرتجع',        ...tone.crimson },
};

export const paymentStatusMap: StatusMap = {
  paid:     { label: 'مدفوع',     ...tone.emerald },
  unpaid:   { label: 'غير مدفوع', ...tone.crimson },
  refunded: { label: 'مسترد',     ...tone.azure },
  partial:  { label: 'جزئي',      ...tone.amber },
};

export const giftCardStatusMap: StatusMap = {
  active:    { label: 'نشطة',    ...tone.emerald },
  redeemed:  { label: 'مستخدمة', ...tone.neutral },
  expired:   { label: 'منتهية',  ...tone.muted },
  cancelled: { label: 'ملغاة',   ...tone.crimson },
};

export const etaStatusMap: StatusMap = {
  pending:   { label: 'معلق',   ...tone.gold },
  submitted: { label: 'مُرسل',  ...tone.emerald },
  valid:     { label: 'مقبول',  ...tone.emerald },
  rejected:  { label: 'مرفوض',  ...tone.crimson },
  cancelled: { label: 'ملغي',   ...tone.muted },
  error:     { label: 'خطأ',    ...tone.crimson },
};

export const courierShipmentStatusMap: StatusMap = {
  created:    { label: 'جديد',        ...tone.neutral },
  picked_up:  { label: 'تم الاستلام', ...tone.gold },
  in_transit: { label: 'قيد الشحن',   ...tone.gold },
  delivered:  { label: 'تم التسليم',  ...tone.emerald },
  returned:   { label: 'مرتجع',       ...tone.crimson },
  failed:     { label: 'فشل',         ...tone.crimson },
};

export const remittanceStatusMap: StatusMap = {
  pending:    { label: 'معلق',   ...tone.gold },
  received:   { label: 'مستلم',  ...tone.gold },
  reconciled: { label: 'مُسوّى', ...tone.emerald },
};

export const campaignStatusMap: StatusMap = {
  draft:     { label: 'مسودة',        ...tone.neutral },
  scheduled: { label: 'مجدول',        ...tone.azure },
  sending:   { label: 'جاري الإرسال', ...tone.gold },
  sent:      { label: 'تم الإرسال',   ...tone.emerald },
  failed:    { label: 'فشل',          ...tone.crimson },
};

export const campaignChannelMap: StatusMap = {
  whatsapp: { label: 'واتساب',       ...tone.emerald },
  sms:      { label: 'رسالة نصية',   ...tone.azure },
  email:    { label: 'بريد إلكتروني', ...tone.gold },
};

export const campaignSegmentMap: StatusMap = {
  all:      { label: 'جميع العملاء',      ...tone.neutral },
  vip:      { label: 'عملاء VIP',         ...tone.gold },
  inactive: { label: 'عملاء غير نشطين',   ...tone.muted },
  new:      { label: 'عملاء جدد',         ...tone.emerald },
  custom:   { label: 'مخصص',              ...tone.azure },
};

export const purchaseOrderStatusMap: StatusMap = {
  draft:     { label: 'مسودة',        ...tone.neutral },
  ordered:   { label: 'مطلوب',        ...tone.gold },
  partial:   { label: 'مستلم جزئياً', ...tone.amber },
  received:  { label: 'مستلم',        ...tone.emerald },
  // muted, not crimson, despite the old inline ternary painting it red.
  // Crimson is reserved for failure states here (returned, payment_failed,
  // rejected, error); cancelling a purchase order is a deliberate act, and
  // orderStatusMap, etaStatusMap and stocktakingStatusMap all render their
  // own `cancelled` muted for exactly that reason.
  cancelled: { label: 'ملغي',         ...tone.muted },
};

export const stocktakingStatusMap: StatusMap = {
  draft:       { label: 'مسودة',  ...tone.neutral },
  in_progress: { label: 'جارٍ',   ...tone.gold },
  completed:   { label: 'مكتمل',  ...tone.emerald },
  cancelled:   { label: 'ملغى',   ...tone.muted },
};

export const rateTypeMap: StatusMap = {
  flat:        { label: 'ثابت',      ...tone.neutral },
  weight_based:{ label: 'حسب الوزن', ...tone.gold },
  price_based: { label: 'حسب السعر', ...tone.emerald },
  free:        { label: 'مجاني',     ...tone.emerald },
};

export const returnStatusMap: StatusMap = {
  requested: { label: 'معلقة',        ...tone.amber },
  approved:  { label: 'موافق',        ...tone.azure },
  rejected:  { label: 'مرفوض',        ...tone.crimson },
  received:  { label: 'مستلم',        ...tone.gold },
  restocked: { label: 'مُعاد تخزين',  ...tone.emerald },
  refunded:  { label: 'مسترد',        ...tone.azure },
  exchanged: { label: 'مستبدل',       ...tone.gold },
};

export const planMap: StatusMap = {
  starter:    { label: 'مبتدئ', ...tone.muted },
  growth:     { label: 'نمو',   ...tone.gold },
  enterprise: { label: 'مؤسسة', ...tone.emerald },
};

export const notificationTypeMap: StatusMap = {
  order_status:    { label: 'تحديث طلب',  ...tone.azure },
  invite_accepted: { label: 'قبول دعوة',  ...tone.emerald },
  member_joined:   { label: 'عضو جديد',   ...tone.gold },
  system:          { label: 'نظام',       ...tone.neutral },
};

export const statusMaps = {
  order: orderStatusMap,
  payment: paymentStatusMap,
  giftCard: giftCardStatusMap,
  eta: etaStatusMap,
  courierShipment: courierShipmentStatusMap,
  remittance: remittanceStatusMap,
  campaign: campaignStatusMap,
  campaignChannel: campaignChannelMap,
  campaignSegment: campaignSegmentMap,
  purchaseOrder: purchaseOrderStatusMap,
  stocktaking: stocktakingStatusMap,
  rateType: rateTypeMap,
  return: returnStatusMap,
  plan: planMap,
  notificationType: notificationTypeMap,
} as const;

export type StatusDomain = keyof typeof statusMaps;

const fallback: StatusStyle = { label: '', ...tone.muted };

/** Style for a status value; label falls back to the raw value. */
export function statusStyle(domain: StatusDomain, status: string): StatusStyle {
  const entry = statusMaps[domain][status];
  return entry ?? { ...fallback, label: status };
}

/** Label only — for plain-text contexts (tables, exports). */
export function statusLabel(domain: StatusDomain, status: string): string {
  return statusStyle(domain, status).label;
}
