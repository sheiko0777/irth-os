import { z } from 'zod';

export const SECTIONS = [
  'identity',
  'items',
  'buyer',
  'addresses',
  'price',
  'currency',
  'payment',
  'fulfillment',
  'returns',
  'context',
  'evidence',
] as const;

export const Section = z.enum(SECTIONS);
export type Section = z.infer<typeof Section>;

export const SectionStatus = z.enum([
  'loaded',
  'not_applicable',
  'not_exposed_by_provider',
  'permission_denied',
  'fetch_failed',
]);
export type SectionStatus = z.infer<typeof SectionStatus>;

const SectionStateSchema = z.object({
  status: SectionStatus,
  detail: z.string().max(1_000).optional(),
  fetchedAt: z.string().optional(),
});

export const SectionsSchema = z.object(
  Object.fromEntries(SECTIONS.map((section) => [section, SectionStateSchema])) as Record<
    Section,
    typeof SectionStateSchema
  >,
);
export type Sections = z.infer<typeof SectionsSchema>;

export const BlockerCode = z.enum([
  'hydrate_failed',
  'pagination_incomplete',
  'line_lost',
  'totals_mismatch',
  'unsupported_currency',
  'buyer_unavailable',
  'shipping_address_missing',
  'line_unmapped',
  'dimensions_unresolved',
]);
export type BlockerCode = z.infer<typeof BlockerCode>;

export const BlockerSchema = z.object({
  code: BlockerCode,
  section: Section,
  detail: z.string().max(2_000),
  nextAction: z.string().max(200),
});
export type Blocker = z.infer<typeof BlockerSchema>;

const MinorString = z.string().regex(/^-?\d+$/);
export type MinorString = z.infer<typeof MinorString>;

const StringRecord = z.record(z.string(), z.string());

const MoneySetSchema = z.object({
  shop_money_minor: MinorString,
  presentment_money_minor: MinorString.optional(),
});

const TaxLineSchema = z.object({
  title: z.string().max(300).optional(),
  rate_basis_points: z.number().int().optional(),
  price_minor: MinorString,
});

const DiscountAllocationSchema = z.object({
  source_discount_id: z.string().max(200).optional(),
  title: z.string().max(300).optional(),
  amount_minor: MinorString,
});

const AddressSchema = z.object({
  name: z.string().max(300).optional(),
  first_name: z.string().max(150).optional(),
  last_name: z.string().max(150).optional(),
  company: z.string().max(300).optional(),
  phone: z.string().max(100).optional(),
  address1: z.string().max(500).optional(),
  address2: z.string().max(500).optional(),
  city: z.string().max(200).optional(),
  province: z.string().max(200).optional(),
  province_code: z.string().max(50).optional(),
  country: z.string().max(200).optional(),
  country_code: z.string().max(10).optional(),
  zip: z.string().max(50).optional(),
});

export const CandidateOrderSchema = z.object({
  header: z.object({
    source_order_id: z.string().min(1).max(200),
    source_order_number: z.string().max(200).optional(),
    source_name: z.string().max(200).optional(),
    source_updated_at: z.string(),
    source_created_at: z.string().optional(),
    processed_at: z.string().optional(),
    cancelled_at: z.string().optional(),
    closed_at: z.string().optional(),
    financial_status: z.string().max(100).optional(),
    fulfillment_status: z.string().max(100).optional(),
    currency_code: z.string().length(3),
    presentment_currency_code: z.string().length(3).optional(),
    subtotal_price_set: MoneySetSchema,
    total_price_set: MoneySetSchema,
    total_tax_set: MoneySetSchema,
    total_discounts_set: MoneySetSchema,
    total_shipping_set: MoneySetSchema,
    total_refunded_set: MoneySetSchema,
    total_outstanding_set: MoneySetSchema,
  }),
  lines: z.array(z.object({
    source_line_id: z.string().min(1).max(200),
    title: z.string().max(500),
    variant_title: z.string().max(500).optional(),
    sku_snapshot: z.string().max(200).optional(),
    source_variant_id: z.string().max(200).optional(),
    source_product_id: z.string().max(200).optional(),
    quantity: z.number().int(),
    current_quantity: z.number().int(),
    unfulfilled_quantity: z.number().int(),
    refundable_quantity: z.number().int(),
    unit_price_minor: MinorString,
    discount_minor: MinorString,
    tax_minor: MinorString,
    total_minor: MinorString,
    requires_shipping: z.boolean(),
    taxable: z.boolean(),
    custom_attributes: StringRecord,
    tax_lines: z.array(TaxLineSchema),
    discount_allocations: z.array(DiscountAllocationSchema),
    mapping: z.object({
      state: z.enum(['mapped', 'unmapped', 'custom_nonstock']),
      variant_id: z.string().max(200).optional(),
    }),
  })),
  buyer: z.object({
    source_customer_id: z.string().max(200).optional(),
    name: z.string().max(300).optional(),
    email: z.string().max(320).optional(),
    phone: z.string().max(100).optional(),
    is_guest: z.boolean(),
  }),
  addresses: z.object({
    billing: AddressSchema.optional(),
    shipping: AddressSchema.optional(),
  }),
  price: z.object({
    subtotal: MinorString,
    discounts: MinorString,
    discount_codes: z.array(z.object({
      code: z.string().max(200),
      amount_minor: MinorString.optional(),
    })),
    tax_lines: z.array(TaxLineSchema),
    shipping: MinorString,
    additional_fees: MinorString,
    total: MinorString,
    refunded: MinorString,
    outstanding: MinorString,
    taxes_included: z.boolean(),
  }),
  currency: z.object({
    shop: z.string().length(3),
    presentment: z.string().length(3).optional(),
  }),
  transactions: z.array(z.object({
    source_transaction_id: z.string().min(1).max(200),
    kind: z.string().max(100),
    status: z.string().max(100),
    gateway: z.string().max(200).optional(),
    amount_minor: MinorString,
    processed_at: z.string().optional(),
  })),
  fulfillments: z.array(z.object({
    source_fulfillment_id: z.string().min(1).max(200),
    status: z.string().max(100).optional(),
    tracking_company: z.string().max(200).optional(),
    tracking_numbers: z.array(z.string().max(200)),
    created_at: z.string().optional(),
  })),
  refunds: z.array(z.object({
    source_refund_id: z.string().min(1).max(200),
    created_at: z.string().optional(),
    total_refunded_minor: MinorString,
  })),
  context: z.object({
    note: z.string().max(5_000).optional(),
    tags: z.array(z.string().max(200)),
    custom_attributes: StringRecord,
    risk: z.unknown().optional(),
    source_name: z.string().max(200).optional(),
    app_name: z.string().max(200).optional(),
    is_test: z.boolean(),
    cancel_reason: z.string().max(200).optional(),
    source_url: z.string().max(2_000).optional(),
  }),
  evidence: z.object({
    inbound_delivery_id: z.string().min(1).max(200),
    api_version: z.string().max(50),
    connector_version: z.string().max(100),
    fetched_at: z.string(),
  }),
});

export type CandidateOrder = z.infer<typeof CandidateOrderSchema>;
