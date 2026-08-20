import { EGYPT_VAT_BP, currency, exponentOf, fromMinor, netOfTax, taxIncludedIn, type Money } from '@irth/domain';

/**
 * Egyptian Tax Authority (ETA) e-invoicing integration.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS FILE IS DUPLICATED, NOT SHARED — READ BEFORE EDITING
 * ═══════════════════════════════════════════════════════════════════════════
 * A byte-for-byte copy lives at apps/api/src/services/eta.ts. It should be
 * ONE shared module (e.g. a `packages/eta` workspace package both apps
 * depend on), and was not made one here because linking a NEW workspace
 * package — or adding a new workspace dependency to an existing package —
 * needs `pnpm install` to create the symlink in node_modules, and that
 * install takes 10-30 minutes on this repo and has corrupted node_modules
 * when killed mid-run before (see this refactor's own history). The two
 * previously drifted once already: the VAT-inclusive/exclusive bug was fixed
 * in one copy and not the other for a period, and only the fact that someone
 * happened to notice and hand-port it kept them in sync.
 *
 * Until an install can run: EDIT BOTH FILES IDENTICALLY, or file the drift as
 * a known defect the moment you cannot. The follow-up is to extract this into
 * `packages/eta` the next time an install is safe to run, and delete the copy.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const isProd = process.env.ETA_ENV === 'production';
const ETA_ID_URL = isProd
    ? 'https://id.eta.gov.eg/connect/token'
    : 'https://id.preprod.eta.gov.eg/connect/token';
const ETA_API_URL = isProd
    ? 'https://api.invoicing.eta.gov.eg/api/v1'
    : 'https://api.preprod.invoicing.eta.gov.eg/api/v1';

type EtaTokenResponse = { access_token: string };
type EtaSubmitResponse = { submissionId: string; acceptedDocuments: { uuid: string; longId?: string }[] };
type EtaStatusResponse = { status: string; qrCodeData?: string; longId?: string };
export type EtaResult = { uuid: string; longId?: string; qrCodeData?: string } | null;

/**
 * ETA rejects a document whose declared national ID is missing when the
 * amount exceeds this threshold (verified: search result on Egypt's B2C
 * e-invoicing rules — "the national ID number of the buyer is required only
 * if the amount exceeds 150,000 Egyptian pounds"). `customers` has no field
 * to capture a national ID at all (see CustomerReceiver below), so an order
 * above this line cannot currently be submitted compliantly — issueInvoice
 * refuses rather than submit one ETA would flag.
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
 * This is the seam the plan asked for: a pluggable interface so the real
 * implementation drops in later without touching `issueInvoice` or its
 * callers. Resolution is env-driven (`ETA_ENV`), matching every other
 * environment switch already in this file, rather than a parameter threaded
 * through every call site.
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

export function resolveSigner(): EtaSigner {
    // Reads process.env.ETA_ENV freshly on every call, deliberately NOT the
    // module-level `isProd` used for the URL constants above. A real process
    // sets ETA_ENV once at deploy time and never changes it, so this
    // distinction has no runtime consequence there — but freezing "is this
    // production" at first import is also the one thing that would make a
    // signer choice IMPOSSIBLE to unit test without re-importing the module
    // per case. The extra env read costs nothing and removes that trap.
    return process.env.ETA_ENV === 'production' ? productionSigner : preprodUnsignedPassthroughSigner;
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

async function computeDocumentUuid(canonicalPayload: string): Promise<string> {
    // Fresh read, not the frozen module-level `isProd` — same reasoning as
    // resolveSigner above.
    if (process.env.ETA_ENV === 'production') throw new EtaUuidNotAvailableError();
    // Node's webcrypto — available without a new dependency (no install
    // possible right now, see the file banner above). Deterministic per
    // input, NOT what ETA would compute.
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
 * (what this file did before) round-trips through a float and cannot reliably
 * print a fixed 5 decimals for every value — and re-introduces exactly the
 * float-money defect the rest of this codebase exists to eliminate.
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
async function getAuthToken(): Promise<string> {
    const clientId = process.env.ETA_CLIENT_ID;
    const clientSecret = process.env.ETA_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('ETA credentials not configured');

    const res = await fetch(ETA_ID_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'InvoicingAPI',
        }),
    });
    if (!res.ok) throw new Error(`ETA auth failed: ${res.status}`);
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

export async function issueInvoice(order: EtaOrderInput): Promise<EtaResult> {
    const issuerEin = process.env.ETA_ISSUER_EIN;
    if (!process.env.ETA_CLIENT_ID || !process.env.ETA_CLIENT_SECRET || !issuerEin) {
        console.warn('ETA credentials not configured. Skipping.');
        return null;
    }
    if (order.items.length === 0) {
        console.warn(`ETA issueInvoice: order ${order.id} has no items to declare. Skipping.`);
        return null;
    }

    try {
        const cur = currency(order.currency ?? 'EGP');

        // Per-line net/VAT, not one figure computed on the order total: ETA
        // validates that invoiceLines sum to the document totals, and rounding
        // an aggregate independently from its parts is exactly the kind of
        // reconciliation gap this refactor's ledger work exists to prevent
        // elsewhere (packages/domain's allocate()). Each line's own gross is
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
            console.error(
                `ETA issueInvoice: order ${order.id} (${order.orderNumber}) totals ` +
                `${toEtaAmountString(fromMinor(totalGrossMinor, cur))} EGP, above the ` +
                '150,000 EGP threshold where ETA requires the buyer\'s national ID. ' +
                'This schema has no field to capture one (packages/db/src/schema/' +
                'customers.ts). Refusing to submit rather than declare an anonymous ' +
                'receiver ETA would reject or flag.'
            );
            return null;
        }

        const token = await getAuthToken();

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
            taxpayerActivityCode: process.env.ETA_ACTIVITY_CODE ?? '',
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

        doc.uuid = await computeDocumentUuid(JSON.stringify(doc));

        const signer = resolveSigner();
        const signedDoc = await signer.sign(doc);

        const res = await fetch(`${ETA_API_URL}/documentsubmissions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ documents: [signedDoc] }),
        });
        if (!res.ok) throw new Error(`ETA submission failed: ${res.status}`);

        const data = await res.json() as EtaSubmitResponse;
        const accepted = data.acceptedDocuments?.[0];
        return { uuid: accepted?.uuid ?? (doc.uuid as string), longId: accepted?.longId };
    } catch (err) {
        console.error('ETA issueInvoice error:', err);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────
// STATUS / CANCEL
// ─────────────────────────────────────────────────────────────────────────
export async function getInvoiceStatus(uuid: string): Promise<{ status: string; qrCodeData?: string; longId?: string }> {
    if (!process.env.ETA_CLIENT_ID || !process.env.ETA_CLIENT_SECRET) return { status: 'Unknown' };
    try {
        const token = await getAuthToken();
        const res = await fetch(`${ETA_API_URL}/documents/${uuid}/details`, {
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
 * `${ETA_API_URL}/documenttypes/{id}` reuses this file's existing v1 base
 * rather than the literal `v1.0` path segment shown in ETA's docs for this one
 * endpoint — that discrepancy could not be resolved without calling the real
 * API (out of scope for this task) and should be confirmed against the
 * preprod sandbox once credentials exist.
 *
 * `documentTypeId` is deliberately NOT hardcoded (ETA's docs describe it as a
 * per-taxpayer/per-registration identifier, not a fixed constant across
 * integrations) — callers must supply the id from their own ETA registration,
 * via `ETA_INVOICE_DOCUMENT_TYPE_ID`.
 */
export async function getCancellationWindowHours(): Promise<number | null> {
    const documentTypeId = process.env.ETA_INVOICE_DOCUMENT_TYPE_ID;
    if (!process.env.ETA_CLIENT_ID || !process.env.ETA_CLIENT_SECRET || !documentTypeId) return null;

    try {
        const token = await getAuthToken();
        const res = await fetch(`${ETA_API_URL}/documenttypes/${documentTypeId}`, {
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

export async function cancelInvoice(uuid: string, reason: string, submittedAt: Date | null): Promise<{ ok: boolean; error?: string }> {
    if (!process.env.ETA_CLIENT_ID || !process.env.ETA_CLIENT_SECRET) return { ok: false, error: 'not_configured' };

    // Read from ETA rather than hardcode. `null` (the API call itself failed,
    // or ETA_INVOICE_DOCUMENT_TYPE_ID is not set) means the window is UNKNOWN
    // — that is refused rather than treated as "no limit", since submitting
    // past an unknown-but-real window would be rejected by ETA anyway, and
    // silently allowing it here would hide the actual reason for that failure.
    const windowHours = await getCancellationWindowHours();
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
        const token = await getAuthToken();
        const res = await fetch(`${ETA_API_URL}/documents/state/${uuid}/state`, {
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
