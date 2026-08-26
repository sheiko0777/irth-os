import { EGYPT_VAT_BP, currency, exponentOf, fromMinor, netOfTax, taxIncludedIn, type Money } from './money';

/**
 * Egyptian Tax Authority (ETA) e-invoicing integration.
 *
 * Formerly duplicated byte-for-byte between apps/api/src/services/eta.ts and
 * apps/admin/src/server/services/eta.ts (their own banners explained why:
 * a genuinely shared module needed a new workspace dependency, and linking
 * one needs `pnpm install`, which takes 10-30 minutes on this repo and has
 * corrupted node_modules when killed mid-run). This file lives in
 * `packages/domain` rather than `packages/db` specifically because it has
 * ZERO dependency on `@irth/db` — every function here is pure computation
 * or an HTTP call, and `packages/domain` already has zero dependencies of
 * its own and is already a workspace dependency of both apps. Moving this
 * logic here needed no new install at all.
 *
 * The one thing that DID need `@irth/db` — assembling an `EtaOrderInput`
 * from an order id — stays out of this file for exactly that reason; see
 * `packages/db/src/etaOrderInput.ts`.
 *
 * Config is INJECTED (`EtaConfig`), not read from `process.env`/Worker env
 * directly — the one real divergence between the two old copies was how
 * each app reads its own env var, and a `packages/domain` module must never
 * import an app-specific env helper. `buildEtaConfig()` is how each app
 * bridges the gap: `apps/api` calls `buildEtaConfig(envVar)` (its own
 * Worker-env-aware reader), `apps/admin` calls
 * `buildEtaConfig((k) => process.env[k])`.
 */

function etaIdUrl(env: EtaConfig['env']): string {
    return env === 'production'
        ? 'https://id.eta.gov.eg/connect/token'
        : 'https://id.preprod.eta.gov.eg/connect/token';
}

function etaApiUrl(env: EtaConfig['env']): string {
    return env === 'production'
        ? 'https://api.invoicing.eta.gov.eg/api/v1'
        : 'https://api.preprod.invoicing.eta.gov.eg/api/v1';
}

export interface EtaConfig {
    env: 'production' | 'preprod';
    clientId?: string;
    clientSecret?: string;
    issuerEin?: string;
    activityCode?: string;
    documentTypeId?: string;
}

/** Builds an `EtaConfig` from whatever env-reading function the calling app uses. */
export function buildEtaConfig(read: (key: string) => string | undefined): EtaConfig {
    return {
        env: read('ETA_ENV') === 'production' ? 'production' : 'preprod',
        clientId: read('ETA_CLIENT_ID'),
        clientSecret: read('ETA_CLIENT_SECRET'),
        issuerEin: read('ETA_ISSUER_EIN'),
        activityCode: read('ETA_ACTIVITY_CODE'),
        documentTypeId: read('ETA_INVOICE_DOCUMENT_TYPE_ID'),
    };
}

type EtaTokenResponse = { access_token: string };
type EtaSubmitResponse = { submissionId: string; acceptedDocuments: { uuid: string; longId?: string }[] };
type EtaStatusResponse = { status: string; qrCodeData?: string; longId?: string };

/**
 * The typed outcome of `issueInvoice`. Replaces the old `EtaResult | null`,
 * which collapsed every failure mode — bad config, no items, over the
 * national-ID threshold, a signer that refuses to run, an HTTP failure —
 * into a single `null` with only a `console.error` to tell them apart. A
 * durable job (the outbox worker) needs to know which failures are worth
 * retrying and which are not:
 *
 *   retryable: false — a config/data/compliance problem. No amount of
 *   retrying fixes a missing credential, an order with no items, an amount
 *   over the national-ID threshold, or a signer/UUID seam that is not wired
 *   up. A human has to act.
 *
 *   retryable: true — a transient HTTP/network failure. Worth another
 *   attempt.
 */
export type IssueInvoiceResult =
    | { ok: true; uuid: string; longId?: string; qrCodeData?: string }
    | { ok: false; retryable: true; code: 'auth_failed' | 'http_error' | 'network_error'; message: string }
    | {
        ok: false;
        retryable: false;
        code: 'not_configured' | 'no_items' | 'national_id_required' | 'signer_not_configured' | 'uuid_not_available';
        message: string;
    };

