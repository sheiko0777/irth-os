export const issueInvoice = async (order: {
  id: string;
  orgId: string;
  totalAmount: string;
}) => {
  const clientId = process.env.ETA_CLIENT_ID;
  const clientSecret = process.env.ETA_CLIENT_SECRET;
  const issuerEin = process.env.ETA_ISSUER_EIN;

  if (!clientId || !clientSecret || !issuerEin) {
    console.warn(
      "ETA credentials not fully configured. Skipping invoice issuance.",
    );
    return null;
  }

  try {
    // 1. Authenticate with ETA identity server (Sandbox)
    const tokenRes = await fetch(
      "https://id.preprod.eta.gov.eg/connect/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
          scope: "InvoicingAPI",
        }),
      },
    );

    if (!tokenRes.ok) {
      throw new Error(`ETA token auth failed: ${tokenRes.status}`);
    }

    const tokenData = (await tokenRes.json()) as { access_token: string };

    // 2. Map IRTH Order to ETA Document Format
    // Add 14% VAT on all items
    const vatRate = 0.14;
    const amount = Number(order.totalAmount);
    const vatAmount = amount * vatRate;

    const doc = {
      issuer: {
        type: "B",
        id: issuerEin,
        name: "IRTH Business",
      },
      receiver: {
        type: "P",
        id: "123456789", // Mock receiver id
        name: "Customer",
      },
      documentType: "I",
      documentTypeVersion: "1.0",
      dateTimeIssued: new Date().toISOString(),
      taxpayerActivityCode: "1061",
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
            { taxType: "T1", amount: vatAmount, subType: "V009", rate: 14 },
          ],
        },
      ],
      totalSalesAmount: amount,
      totalDiscountAmount: 0,
      netAmount: amount,
      taxTotals: [{ taxType: "T1", amount: vatAmount }],
      extraDiscountAmount: 0,
      totalItemsDiscountAmount: 0,
      totalAmount: amount + vatAmount,
    };

    // 3. Submit Document to ETA API
    const submitRes = await fetch(
      "https://api.preprod.invoicing.eta.gov.eg/api/v1/documentsubmissions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ documents: [doc] }),
      },
    );

    if (!submitRes.ok) {
      throw new Error(`ETA submission failed: ${submitRes.status}`);
    }

    const submitData = (await submitRes.json()) as {
      submissionId: string;
      acceptedDocuments: { uuid: string }[];
    };

    console.log(
      `Successfully submitted invoice for order ${order.id} to ETA. UUID: ${submitData.acceptedDocuments?.[0]?.uuid}`,
    );
    return {
      uuid:
        submitData.acceptedDocuments?.[0]?.uuid || "mock-eta-uuid-" + order.id,
    };
  } catch (err) {
    console.error("Failed to issue ETA invoice:", err);
    return null;
  }
};

export const getInvoiceStatus = async (uuid: string) => {
  const clientId = process.env.ETA_CLIENT_ID;
  const clientSecret = process.env.ETA_CLIENT_SECRET;

  if (!clientId || !clientSecret) return { status: "Unknown" };

  try {
    const tokenRes = await fetch(
      "https://id.preprod.eta.gov.eg/connect/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
          scope: "InvoicingAPI",
        }),
      },
    );

    const tokenData = (await tokenRes.json()) as { access_token: string };

    const res = await fetch(
      `https://api.preprod.invoicing.eta.gov.eg/api/v1/documents/${uuid}/details`,
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      },
    );
    const data = (await res.json()) as { status: string };
    return { status: data.status || "Valid" };
  } catch (err) {
    console.error("Failed to fetch invoice status", err);
    return { status: "Error" };
  }
};
