const getBaseUrls = () => {
  const env = process.env.ETA_ENV || 'sandbox';
  if (env === 'production') {
    return {
      id: 'https://id.eta.gov.eg',
      api: 'https://api.invoicing.eta.gov.eg'
    };
  }
  return {
    id: 'https://id.preprod.eta.gov.eg',
    api: 'https://api.preprod.invoicing.eta.gov.eg'
  };
};

const getAuthToken = async () => {
  const clientId = process.env.ETA_CLIENT_ID;
  const clientSecret = process.env.ETA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("ETA credentials not configured");
  }

  const urls = getBaseUrls();

  const tokenRes = await fetch(`${urls.id}/connect/token`, {
     method: 'POST',
     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
     body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'InvoicingAPI'
     })
  });

  if (!tokenRes.ok) {
     throw new Error(`ETA token auth failed: ${tokenRes.status}`);
  }

  const tokenData = await tokenRes.json() as { access_token: string };
  return tokenData.access_token;
};

export const issueInvoice = async (order: { id: string, orgId: string, totalAmount: string, customerName?: string, customerTaxId?: string }) => {
    const issuerEin = process.env.ETA_ISSUER_EIN;
    const activityCode = process.env.ETA_TAXPAYER_ACTIVITY_CODE || '1061';
  
    if (!issuerEin) {
      console.warn("ETA issuer EIN not configured. Skipping invoice issuance.");
      return null;
    }
  
    try {
      const accessToken = await getAuthToken();
      const urls = getBaseUrls();
  
      // 2. Map IRTH Order to ETA Document Format
      // Add 14% VAT on all items
      const vatRate = 0.14;
      const amount = Number(order.totalAmount);
      const vatAmount = amount * vatRate;
      
      const doc = {
        issuer: {
           type: "B",
           id: issuerEin,
           name: "IRTH Business"
        },
        receiver: {
           type: order.customerTaxId ? "B" : "P",
           id: order.customerTaxId || "123456789", // Mock receiver id if P
           name: order.customerName || "Customer"
        },
        documentType: "I",
        documentTypeVersion: "1.0",
        dateTimeIssued: new Date().toISOString(),
        taxpayerActivityCode: activityCode,
        internalId: order.id,
        purchaseOrderReference: order.id,
        invoiceLines: [
            {
               description: "Order Items",
               itemType: "EGS",
               itemCode: "EG-1234567",
               unitType: "EA",
               quantity: 1,
               unitValue: { currencySold: "EGP", amountEGP: amount },
               salesTotal: amount,
               total: amount,
               valueDifference: 0,
               totalTaxableFees: 0,
               netTotal: amount,
               itemsDiscount: 0,
               taxableItems: [
                   { taxType: "T1", amount: vatAmount, subType: "V009", rate: 14 }
               ]
            }
        ],
        totalSalesAmount: amount,
        totalDiscountAmount: 0,
        netAmount: amount,
        taxTotals: [
            { taxType: "T1", amount: vatAmount }
        ],
        extraDiscountAmount: 0,
        totalItemsDiscountAmount: 0,
        totalAmount: amount + vatAmount
      };
  
      // 3. Submit Document to ETA API
      const submitRes = await fetch(`${urls.api}/api/v1/documentsubmissions`, {
          method: 'POST',
          headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
          },
          body: JSON.stringify({ documents: [doc] })
      });

      if (!submitRes.ok) {
          throw new Error(`ETA submission failed: ${submitRes.status}`);
      }

      const submitData = await submitRes.json() as { submissionId: string; acceptedDocuments: { uuid: string, longId: string, hashKey: string }[], rejectedDocuments: { error: { message: string } }[] };
  
      if (submitData.rejectedDocuments && submitData.rejectedDocuments.length > 0) {
        throw new Error(`ETA rejected document: ${submitData.rejectedDocuments[0].error.message}`);
      }

      const acceptedDoc = submitData.acceptedDocuments?.[0];
      if (!acceptedDoc) {
        throw new Error("No accepted document returned from ETA");
      }

      console.log(`Successfully submitted invoice for order ${order.id} to ETA. UUID: ${acceptedDoc.uuid}`);
      return {
        uuid: acceptedDoc.uuid,
        longId: acceptedDoc.longId,
        qrData: acceptedDoc.hashKey, // hashKey can be used for QR in ETA
        status: "submitted"
      };
    } catch (err) {
      console.error("Failed to issue ETA invoice:", err);
      throw err;
    }
};
  
export const getInvoiceStatus = async (uuid: string) => {
    try {
      const accessToken = await getAuthToken();
      const urls = getBaseUrls();

      const res = await fetch(`${urls.api}/api/v1/documents/${uuid}/details`, {
          headers: {
              'Authorization': `Bearer ${accessToken}`
          }
      });

      if (!res.ok) {
          throw new Error(`ETA fetch status failed: ${res.status}`);
      }

      const data = await res.json() as { status: string, longId: string };
      return { status: data.status || "Unknown", longId: data.longId };
    } catch (err) {
      console.error("Failed to fetch invoice status", err);
      return { status: "Error", longId: undefined };
    }
};

export const cancelInvoice = async (uuid: string, reason: string = 'Wrong data') => {
    try {
        const accessToken = await getAuthToken();
        const urls = getBaseUrls();

        const res = await fetch(`${urls.api}/api/v1/documents/state/${uuid}/state`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: 'cancelled', reason })
        });

        if (!res.ok) {
            throw new Error(`ETA cancel invoice failed: ${res.status}`);
        }

        return true;
      } catch (err) {
        console.error("Failed to cancel invoice", err);
        return false;
      }
};
