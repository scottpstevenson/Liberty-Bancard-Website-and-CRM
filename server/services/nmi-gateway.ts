import https from "https";
import querystring from "querystring";

export interface ChargeRequest {
  amount: string;
  cardNumber: string;
  expMonth: string;
  expYear: string;
  cvv: string;
  cardholderName: string;
  billingZip: string;
  memo?: string;
  orderId?: string;
}

export interface RefundRequest {
  gatewayTransactionId: string;
  amount: string;
}

export interface GatewayChargeResult {
  success: boolean;
  approved: boolean;
  gatewayTransactionId?: string;
  authCode?: string;
  responseCode?: string;
  responseText?: string;
  rawResponse?: Record<string, string>;
  sandboxMode?: boolean;
}

export interface GatewayRefundResult {
  success: boolean;
  gatewayTransactionId?: string;
  responseCode?: string;
  responseText?: string;
  rawResponse?: Record<string, string>;
  sandboxMode?: boolean;
}

function parseNmiResponse(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  raw.split("&").forEach((pair) => {
    const [key, value] = pair.split("=");
    if (key) result[decodeURIComponent(key)] = decodeURIComponent(value || "");
  });
  return result;
}

function postToNmi(params: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify(params);
    const options = {
      hostname: "secure.nmi.com",
      path: "/api/transact.php",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function sandboxCharge(amount: string): GatewayChargeResult {
  const last4 = Math.floor(1000 + Math.random() * 9000).toString();
  const txId = `SANDBOX-${Date.now()}-${last4}`;
  const authCode = `AUTH${Math.floor(100000 + Math.random() * 900000)}`;
  return {
    success: true,
    approved: true,
    gatewayTransactionId: txId,
    authCode,
    responseCode: "100",
    responseText: "SUCCESS (Sandbox Mode — no real charge)",
    sandboxMode: true,
    rawResponse: {
      response: "1",
      responsetext: "SUCCESS",
      authcode: authCode,
      transactionid: txId,
      avsresponse: "N",
      cvvresponse: "M",
      orderid: "",
      type: "sale",
      response_code: "100",
    },
  };
}

function sandboxRefund(): GatewayRefundResult {
  const txId = `SANDBOX-REFUND-${Date.now()}`;
  return {
    success: true,
    gatewayTransactionId: txId,
    responseCode: "100",
    responseText: "SUCCESS (Sandbox Mode — no real refund)",
    sandboxMode: true,
    rawResponse: { response: "1", responsetext: "SUCCESS", transactionid: txId },
  };
}

function declineReason(code: string, text: string): string {
  const reasons: Record<string, string> = {
    "200": "Do Not Honor — the card-issuing bank declined this transaction. Ask the cardholder to use a different card or contact their bank.",
    "201": "Insufficient Funds — the card does not have enough credit available.",
    "202": "Decline — CVV2/CID failure. The security code entered does not match.",
    "203": "Card Type Not Enabled — the card type is not accepted.",
    "204": "Invalid Amount — the transaction amount is invalid.",
    "210": "Expired Card — the card has expired.",
    "211": "Invalid Track Data — swipe data was not read correctly.",
    "220": "Decline — contact your issuing bank for more information.",
    "221": "No Such Issuer — card number prefix does not match any known issuer.",
    "222": "Account Not Found — the card account could not be found.",
    "223": "Do Not Honor — transaction declined without specific reason.",
    "224": "Invalid CVV — the security code is incorrect.",
    "225": "Invalid Security Code — the security code format is invalid.",
    "240": "Call Issuer — call the number on the back of the card for authorization.",
    "250": "Pick Up Card — the card issuer has flagged this card.",
    "300": "Transaction Error — a processing error occurred. Please try again.",
    "400": "Transaction Not Found — the original transaction could not be located.",
    "410": "Invalid Merchant — the merchant account is not configured for this transaction type.",
    "411": "Merchant Account Not Found — verify merchant credentials.",
    "412": "Invalid Login — gateway credentials are incorrect.",
    "421": "Invalid Routing Number — ACH routing number is invalid.",
    "430": "Result Error — a result was expected but not received.",
    "440": "Communication Error — unable to reach the card-issuing bank.",
    "441": "Communication Error — SSL connection failed.",
    "460": "Declined — AVS failure. The billing ZIP code does not match.",
    "461": "Declined — CVV failure. The security code does not match records.",
  };
  return reasons[code] || text || `Declined with code ${code}. Please contact the card issuer.`;
}

export async function chargeCard(req: ChargeRequest): Promise<GatewayChargeResult> {
  const securityKey = process.env.NMI_SECURITY_KEY;
  if (!securityKey) {
    console.warn("[NMI Gateway] NMI_SECURITY_KEY not set — running in sandbox mode");
    return sandboxCharge(req.amount);
  }

  const params: Record<string, string> = {
    security_key: securityKey,
    type: "sale",
    amount: req.amount,
    ccnumber: req.cardNumber.replace(/\s/g, ""),
    ccexp: `${req.expMonth}${req.expYear.slice(-2)}`,
    cvv: req.cvv,
    firstname: req.cardholderName.split(" ")[0] || req.cardholderName,
    lastname: req.cardholderName.split(" ").slice(1).join(" ") || "",
    zip: req.billingZip,
    orderid: req.orderId || `VT-${Date.now()}`,
    order_description: req.memo || "Virtual Terminal Charge",
  };

  try {
    const raw = await postToNmi(params);
    const parsed = parseNmiResponse(raw);

    const approved = parsed.response === "1";
    const responseCode = parsed.response_code || "";
    const responseText = approved
      ? parsed.responsetext || "Approved"
      : declineReason(responseCode, parsed.responsetext || "");

    return {
      success: true,
      approved,
      gatewayTransactionId: parsed.transactionid,
      authCode: parsed.authcode,
      responseCode,
      responseText,
      rawResponse: parsed,
    };
  } catch (err: any) {
    return {
      success: false,
      approved: false,
      responseText: `Gateway communication error: ${err.message}`,
    };
  }
}

export async function refundTransaction(req: RefundRequest): Promise<GatewayRefundResult> {
  const securityKey = process.env.NMI_SECURITY_KEY;
  if (!securityKey) {
    console.warn("[NMI Gateway] NMI_SECURITY_KEY not set — running in sandbox mode");
    return sandboxRefund();
  }

  const params: Record<string, string> = {
    security_key: securityKey,
    type: "refund",
    transactionid: req.gatewayTransactionId,
    amount: req.amount,
  };

  try {
    const raw = await postToNmi(params);
    const parsed = parseNmiResponse(raw);

    const approved = parsed.response === "1";
    const responseCode = parsed.response_code || "";
    const responseText = approved
      ? parsed.responsetext || "Refund Approved"
      : declineReason(responseCode, parsed.responsetext || "Refund failed");

    return {
      success: true,
      gatewayTransactionId: parsed.transactionid,
      responseCode,
      responseText,
      rawResponse: parsed,
    };
  } catch (err: any) {
    return {
      success: false,
      responseText: `Gateway communication error: ${err.message}`,
    };
  }
}