/**
 * ETA rejects a document whose declared national ID is missing when the
 * amount exceeds this threshold (verified: search result on Egypt's B2C
 * e-invoicing rules — "the national ID number of the buyer is required only
 * if the amount exceeds 150,000 Egyptian pounds"). `customers` has no field
 * to capture a national ID at all, so an order above this line cannot
 * currently be submitted compliantly — issueInvoice refuses rather than
 * submit one ETA would flag.
 */
const NATIONAL_ID_REQUIRED_ABOVE_EGP = 150_000_00n; // minor units (piastres)

// ─────────────────────────────────────────────────────────────────────────
// THE SIGNER SEAM
// ─────────────────────────────────────────────────────────────────────────
/**
 * ETA requires every submitted document to carry a CAdES-BES signature
 * produced with the taxpayer's registered cryptographic token (a hardware USB
 * token or an HSM-backed signing service). Nobody has that token yet — it has
 * not been provisioned — so there is no real signer to call.
 *
 * This is a pluggable interface so the real implementation drops in later
 * without touching `issueInvoice` or its callers. Resolution is
 * `EtaConfig.env`-driven, matching every other environment switch in this
 * file, rather than a parameter threaded through every call site.
 */
export interface EtaSigner {
    sign(document: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export class EtaSignerNotConfiguredError extends Error {
    constructor() {
        super(
            'ETA_ENV=production but no real signer is configured. Refusing to ' +
            'submit an unsigned document — ETA requires a CAdES-BES signature from ' +
            "the taxpayer's registered cryptographic token or an HSM-backed signing " +
            'service, neither of which exists yet. An unsigned document silently ' +
            'accepted here would be worse than a failed submission: the business ' +
            'would believe it had filed when it had not, and ETA would reject the ' +
            'submission on its own signature validation regardless — this fails ' +
            'before that network round trip rather than after it.'
        );
        this.name = 'EtaSignerNotConfiguredError';
    }
}

/** Fails closed. The only acceptable behaviour until a real signer exists and `ETA_ENV=production` means it. */
const productionSigner: EtaSigner = {
    async sign(): Promise<Record<string, unknown>> {
        throw new EtaSignerNotConfiguredError();
    },
};

/**
 * Passes the document through UNSIGNED, explicitly marked as such. Lets the
 * rest of the submission pipeline (field shapes, the HTTP round trip, error
 * handling) be exercised structurally against the preprod sandbox before a
 * real token exists.
 *
 * ASSUMPTION, not a verified fact: whether ETA's preprod environment itself
 * rejects an unsigned document is not something this task could verify — "no
 * live calls to any government API" was a hard constraint on this work, and
 * the public documentation on preprod's exact signature enforcement was not
 * found. If preprod also rejects unsigned submissions, this signer will
 * surface that as a failed HTTP call the first time it is actually used —
 * which is an acceptable way to discover it, since nothing NEEDS this to
 * succeed yet.
 */
const preprodUnsignedPassthroughSigner: EtaSigner = {
    async sign(document: Record<string, unknown>): Promise<Record<string, unknown>> {
        return { ...document, signatureType: 'UNSIGNED_PREPROD_TEST', signature: null };
    },
};

export function resolveSigner(config: EtaConfig): EtaSigner {
    return config.env === 'production' ? productionSigner : preprodUnsignedPassthroughSigner;
}

// ─────────────────────────────────────────────────────────────────────────
// THE DOCUMENT UUID — ANOTHER SEAM, NOT A GUESS
// ─────────────────────────────────────────────────────────────────────────
/**
 * ETA's e-invoicing spec requires each document to carry a UUID that ETA
 * itself derives, server-side, by SHA256-hashing a CANONICAL serialization of
 * specific document fields in a fixed order — and validates the submitted
 * document by re-deriving it and comparing.
 *
 * That canonical serialization algorithm is NOT publicly documented. It ships
 * only inside ETA's own integration toolkit (Docker image / NuGet package /
 * CLI), reachable only after registering for the preprod sandbox — confirmed
 * by web search while building this: "The X.509 eSeal signing algorithm and
 * CanonicalJSON serialization rules live in the ETA integration toolkit
 * (Docker/NuGet/CLI), not in public documentation." Fabricating a plausible-
 * looking algorithm here would be actively worse than not implementing one:
 * it would look like real UUID computation, pass a casual review, and produce
 * values that do not match what ETA independently computes — which ETA
 * itself will notice and reject at submission time regardless, just later
 * and with a more confusing error than refusing here.
 *
 * So, like the signer: a seam, not an implementation. Production refuses.
 * Preprod computes something STABLE (so retried submissions of the same
 * document produce the same value, which the rest of the pipeline can rely
 * on) but explicitly NOT ETA-conformant.
 */
export class EtaUuidNotAvailableError extends Error {
    constructor() {
        super(
            'No ETA-conformant document UUID algorithm is available. ETA\'s ' +
            'canonical serialization + hashing rules are not public — they ship ' +
            "inside ETA's own integration toolkit, reachable only via preprod " +
            'sandbox registration. Wire in the toolkit\'s implementation before ' +
            'ETA_ENV=production; a fabricated UUID would be silently wrong.'
        );
        this.name = 'EtaUuidNotAvailableError';
    }
}

async function computeDocumentUuid(canonicalPayload: string, config: EtaConfig): Promise<string> {
    if (config.env === 'production') throw new EtaUuidNotAvailableError();
    // Web Crypto — available in every runtime this repo targets (Workers,
    // Node, browser) with no dependency. Deterministic per input, NOT what
    // ETA would compute.
    const bytes = new TextEncoder().encode(canonicalPayload);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─────────────────────────────────────────────────────────────────────────
// 5-DECIMAL AMOUNT FORMATTING
// ─────────────────────────────────────────────────────────────────────────
/**
 * ETA's JSON schema requires exactly 5 fraction digits on every amount field,
 * regardless of the currency's own precision — EGP has 2 real decimal digits
 * (piastres), so the extra three are always zero, never rounded.
 *
 * Pure integer scaling, not a float conversion: `Number(toDecimalString(m))`
 * round-trips through a float and cannot reliably print a fixed 5 decimals
 * for every value — and re-introduces exactly the float-money defect the
 * rest of this codebase exists to eliminate.
 */
export function toEtaAmountString(m: Money): string {
    const ETA_DECIMALS = 5;
    const exp = exponentOf(m.currency);
    if (exp > ETA_DECIMALS) {
        // No currency in this system has more than 2 decimal places today, but
        // fail loudly rather than silently truncate real precision if that ever
        // changes.
        throw new RangeError(`Currency ${m.currency} has more precision (${exp} places) than ETA's 5-decimal fields can carry.`);
    }
    const negative = m.minor < 0n;
    const abs = negative ? -m.minor : m.minor;
    const scale = 10n ** BigInt(ETA_DECIMALS - exp); // widening only — exact, no rounding
    const scaled = abs * scale;
    const whole = scaled / 10n ** BigInt(ETA_DECIMALS);
    const frac = scaled % 10n ** BigInt(ETA_DECIMALS);
    return `${negative ? '-' : ''}${whole}.${frac.toString().padStart(ETA_DECIMALS, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────
class EtaAuthError extends Error {
    constructor(readonly kind: 'auth_failed' | 'network_error', message: string) {
        super(message);
        this.name = 'EtaAuthError';
    }
}

async function getAuthToken(config: EtaConfig): Promise<string> {
    const { clientId, clientSecret } = config;
    if (!clientId || !clientSecret) throw new Error('ETA credentials not configured');

    let res: Response;
    try {
        res = await fetch(etaIdUrl(config.env), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: clientId,
                client_secret: clientSecret,
                scope: 'InvoicingAPI',
            }),
        });
    } catch (err) {
        throw new EtaAuthError('network_error', err instanceof Error ? err.message : 'ETA auth request failed');
    }
    if (!res.ok) throw new EtaAuthError('auth_failed', `ETA auth failed: ${res.status}`);
    const data = await res.json() as EtaTokenResponse;
    return data.access_token;
}

// ─────────────────────────────────────────────────────────────────────────
// ISSUE INVOICE
// ─────────────────────────────────────────────────────────────────────────
export interface EtaInvoiceLine {
    description: string;
    /** ETA item code (GS1/EGS/GPC). No per-product code exists in this schema today — see the comment at the call site building this. */
    itemCode: string;
    quantity: number;
    unitPriceMinor: bigint;
}

export interface EtaOrderInput {
    id: string;
    orgId: string;
    orderNumber: string;
    currency?: string;
    /** Natural-person receiver name. Real ETA B2C invoicing also wants a national ID above 150,000 EGP — customers has no field for one; see NATIONAL_ID_REQUIRED_ABOVE_EGP. */
    customerName?: string | null;
    items: EtaInvoiceLine[];
}

export async function issueInvoice(order: EtaOrderInput, config: EtaConfig): Promise<IssueInvoiceResult> {
    const { issuerEin } = config;
    if (!config.clientId || !config.clientSecret || !issuerEin) {
        return { ok: false, retryable: false, code: 'not_configured', message: 'ETA credentials not configured.' };
    }
    if (order.items.length === 0) {
        return { ok: false, retryable: false, code: 'no_items', message: `Order ${order.id} has no items to declare.` };
    }

    try {
        const cur = currency(order.currency ?? 'EGP');

        // Per-line net/VAT, not one figure computed on the order total: ETA
        // validates that invoiceLines sum to the document totals, and rounding
        // an aggregate independently from its parts is exactly the kind of
        // reconciliation gap this repo's ledger work exists to prevent
        // elsewhere (this package's own allocate()). Each line's own gross is
        // exact by construction (unit price x quantity, both already integers).
        const lines = order.items.map((item) => {
            const grossMinor = item.unitPriceMinor * BigInt(item.quantity);
            const gross = fromMinor(grossMinor, cur);
            const vat = taxIncludedIn(gross, EGYPT_VAT_BP);
            const net = netOfTax(gross, EGYPT_VAT_BP);
            return { item, gross, vat, net };
        });

        const totalGrossMinor = lines.reduce((acc, l) => acc + l.gross.minor, 0n);
        const totalNetMinor = lines.reduce((acc, l) => acc + l.net.minor, 0n);
        const totalVatMinor = lines.reduce((acc, l) => acc + l.vat.minor, 0n);

        if (totalGrossMinor > NATIONAL_ID_REQUIRED_ABOVE_EGP) {
            return {
                ok: false,
                retryable: false,
                code: 'national_id_required',
                message:
                    `Order ${order.id} (${order.orderNumber}) totals ` +
                    `${toEtaAmountString(fromMinor(totalGrossMinor, cur))} EGP, above the 150,000 EGP ` +
                    "threshold where ETA requires the buyer's national ID. This schema has no field " +
                    'to capture one (packages/db/src/schema/customers.ts).',
            };
        }

        let token: string;
        try {
            token = await getAuthToken(config);
        } catch (err) {
            if (err instanceof EtaAuthError) {
                return { ok: false, retryable: true, code: err.kind, message: err.message };
            }
            throw err;
        }

        const doc: Record<string, unknown> = {
            issuer: { type: 'B', id: issuerEin, name: 'IRTH Business' },
            // Receiver type 'P' (natural person): this is a B2C consumer
            // platform, not B2B. `id: '0'` is the conventional placeholder for
            // "no national ID captured" — real, but NOT the same as ETA having
            // verified there is none; see the threshold refusal above for the
            // policy line where an anonymous receiver stops being acceptable.
            //
            // WORTH FLAGGING, NOT SILENTLY DECIDED: some ETA integration guides
            // describe consumer point-of-sale style transactions as going
            // through a SEPARATE "e-Receipt" document type rather than the
            // "e-Invoice" (documentType: 'I') flow this file has always used.
            // Which one this business should actually submit under is a
            // compliance decision for the user's tax advisor, not something to
            // silently switch here — documentType is left as 'I', unchanged,
            // and this comment exists so the question does not go unasked.
            receiver: { type: 'P', id: '0', name: order.customerName ?? 'Consumer' },
            documentType: 'I',
            documentTypeVersion: '1.0',
            dateTimeIssued: new Date().toISOString(),
            taxpayerActivityCode: config.activityCode ?? '',
            internalId: order.id,
            purchaseOrderReference: order.orderNumber,
            invoiceLines: lines.map(({ item, gross, vat, net }) => ({
                description: item.description,
                itemType: 'EGS',
                itemCode: item.itemCode,
                unitType: 'EA',
                quantity: item.quantity,
                unitValue: {
                    currencySold: cur,
                    amountEGP: toEtaAmountString(fromMinor(item.unitPriceMinor, cur)),
                },
                salesTotal: toEtaAmountString(gross),
                total: toEtaAmountString(gross),
                valueDifference: toEtaAmountString(fromMinor(0n, cur)),
                totalTaxableFees: toEtaAmountString(fromMinor(0n, cur)),
                netTotal: toEtaAmountString(net),
                itemsDiscount: toEtaAmountString(fromMinor(0n, cur)),
                taxableItems: [{ taxType: 'T1', amount: toEtaAmountString(vat), subType: 'V009', rate: 14 }],
            })),
            totalSalesAmount: toEtaAmountString(fromMinor(totalGrossMinor, cur)),
            totalDiscountAmount: toEtaAmountString(fromMinor(0n, cur)),
            netAmount: toEtaAmountString(fromMinor(totalNetMinor, cur)),
            taxTotals: [{ taxType: 'T1', amount: toEtaAmountString(fromMinor(totalVatMinor, cur)) }],
            extraDiscountAmount: toEtaAmountString(fromMinor(0n, cur)),
            totalItemsDiscountAmount: toEtaAmountString(fromMinor(0n, cur)),
            totalAmount: toEtaAmountString(fromMinor(totalGrossMinor, cur)),
        };

        try {
            doc.uuid = await computeDocumentUuid(JSON.stringify(doc), config);
        } catch (err) {
            if (err instanceof EtaUuidNotAvailableError) {
                return { ok: false, retryable: false, code: 'uuid_not_available', message: err.message };
            }
            throw err;
        }

        let signedDoc: Record<string, unknown>;
        try {
            signedDoc = await resolveSigner(config).sign(doc);
        } catch (err) {
            if (err instanceof EtaSignerNotConfiguredError) {
                return { ok: false, retryable: false, code: 'signer_not_configured', message: err.message };
            }
            throw err;
        }

        let res: Response;
        try {
            res = await fetch(`${etaApiUrl(config.env)}/documentsubmissions`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ documents: [signedDoc] }),
            });
        } catch (err) {
            return {
                ok: false, retryable: true, code: 'network_error',
                message: err instanceof Error ? err.message : 'ETA submission request failed',
            };
        }
        if (!res.ok) {
            return { ok: false, retryable: true, code: 'http_error', message: `ETA submission failed: ${res.status}` };
        }

        const data = await res.json() as EtaSubmitResponse;
        const accepted = data.acceptedDocuments?.[0];
        return { ok: true, uuid: accepted?.uuid ?? (doc.uuid as string), longId: accepted?.longId };
    } catch (err) {
        // Anything not already classified above (a genuine bug, an unexpected
        // shape from ETA's API) is treated as worth one more try rather than
        // silently dropped — the conservative default, since we cannot prove
        // it is a permanent condition.
        return {
            ok: false, retryable: true, code: 'network_error',
            message: err instanceof Error ? err.message : 'Unexpected ETA issueInvoice failure',
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────
// STATUS / CANCEL
// ─────────────────────────────────────────────────────────────────────────
export async function getInvoiceStatus(uuid: string, config: EtaConfig): Promise<{ status: string; qrCodeData?: string; longId?: string }> {
    if (!config.clientId || !config.clientSecret) return { status: 'Unknown' };
    try {
        const token = await getAuthToken(config);
        const res = await fetch(`${etaApiUrl(config.env)}/documents/${uuid}/details`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json() as EtaStatusResponse;
        return { status: data.status ?? 'Valid', qrCodeData: data.qrCodeData, longId: data.longId };
    } catch (err) {
        console.error('ETA getInvoiceStatus error:', err);
        return { status: 'Error' };
    }
}

/**
 * The document's rejection/cancellation time window, in hours, read from
 * ETA's Get Document Type API rather than hardcoded.
 *
 * Verified via ETA's own SDK docs while building this: `GET
 * /api/v1.0/documenttypes/{id}` returns `workflowParameters: [{parameter,
 * value, activeFrom, activeTo}]`, with a documented example entry `{parameter:
 * "Rejection time limit in hours", value: 72}`. The commonly-quoted "72 hours"
 * figure is that DOCUMENTED EXAMPLE value, not a fact this code should assume
 * stays true — the whole point of the parameter being versioned with
 * activeFrom/activeTo is that ETA can change it. Only a parameter whose active
 * window covers *now* is used.
 *
 * `documentTypeId` is deliberately NOT hardcoded (ETA's docs describe it as a
 * per-taxpayer/per-registration identifier, not a fixed constant across
 * integrations) — callers must supply the id from their own ETA registration,
 * via `ETA_INVOICE_DOCUMENT_TYPE_ID`.
 */
export async function getCancellationWindowHours(config: EtaConfig): Promise<number | null> {
    const { documentTypeId } = config;
    if (!config.clientId || !config.clientSecret || !documentTypeId) return null;

    try {
        const token = await getAuthToken(config);
        const res = await fetch(`${etaApiUrl(config.env)}/documenttypes/${documentTypeId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return null;
        const data = await res.json() as {
            workflowParameters?: { parameter: string; value: number; activeFrom?: string; activeTo?: string }[];
        };

        const now = new Date();
        const candidates = (data.workflowParameters ?? []).filter((p) => {
            if (!/cancel|reject/i.test(p.parameter)) return false;
            if (p.activeFrom && new Date(p.activeFrom) > now) return false;
            if (p.activeTo && new Date(p.activeTo) < now) return false;
            return true;
        });
        // Prefer a parameter explicitly naming "cancel" over one naming
        // "reject" — ETA's flow distinguishes the issuer cancelling from the
        // receiver rejecting, and they are not guaranteed to share a window.
        const cancelSpecific = candidates.find((p) => /cancel/i.test(p.parameter));
        return (cancelSpecific ?? candidates[0])?.value ?? null;
    } catch (err) {
        console.error('ETA getCancellationWindowHours error:', err);
        return null;
    }
}

export async function cancelInvoice(uuid: string, reason: string, submittedAt: Date | null, config: EtaConfig): Promise<{ ok: boolean; error?: string }> {
    if (!config.clientId || !config.clientSecret) return { ok: false, error: 'not_configured' };

    // Read from ETA rather than hardcode. `null` (the API call itself failed,
    // or ETA_INVOICE_DOCUMENT_TYPE_ID is not set) means the window is UNKNOWN
    // — that is refused rather than treated as "no limit", since submitting
    // past an unknown-but-real window would be rejected by ETA anyway, and
    // silently allowing it here would hide the actual reason for that failure.
    const windowHours = await getCancellationWindowHours(config);
    if (windowHours === null) {
        return { ok: false, error: 'cancellation_window_unknown' };
    }
    if (submittedAt) {
        const hoursSinceSubmission = (Date.now() - submittedAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceSubmission > windowHours) {
            return { ok: false, error: `cancellation_window_expired (${windowHours}h)` };
        }
    }

    try {
        const token = await getAuthToken(config);
        const res = await fetch(`${etaApiUrl(config.env)}/documents/state/${uuid}/state`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'cancelled', reason }),
        });
        return { ok: res.ok, error: res.ok ? undefined : `http_${res.status}` };
    } catch (err) {
        console.error('ETA cancelInvoice error:', err);
        return { ok: false, error: 'request_failed' };
    }
}
