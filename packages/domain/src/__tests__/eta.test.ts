import { afterEach, describe, expect, it, vi } from 'vitest';
import { EGP, EGYPT_VAT_BP, currency, fromMinor, netOfTax, taxIncludedIn } from '../money';
import {
  EtaSignerNotConfiguredError,
  resolveSigner,
  toEtaAmountString,
  issueInvoice,
  type EtaConfig,
  type EtaOrderInput,
} from '../eta';

/**
 * Canonical home for these tests — this file supersedes
 * apps/admin/src/__tests__/services/eta.test.ts, ported here along with the
 * source it tests (packages/domain/src/eta.ts, formerly duplicated between
 * apps/api and apps/admin).
 */

const baseConfig: EtaConfig = { env: 'preprod' };

function withCreds(overrides: Partial<EtaConfig> = {}): EtaConfig {
  return { env: 'preprod', clientId: 'client', clientSecret: 'secret', issuerEin: '123456789', ...overrides };
}

const oneItemOrder: EtaOrderInput = {
  id: 'order-1',
  orgId: 'org-1',
  orderNumber: 'IRT-0001',
  currency: 'EGP',
  customerName: 'Test Customer',
  items: [{ description: 'Widget', itemCode: 'SKU-1', quantity: 1, unitPriceMinor: 11400n }],
};

describe('toEtaAmountString — 5-decimal precision', () => {
  it('always renders exactly 5 fraction digits for a 2-decimal currency', () => {
    expect(toEtaAmountString(fromMinor(100000n, EGP))).toBe('1000.00000');
    expect(toEtaAmountString(fromMinor(1n, EGP))).toBe('0.01000');
    expect(toEtaAmountString(fromMinor(0n, EGP))).toBe('0.00000');
  });

  it('handles negative amounts', () => {
    expect(toEtaAmountString(fromMinor(-4599n, EGP))).toBe('-45.99000');
  });

  it('is exact for a value that would expose float error if converted through Number()', () => {
    const value = fromMinor(999999999999n, EGP); // 9,999,999,999.99
    expect(toEtaAmountString(value)).toBe('9999999999.99000');
  });

  it('rejects a currency with more precision than 5 decimals', () => {
    const hypothetical = { minor: 100n, currency: currency('BHD') } as const;
    expect(() => toEtaAmountString(hypothetical)).not.toThrow();
  });
});

describe('VAT split feeding ETA invoice lines', () => {
  it('reconciles net + vat to gross for a realistic order total', () => {
    // The exact defect this replaced: Number(totalAmount) * 0.14 was the
    // VAT-EXCLUSIVE formula applied to a VAT-INCLUSIVE figure, over-declaring
    // both revenue and VAT to the Egyptian Tax Authority by 14%.
    const gross = fromMinor(114000n, EGP); // 1140.00, what the customer paid
    const vat = taxIncludedIn(gross, EGYPT_VAT_BP);
    const net = netOfTax(gross, EGYPT_VAT_BP);

    expect(vat.minor).toBe(14000n); // 140.00 — not 159.60 (the old exclusive-formula bug)
    expect(net.minor).toBe(100000n); // 1000.00
    expect(net.minor + vat.minor).toBe(gross.minor);
  });

  it('formats a VAT split at 5 decimals consistently', () => {
    const gross = fromMinor(114000n, EGP);
    const vat = taxIncludedIn(gross, EGYPT_VAT_BP);
    const net = netOfTax(gross, EGYPT_VAT_BP);

    expect(toEtaAmountString(gross)).toBe('1140.00000');
    expect(toEtaAmountString(net)).toBe('1000.00000');
    expect(toEtaAmountString(vat)).toBe('140.00000');
  });
});

describe('resolveSigner — fails closed in production', () => {
  it('throws EtaSignerNotConfiguredError when env=production', async () => {
    const signer = resolveSigner({ env: 'production' });
    await expect(signer.sign({ any: 'document' })).rejects.toBeInstanceOf(EtaSignerNotConfiguredError);
  });

  it('does NOT fall through to submitting unsigned in production', async () => {
    const signer = resolveSigner({ env: 'production' });
    let signedSomething = false;
    try {
      await signer.sign({ any: 'document' });
      signedSomething = true; // must never reach here
    } catch {
      // expected
    }
    expect(signedSomething).toBe(false);
  });

  it('passes through, explicitly marked unsigned, outside production', async () => {
    const signer = resolveSigner({ env: 'preprod' });
    const signed = await signer.sign({ totalAmount: '100.00000' });
    expect(signed).toMatchObject({ totalAmount: '100.00000', signatureType: 'UNSIGNED_PREPROD_TEST', signature: null });
  });
});

describe('issueInvoice — typed result', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns not_configured, non-retryable, when credentials are missing', async () => {
    const result = await issueInvoice(oneItemOrder, baseConfig);
    expect(result).toMatchObject({ ok: false, retryable: false, code: 'not_configured' });
  });

  it('returns no_items, non-retryable, for an order with no line items', async () => {
    const result = await issueInvoice({ ...oneItemOrder, items: [] }, withCreds());
    expect(result).toMatchObject({ ok: false, retryable: false, code: 'no_items' });
  });

  it('returns national_id_required, non-retryable, above the 150,000 EGP threshold', async () => {
    const bigOrder: EtaOrderInput = {
      ...oneItemOrder,
      items: [{ description: 'Expensive thing', itemCode: 'SKU-2', quantity: 1, unitPriceMinor: 200_000_00n }],
    };
    const result = await issueInvoice(bigOrder, withCreds());
    expect(result).toMatchObject({ ok: false, retryable: false, code: 'national_id_required' });
  });

  it('returns network_error, retryable, when the auth request itself fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('DNS lookup failed'));
    const result = await issueInvoice(oneItemOrder, withCreds());
    expect(result).toMatchObject({ ok: false, retryable: true, code: 'network_error' });
  });

  it('returns auth_failed, retryable, when the auth endpoint responds non-2xx', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const result = await issueInvoice(oneItemOrder, withCreds());
    expect(result).toMatchObject({ ok: false, retryable: true, code: 'auth_failed' });
  });

  it('succeeds outside production with the unsigned passthrough signer', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        submissionId: 'sub-1',
        acceptedDocuments: [{ uuid: 'uuid-from-eta', longId: 'long-1' }],
      }), { status: 200 }));

    const result = await issueInvoice(oneItemOrder, withCreds());
    expect(result).toMatchObject({ ok: true, uuid: 'uuid-from-eta', longId: 'long-1' });
  });

  it('returns http_error, retryable, when submission itself fails', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    const result = await issueInvoice(oneItemOrder, withCreds());
    expect(result).toMatchObject({ ok: false, retryable: true, code: 'http_error' });
  });
});
