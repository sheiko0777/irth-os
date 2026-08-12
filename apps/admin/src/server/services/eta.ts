import { EGYPT_VAT_BP, currency, fromMinor, netOfTax, taxIncludedIn, toDecimalString } from '@irth/domain';

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

export async function issueInvoice(order: {
    id: string;
    orgId: string;
    totalAmountMinor: bigint;
    currency?: string;
}): Promise<EtaResult> {
    const issuerEin = process.env.ETA_ISSUER_EIN;
    if (!process.env.ETA_CLIENT_ID || !process.env.ETA_CLIENT_SECRET || !issuerEin) {
        console.warn('ETA credentials not configured. Skipping.');
        return null;
    }

    try {
        const token = await getAuthToken();

        // orders.total_amount_minor is what the customer paid, so it is
        // VAT-INCLUSIVE. This previously did `amount * 0.14` and submitted
        // `netAmount: amount` with `totalAmount: amount + vatAmount` — the
        // VAT-EXCLUSIVE formula. For a customer who paid 1140.00 that declared
        // net 1140.00 / VAT 159.60 / total 1299.60 to the Egyptian Tax
        // Authority, when the truth is net 1000.00 / VAT 140.00 / total 1140.00:
        // revenue and VAT owed both over-declared by 14%.
        const gross = fromMinor(order.totalAmountMinor, currency(order.currency ?? 'EGP'));
        const vat = taxIncludedIn(gross, EGYPT_VAT_BP);
        const net = netOfTax(gross, EGYPT_VAT_BP);

        // ETA's JSON carries numbers. Converting the exact decimal string at the
        // boundary keeps the arithmetic above in integers; nothing is computed
        // from these. (P5 still owes 5-decimal precision and real invoice lines.)
        const amount = Number(toDecimalString(net));
        const vatAmount = Number(toDecimalString(vat));
        const grossAmount = Number(toDecimalString(gross));

        const doc = {
            issuer: { type: 'B', id: issuerEin, name: 'IRTH Business' },
            receiver: { type: 'P', id: '123456789', name: 'Customer' },
            documentType: 'I',
            documentTypeVersion: '1.0',
            dateTimeIssued: new Date().toISOString(),
            taxpayerActivityCode: '1061',
            internalId: order.id,
            purchaseOrderReference: order.id,
            invoiceLines: [{
                description: 'Order Items',
                itemType: 'EGS',
                itemCode: 'EG-1234567',
                unitType: 'EA',
                quantity: 1,
                unitValue: { currencySold: 'EGP', amountEGP: amount },
                salesTotal: amount,
                total: amount,
                valueDifference: 0,
                totalTaxableFees: 0,
                netTotal: amount,
                itemsDiscount: 0,
                taxableItems: [{ taxType: 'T1', amount: vatAmount, subType: 'V009', rate: 14 }],
            }],
            totalSalesAmount: amount,
            totalDiscountAmount: 0,
            netAmount: amount,
            taxTotals: [{ taxType: 'T1', amount: vatAmount }],
            extraDiscountAmount: 0,
            totalItemsDiscountAmount: 0,
            totalAmount: grossAmount,
        };

        const res = await fetch(`${ETA_API_URL}/documentsubmissions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ documents: [doc] }),
        });
        if (!res.ok) throw new Error(`ETA submission failed: ${res.status}`);

        const data = await res.json() as EtaSubmitResponse;
        const accepted = data.acceptedDocuments?.[0];
        return { uuid: accepted?.uuid ?? `mock-${order.id}`, longId: accepted?.longId };
    } catch (err) {
        console.error('ETA issueInvoice error:', err);
        return null;
    }
}

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

export async function cancelInvoice(uuid: string, reason: string): Promise<boolean> {
    if (!process.env.ETA_CLIENT_ID || !process.env.ETA_CLIENT_SECRET) return false;
    try {
        const token = await getAuthToken();
        const res = await fetch(`${ETA_API_URL}/documents/state/${uuid}/state`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'cancelled', reason }),
        });
        return res.ok;
    } catch (err) {
        console.error('ETA cancelInvoice error:', err);
        return false;
    }
}
