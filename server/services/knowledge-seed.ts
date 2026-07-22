/**
 * Liberty Bancard Knowledge Base — Seed Content
 *
 * Seeds the knowledge_sources table with authoritative Liberty Bancard content
 * on first startup (idempotent — skips if sources already exist).
 * Triggers indexing for all new sources if OpenAI is configured.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { createKnowledgeSource, publishSource, indexSource } from "./knowledge-base";

const SEED_SOURCES: Array<{
  title: string;
  audience: string;
  content: string;
}> = [
  {
    title: "About Liberty Bancard",
    audience: "public",
    content: `Liberty Bancard is a full-service merchant payment processing company dedicated to helping small and medium-sized businesses save money on credit card processing fees. We specialize in transparent, fair pricing — including our flagship 0% processing program — and we are committed to providing exceptional customer service with no long-term contracts.

Our mission is simple: help merchants keep more of every dollar they earn. We serve thousands of businesses across Florida and nationwide, supporting verticals including retail, restaurants, healthcare, hospitality, professional services, legal, and more.

Liberty Bancard is headquartered in Florida. Our team includes dedicated sales representatives, onboarding specialists, compliance officers, and 24/7 technical support staff.

Contact information:
- General inquiries: info@libertybancard.com
- Support: support@libertybancard.com
- Sales: sales@libertybancard.com
- Website: libertybancard.com`,
  },
  {
    title: "0% Processing Program — How It Works",
    audience: "public",
    content: `Liberty Bancard's 0% Processing Program allows eligible merchants to pass credit card processing fees to customers through a small service fee or cash discount program. This legally compliant approach means the merchant pays $0 in processing fees on credit card transactions.

How the 0% program works:
- A small service fee (typically 3–4%) is added to credit card transactions, or
- A cash discount is offered to customers who pay with cash
- Card brand rules (Visa, Mastercard, American Express, Discover) require specific disclosures at the point of sale
- Signage must be posted at the business informing customers of the fee or discount

Important: Eligibility, specific fee percentages, card brand rules, and applicable state laws apply. No savings claim is guaranteed without a full statement review. This program is not suitable for all business types. Ask your Liberty Bancard representative for details specific to your business.

Benefits for merchants:
- Eliminate or drastically reduce monthly processing costs
- Keep more of every sale
- Simple pricing — no tiered or interchange-plus complexity`,
  },
  {
    title: "Next-Day Funding",
    audience: "public",
    content: `Liberty Bancard offers next-business-day funding for eligible merchants. This means your credit card sales batch settled today are deposited into your bank account by the next business day.

Key details:
- Next-day funding is available for most merchant account types
- Requires a qualifying bank account (most major U.S. banks supported)
- Batch must be closed by the daily cutoff time (typically 10 PM ET; confirm with your rep)
- Weekends and banking holidays may delay by one business day
- ACH transfer timing may vary by bank

Important: Actual funding timelines depend on underwriting review, risk profile, and your specific merchant account terms. Guaranteed funding timelines are not promised without a full account review. Ask your Liberty Bancard representative for details.`,
  },
  {
    title: "Getting Started — Merchant Application Process",
    audience: "public",
    content: `Starting with Liberty Bancard is simple. Here is the typical process:

Step 1 — Statement Upload or Sales Call
Upload your most recent processing statement (3 months preferred) at libertybancard.com/statement-upload, or schedule a free 10-minute call with a Liberty Bancard representative. This allows us to analyze your current fees and provide a personalized savings estimate.

Step 2 — Proposal Review
We analyze your statement and prepare a custom pricing proposal showing potential savings. No commitment is required.

Step 3 — Application
Submit your merchant application. Required documents typically include:
- Government-issued photo ID (owner/principal)
- Business bank account information (voided check or bank letter)
- 3 months of most recent processing statements (if switching providers)
- Business license or formation documents (may be required by vertical)
- Social Security Number (SSN) or EIN for the principal signer

Step 4 — Underwriting Review
Our underwriting team reviews your application. This typically takes 1–3 business days for standard accounts.

Step 5 — Approval & Setup
Upon approval, we set up your merchant account, configure your terminal or payment gateway, and assign you a dedicated onboarding specialist.

Step 6 — Go Live
Your Liberty Bancard representative walks you through your first batch and ensures everything is working correctly.

Note: Application approval is subject to underwriting review. Not all businesses are eligible for all programs. Contact a representative for details.`,
  },
  {
    title: "Pricing and Fees — Overview",
    audience: "public",
    content: `Liberty Bancard offers transparent, competitive pricing with no hidden fees. Our pricing options include:

1. 0% Processing (Cash Discount / Service Fee Program)
   - Merchant pays $0 in processing fees
   - Customers pay a small service fee on card transactions (typically 3–4%)
   - Requires proper signage and disclosures
   - Eligible for most business types

2. Flat-Rate Pricing
   - One simple rate applied to all card types
   - Predictable monthly costs
   - Best for businesses with lower volume or complex card mixes

3. Interchange-Plus Pricing
   - Cost of interchange (set by card brands) plus a small markup
   - Most transparent pricing model
   - Best for higher-volume merchants

4. Tiered Pricing (legacy — we often help merchants move away from this)
   - Qualified, mid-qualified, and non-qualified tiers
   - Can be more expensive; contact us to compare

Common fees explained:
- Monthly service fee: covers account maintenance, reporting, and support
- PCI compliance fee: covers your annual PCI DSS certification support
- Statement fee: covers monthly statement generation
- Batch fee: per-batch settlement fee (some programs)
- Chargeback fee: if a card dispute is filed against you

There are NO long-term contracts. Month-to-month agreements available. Cancel anytime.

Important: Exact rates and fees depend on your business type, volume, risk profile, and program selected. No guaranteed rate is offered without a statement review. Contact your Liberty Bancard representative for a personalized quote.`,
  },
  {
    title: "Statement Analysis — How We Review Your Processing Costs",
    audience: "public",
    content: `Liberty Bancard's Statement Analysis service is free and no-obligation. Here is what we do:

1. You upload your 2–3 most recent processing statements (or provide them to your representative)
2. Our team — assisted by AI analysis tools — reviews your current effective rate, fee structure, card mix, volume, and any hidden fees
3. We prepare a customized savings estimate comparing your current costs to what you would pay with Liberty Bancard
4. A Liberty Bancard representative reviews the analysis with you on a call

What we look for:
- High effective processing rate (industry average is 2.5–3.5%; many merchants pay more)
- Non-qualified surcharges on common card types
- PCI non-compliance fees (penalties for not completing annual PCI certification)
- Multiple monthly fees that can be consolidated
- Equipment leases that may be overpriced vs. purchasing outright

Your savings estimate is based on your actual volume and fee data. Results vary. No guaranteed savings without an approved merchant account and live processing data.

To upload your statement: libertybancard.com/statement-upload`,
  },
  {
    title: "Supported Payment Methods and Equipment",
    audience: "public",
    content: `Liberty Bancard supports all major payment methods and a wide range of terminal and gateway options.

Accepted card brands:
- Visa, Mastercard, American Express, Discover
- Contactless payments (NFC/tap-to-pay)
- Apple Pay, Google Pay, Samsung Pay

Terminal options:
- Countertop terminals (standalone, receipt printer)
- Wireless / mobile terminals (for businesses on the go)
- PIN pad terminals (for debit acceptance)
- Smart terminals with touchscreen display
- Self-service kiosk options (select programs)

Payment gateway options (for e-commerce / card-not-present):
- Virtual terminal (browser-based)
- Hosted payment page
- API integration for custom e-commerce platforms
- Compatible with major shopping carts (WooCommerce, Shopify, etc.)

Equipment pricing:
- Purchase or lease options available
- Some programs include free terminal placement (conditions apply)
- Terminal reprogramming may be available for compatible existing equipment

Contact your Liberty Bancard representative to discuss the best equipment option for your business type and volume.`,
  },
  {
    title: "Supported Business Verticals",
    audience: "public",
    content: `Liberty Bancard serves businesses across a wide range of industries. Our team includes specialists familiar with the unique compliance, chargeback, and processing needs of each vertical.

Retail:
- General retail stores, boutiques, gift shops
- Quick setup, 0% program often ideal

Restaurants and Food Service:
- Full-service restaurants, QSR, cafes, food trucks
- Tip adjustment, split payments, high-volume support

Healthcare and Medical:
- Medical offices, dental, chiropractic, physical therapy
- HIPAA-aware operations, recurring billing options

Hospitality:
- Hotels, motels, vacation rentals
- Card-on-file, lodging addendum required for card brand compliance

Professional Services:
- Law firms, CPAs, consultants, staffing
- IOLTA account considerations for legal (funds handling compliance required)
- Recurring billing and invoice payment options

Automotive:
- Auto repair, dealerships, car washes
- Parts and service billing

Health and Beauty:
- Salons, spas, barbershops
- Tip adjustment, appointment-based billing

Home Services:
- Contractors, landscaping, cleaning, HVAC
- Mobile/wireless terminal options

E-commerce:
- Online retailers, subscription businesses
- Gateway integration, fraud tools

High-risk verticals:
- Liberty Bancard does not process for all high-risk categories
- Contact us to discuss eligibility

Contact your Liberty Bancard representative to discuss whether your specific business type is eligible and for any vertical-specific compliance requirements.`,
  },
  {
    title: "Chargebacks — What They Are and How to Prevent Them",
    audience: "public",
    content: `A chargeback occurs when a cardholder disputes a transaction with their bank and the bank reverses the charge. Chargebacks can result in loss of the transaction amount plus a chargeback fee.

Common chargeback reasons:
- Customer claims they didn't authorize the transaction (fraud)
- Customer claims goods or services were not received
- Customer claims goods were not as described
- Duplicate transaction
- Processing errors

How to prevent chargebacks:
1. Get a signed receipt or authorization for every transaction
2. Use chip-and-PIN (EMV) terminals — significantly reduces fraud chargebacks
3. Have a clear, written refund and cancellation policy
4. Respond to customer complaints promptly — refund when appropriate before they dispute
5. Use clear billing descriptors so customers recognize your charge on their statement
6. For e-commerce: use Address Verification (AVS) and CVV checks
7. Keep records of all transactions, authorizations, and delivery confirmations

What to do if you receive a chargeback:
1. Do not ignore it — you have a limited time window to respond (typically 30–45 days)
2. Gather evidence: signed receipt, authorization, delivery confirmation, customer correspondence
3. Submit a chargeback rebuttal letter with evidence through your Liberty Bancard portal
4. Liberty Bancard's support team can assist with the dispute process

A high chargeback ratio (above 1%) may result in account review or termination by card brands. Contact support if you have a pattern of chargebacks — we can help identify the cause.`,
  },
  {
    title: "PCI Compliance — What Merchants Need to Know",
    audience: "public",
    content: `PCI DSS (Payment Card Industry Data Security Standard) is a set of security standards required by all card brands to protect cardholder data. All businesses that accept credit cards must be PCI compliant.

Liberty Bancard supports merchant PCI compliance through:
- Annual PCI compliance questionnaire (SAQ) assistance
- Guidance on which Self-Assessment Questionnaire (SAQ) type applies to your business
- Quarterly vulnerability scanning support (where required)
- Resources and education on PCI requirements

Key PCI compliance facts:
- Merchants are categorized into Levels 1–4 based on annual transaction volume
- Most small businesses fall under Level 4 (fewer than 20,000 e-commerce or 1 million non-e-commerce transactions per year)
- Level 4 merchants must complete an annual SAQ and may need quarterly network scans
- Non-compliance can result in monthly non-compliance fees on your processing statement
- PCI DSS does NOT mean your business is certified by a third party — it means you have self-assessed and are following the required security practices

Important rules:
- NEVER store full card numbers (PAN), CVV/CVV2 codes, or magnetic stripe data after authorization
- Do not write down or email full card numbers
- Use only PCI-approved payment terminals and gateways

For PCI compliance support, contact your Liberty Bancard representative or visit our compliance resources.`,
  },
  {
    title: "Merchant Support — How to Get Help",
    audience: "public",
    content: `Liberty Bancard provides multiple channels for merchant support.

Technical Support (terminal, gateway, payment issues):
- Email: support@libertybancard.com
- Available Monday–Friday, 9 AM–6 PM ET (emergency after-hours support may be available)

Account and Billing Questions:
- Email: accounts@libertybancard.com
- For questions about your monthly statement, fees, or account changes

Sales and New Accounts:
- Email: sales@libertybancard.com
- Schedule a call at libertybancard.com

Compliance and Regulatory Questions:
- Email: compliance@libertybancard.com
- For questions about PCI, card brand rules, or regulatory requirements

Chargeback Disputes:
- Log in to your Liberty Bancard merchant portal to submit evidence
- Or contact support@libertybancard.com with your chargeback reference number

Merchant Portal:
- Access your statements, transaction history, and account settings at your Liberty Bancard merchant portal
- Contact support for portal login assistance

Our AI assistant can answer general questions about our products and services. For account-specific issues, disputed charges, or sensitive matters, please contact our support team directly.`,
  },
  {
    title: "ISO and Partner Program",
    audience: "public",
    content: `Liberty Bancard's ISO and Partner Program is designed for independent sales organizations, CPAs, bookkeepers, consultants, and other professionals who want to earn residual income by referring merchants.

Program highlights:
- Earn ongoing residual commissions on every transaction your referred merchants process
- Tiered commission structure — higher volume equals higher percentage
- Co-branded marketing materials and sales enablement tools
- Dedicated partner support and training
- White-label and co-branded proposal options (select tiers)
- Online partner portal with real-time reporting on your referred merchants

Who is eligible:
- ISOs (Independent Sales Organizations)
- CPAs and accounting firms
- Business consultants and advisors
- Financial advisors and insurance brokers
- Marketing agencies and web developers who serve local businesses

To apply, visit libertybancard.com/partners or email partners@libertybancard.com.

Commission terms, qualification criteria, and payout schedules are outlined in the partner agreement. Contact your Liberty Bancard partner manager for current commission tiers.`,
  },
  {
    title: "Frequently Asked Questions — General",
    audience: "public",
    content: `Q: How long does it take to get approved for a merchant account?
A: Standard accounts are typically approved within 1–3 business days. Some business types with higher risk profiles may require additional review. Same-day approvals are sometimes available — ask your representative.

Q: Is there a long-term contract?
A: No. Liberty Bancard offers month-to-month agreements. There is no early termination fee on standard accounts.

Q: Can I keep my current terminal?
A: Possibly. If your terminal is compatible and not under a lease with another provider, we may be able to reprogram it. Ask your representative.

Q: What if I already have a processor?
A: We can analyze your current statement and show you a side-by-side comparison. If you switch, we'll help with the transition including any statement credits for cancellation fees (subject to eligibility).

Q: Do you support online payments?
A: Yes. We offer payment gateways for e-commerce, virtual terminals for phone orders, and hosted payment pages.

Q: What is the minimum monthly volume to work with Liberty Bancard?
A: We work with businesses of all sizes. There is no minimum required volume for most programs.

Q: What bank do you use for merchant accounts?
A: We partner with multiple acquiring banks. Your representative will advise on the best banking relationship for your business type.

Q: Is my information secure?
A: Yes. All applications use encrypted transmission. We follow strict data security standards and never store full card numbers.

Q: How do I contact someone at Liberty Bancard?
A: Email sales@libertybancard.com, support@libertybancard.com, or visit libertybancard.com.`,
  },
  {
    title: "Compliance Notice and Disclaimers",
    audience: "public",
    content: `Important Legal and Compliance Notice:

The information provided by the Liberty Bancard AI Assistant is for general informational purposes only and is grounded in Liberty Bancard's approved content. It does not constitute legal, financial, tax, or professional advice.

1. No Savings Guarantee: Any savings estimate is based on provided statement data and is not a guarantee of future savings. Actual results depend on card mix, volume, chargeback ratios, underwriting review, and other factors.

2. No Approval Guarantee: Application approval is subject to underwriting review by our acquiring bank partners. Liberty Bancard does not guarantee approval for any specific merchant.

3. No Rate Guarantee: Rates and fees are subject to underwriting and may change based on risk profile. Exact pricing is confirmed in your merchant agreement.

4. Card Brand Rules: All programs must comply with Visa, Mastercard, American Express, and Discover operating regulations. Rules may change. Merchants are responsible for complying with applicable card brand rules.

5. State Laws: Certain programs (including cash discount and service fee programs) are subject to state laws and regulations. Consult a qualified attorney in your state.

6. PCI DSS: PCI compliance is the merchant's responsibility. Liberty Bancard provides support resources but does not guarantee compliance outcomes.

7. Legal and Tax Advice: Nothing provided by the Liberty Bancard AI Assistant constitutes legal or tax advice. Always consult a qualified attorney or CPA.

Liberty Bancard · info@libertybancard.com · libertybancard.com`,
  },
  {
    title: "Merchant Onboarding — First 30 Days Guide",
    audience: "merchant",
    content: `Welcome to Liberty Bancard! Here is what to expect in your first 30 days as a merchant.

Day 1 — Account Setup:
- Your merchant account is active and your MID (Merchant ID) has been assigned
- Your terminal has been shipped, programmed, or your gateway credentials have been sent
- Your onboarding specialist will walk you through your first transaction
- Log in to your merchant portal to verify your account details

Days 1–7 — Go-Live Checklist:
□ Run a test transaction and verify the funds deposit in your bank account
□ Verify your business name appears correctly on customer card statements (billing descriptor)
□ Post required PCI and 0% program signage (if applicable)
□ Complete your PCI Self-Assessment Questionnaire (your specialist will guide you)
□ Review your first batch settlement report
□ Set up your preferred reporting and notification preferences in the merchant portal

Days 7–14 — First Statement:
- Your first processing statement will be available in your portal
- Review: transaction count, settled volume, fees applied, effective rate
- Contact accounts@libertybancard.com with any billing questions

Days 14–30 — Optimization:
- Your onboarding specialist will check in to answer questions
- Discuss any chargeback prevention strategies relevant to your business type
- Explore advanced features: recurring billing, tip adjustment, virtual terminal

First 30-day support: Your dedicated onboarding specialist is available for questions. Email support@libertybancard.com or contact your representative directly.`,
  },
  {
    title: "Merchant Portal — How to Use Your Account Dashboard",
    audience: "merchant",
    content: `Your Liberty Bancard merchant portal gives you 24/7 access to your account. Here is what you can do:

Transactions:
- View all transactions in real time
- Filter by date, card type, amount, or status
- Download transaction reports (CSV or PDF)
- Search for specific transactions by authorization code

Batches and Settlements:
- View daily batch reports
- Track settlement status (pending, settled, funded)
- Verify deposit amounts match your bank records

Statements:
- Access and download monthly processing statements (PDF)
- Review fee breakdowns by category
- Compare month-over-month

Chargebacks:
- View open chargeback disputes
- Upload evidence for rebuttal
- Track dispute status and deadlines

Account Settings:
- Update business contact information (requires verification)
- Manage user access (for multi-user accounts)
- View your MID and gateway credentials

PCI Compliance:
- Access your annual SAQ questionnaire
- Track compliance status
- Download your compliance certificate

Support:
- Submit a support ticket
- Access contact information for your account team

Login to your portal: Visit libertybancard.com and click "Merchant Login," or use the link provided in your welcome email. For login issues, contact support@libertybancard.com.`,
  },
];

export async function seedKnowledgeBase(): Promise<void> {
  // Check if already seeded
  const { rows } = await db.execute(sql`
    SELECT COUNT(*)::int as count FROM knowledge_sources
  `);
  const count = (rows[0] as any).count;
  if (count > 0) {
    console.log(`[KB Seed] ${count} knowledge source(s) already exist — skipping seed.`);
    return;
  }

  console.log("[KB Seed] Seeding Liberty Bancard knowledge base...");
  const openaiAvailable = !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  for (const seed of SEED_SOURCES) {
    try {
      const source = await createKnowledgeSource({
        title: seed.title,
        sourceType: "text_block",
        status: "draft",
        audience: seed.audience,
        content: seed.content,
        metadata: { seeded: true, seedVersion: "1.0" },
      });

      await publishSource(source.id);

      if (openaiAvailable) {
        await indexSource(source.id);
        console.log(`[KB Seed] ✓ Indexed: ${seed.title}`);
      } else {
        console.log(`[KB Seed] ✓ Created (not indexed — OpenAI not configured): ${seed.title}`);
      }
    } catch (e: any) {
      console.error(`[KB Seed] ✗ Failed: ${seed.title} — ${e.message}`);
    }
  }

  console.log("[KB Seed] Done.");
}
