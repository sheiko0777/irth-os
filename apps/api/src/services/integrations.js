const encoder = new TextEncoder();
async function toHex(buffer) {
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
async function sha256Hex(text) {
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return toHex(hashBuffer);
}
async function hmacSha256(key, data) {
    const keyData = encoder.encode(key);
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const messageData = encoder.encode(data);
    return crypto.subtle.sign('HMAC', cryptoKey, messageData);
}
export async function createFawryCharge(req) {
    const baseUrl = process.env.FAWRY_BASE_URL;
    const merchantCode = process.env.FAWRY_MERCHANT_CODE;
    const secKey = process.env.FAWRY_SEC_KEY;
    if (!baseUrl || !merchantCode || !secKey) {
        throw new Error('Missing Fawry environment variables');
    }
    // Signature logic for Fawry
    // merchantCode + merchantRefNum + customerProfileId + returnUrl + chargeItems details + secKey
    let signatureString = merchantCode + req.merchantRefNum + req.customerProfileId + (req.returnUrl || '');
    for (const item of req.chargeItems) {
        signatureString += item.itemId + item.quantity + item.price;
    }
    signatureString += secKey;
    const signature = await sha256Hex(signatureString);
    const payload = {
        merchantCode,
        merchantRefNum: req.merchantRefNum,
        customerProfileId: req.customerProfileId,
        customerMobile: req.customerMobile,
        customerEmail: req.customerEmail,
        amount: req.amount,
        currencyCode: req.currencyCode || 'EGP',
        chargeItems: req.chargeItems,
        returnUrl: req.returnUrl,
        signature,
    };
    const response = await fetch(`${baseUrl}/ECommerceWeb/Fawry/payments/charge`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error(`Fawry API error: ${response.statusText}`);
    }
    return response.json();
}
export async function sendWhatsAppTemplate(to, templateName, components = []) {
    const apiKey = process.env.WHATSAPP_360DIALOG_API_KEY;
    if (!apiKey) {
        throw new Error('Missing WhatsApp 360dialog API key');
    }
    const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
            name: templateName,
            language: {
                code: 'ar'
            },
            components
        }
    };
    const response = await fetch('https://waba.360dialog.io/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'D360-API-KEY': apiKey
        },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`WhatsApp API error: ${response.status} - ${errorText}`);
    }
    return response.json();
}
export async function sendTransactionalEmail(opts) {
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM;
    if (!apiKey || !fromEmail) {
        throw new Error('Missing Resend environment variables');
    }
    const payload = {
        from: fromEmail,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html
    };
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Resend API error: ${response.status} - ${errorText}`);
    }
    return response.json();
}
async function getSignatureKey(key, dateStamp, regionName, serviceName) {
    const kDate = await hmacSha256("AWS4" + key, dateStamp);
    const kRegion = await crypto.subtle.importKey('raw', kDate, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const kRegionSign = await crypto.subtle.sign('HMAC', kRegion, encoder.encode(regionName));
    const kService = await crypto.subtle.importKey('raw', kRegionSign, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const kServiceSign = await crypto.subtle.sign('HMAC', kService, encoder.encode(serviceName));
    const kSigning = await crypto.subtle.importKey('raw', kServiceSign, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const kSigningSign = await crypto.subtle.sign('HMAC', kSigning, encoder.encode("aws4_request"));
    return kSigningSign;
}
export async function uploadToR2(key, buffer, contentType) {
    const accountId = process.env.CF_ACCOUNT_ID;
    const bucket = process.env.CF_R2_BUCKET;
    const accessKeyId = process.env.CF_R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.CF_R2_SECRET_ACCESS_KEY;
    const publicUrl = process.env.CF_R2_PUBLIC_URL;
    if (!accountId || !bucket || !accessKeyId || !secretAccessKey || !publicUrl) {
        throw new Error('Missing Cloudflare R2 environment variables');
    }
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    const url = `${endpoint}/${bucket}/${key}`;
    const method = 'PUT';
    const service = 's3';
    const region = 'auto';
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const payloadHash = await toHex(hashBuffer);
    const canonicalUri = `/${bucket}/${key}`;
    const canonicalQuerystring = '';
    const canonicalHeaders = `host:${accountId}.r2.cloudflarestorage.com\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuerystring}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
    const canonicalRequestHash = await sha256Hex(canonicalRequest);
    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;
    const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
    const signingCryptoKey = await crypto.subtle.importKey('raw', signingKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signatureBuffer = await crypto.subtle.sign('HMAC', signingCryptoKey, encoder.encode(stringToSign));
    const signature = await toHex(signatureBuffer);
    const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const response = await fetch(url, {
        method,
        headers: {
            'Content-Type': contentType,
            'x-amz-date': amzDate,
            'x-amz-content-sha256': payloadHash,
            'Authorization': authorizationHeader
        },
        body: buffer
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`R2 Upload error: ${response.status} - ${errorText}`);
    }
    return `${publicUrl}/${key}`;
}
