import { storage } from "../storage";

interface SequenceSeed {
  name: string;
  description: string;
  triggerType: string;
  triggerConfig: Record<string, any>;
  steps: Array<{
    stepOrder: number;
    actionType: string;
    delayDays: number;
    delayHours: number;
    subject?: string;
    body?: string;
    config?: Record<string, any>;
  }>;
}

const SALES_CALENDAR = process.env.SALES_CALENDAR_URL || "https://api.leadconnectorhq.com/widget/bookings/libertybancard";
const AM_CALENDAR = process.env.AM_CALENDAR_URL || "https://api.leadconnectorhq.com/widget/booking/kBRoNz5XoTpddupMQg0c";

const COMPLIANCE_FOOTER = `<p style="font-size:11px;color:#888;margin-top:24px;">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>`;

function emailBody(paragraphs: string[]): string {
  return paragraphs.join("") + COMPLIANCE_FOOTER;
}

function smsBody(text: string): string {
  return text.trim();
}

const VERTICAL_SEQUENCES: SequenceSeed[] = [
  // ═══════════════════════════════════════════════════════
  // RETAIL VERTICAL
  // ═══════════════════════════════════════════════════════

  // Retail SDR Outbound
  {
    name: "V-Retail: SDR Outbound Prospecting",
    description: "Cold outreach sequence for retail store prospects. Targets brick-and-mortar shops, boutiques, convenience stores.",
    triggerType: "manual",
    triggerConfig: { category: "sdr", vertical: "retail" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Quick question about your payment setup",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>I came across {{companyName}} and wanted to reach out. Most retail stores we talk to are paying way more than they need to on card processing — especially on in-store transactions.</p>`,
          `<p>We work with hundreds of retail businesses across Florida and consistently help them reduce processing costs by structuring their pricing around actual interchange rates instead of bundled markups.</p>`,
          `<p>Would it be worth a quick 10-minute call to see if your current setup is costing you more than it should?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book a Quick Call</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 1,
        delayHours: 0,
        body: smsBody(`Hi {{firstName}}, this is Liberty Bancard. We help retail stores like {{companyName}} cut processing fees. Worth a quick chat? {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "The #1 mistake retail stores make with payment processing",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>The biggest mistake we see retail merchants make? Staying on a flat-rate or tiered pricing plan without ever seeing a line-by-line breakdown.</p>`,
          `<p>Here's what that usually means:</p>`,
          `<ul><li>You're paying the same rate on debit cards as credit cards (debit should be much cheaper)</li><li>Tap-to-pay and chip transactions get lumped into higher rate tiers</li><li>Monthly fees pile up without any clear explanation</li></ul>`,
          `<p>We can show you exactly what you're paying vs. what you should be paying — takes about 10 minutes with your last statement.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Your Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 7,
        delayHours: 0,
        subject: "How {{companyName}} could save on every swipe",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Just following up — wanted to share what we typically find when reviewing retail statements:</p>`,
          `<ul><li>Average savings: 15-30% on monthly processing costs</li><li>Better debit routing that immediately lowers fees</li><li>Next-day funding so your cash flow isn't held up</li><li>Modern POS terminals with built-in tip and receipt options</li></ul>`,
          `<p>No long-term contracts. No hidden fees. Just transparent pricing.</p>`,
          `<p>If you're curious, I'm happy to do a free side-by-side comparison.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule a Review</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 10,
        delayHours: 0,
        body: smsBody(`{{firstName}}, last check-in. We've helped a lot of retail businesses save on processing. Happy to do a free statement review if interested. No pressure either way.\n— Liberty Bancard`),
      },
    ],
  },

  // Retail Inbound Drip
  {
    name: "V-Retail: Inbound Lead Nurture",
    description: "Nurture sequence for retail leads who submitted a form or requested info. Educates on retail-specific benefits.",
    triggerType: "form_submission",
    triggerConfig: { category: "inbound", vertical: "retail" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Thanks for reaching out — here's what happens next",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Thanks for connecting with Liberty Bancard. We specialize in helping retail businesses like yours get the best possible pricing on card processing.</p>`,
          `<p>Here's what to expect:</p>`,
          `<ol><li>We'll review your current processing setup (if you send us a statement)</li><li>We'll show you a clear comparison — what you're paying now vs. what you could be paying</li><li>You decide if it makes sense to switch — no pressure</li></ol>`,
          `<p>In the meantime, feel free to upload a recent statement so we can get started:</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 2,
        delayHours: 0,
        subject: "What retail merchants should know about interchange",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Did you know that the actual cost of processing a debit card transaction is usually under 0.5%? But many processors charge retail stores 2-3% on those same transactions.</p>`,
          `<p>That gap is pure markup — and it adds up fast when you're processing thousands of transactions a month.</p>`,
          `<p>At Liberty Bancard, we pass through the actual interchange rate and add a small, transparent margin. No bundled rates, no surprises.</p>`,
          `<p>Want to see what that would look like for {{companyName}}?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get Your Custom Quote</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 5,
        delayHours: 0,
        subject: "POS terminals that actually work for retail",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Beyond pricing, the right terminal setup can make a big difference in your day-to-day operations:</p>`,
          `<ul><li>Contactless/NFC for fast checkout lines</li><li>Built-in tip adjustment for counter service</li><li>Digital receipts to save on paper</li><li>Inventory tracking and reporting</li><li>Next-day deposits into your bank account</li></ul>`,
          `<p>We provide modern terminals at no upfront cost when you process with us — and we handle all the setup.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">See Terminal Options</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "sms",
        delayDays: 7,
        delayHours: 0,
        body: smsBody(`Hi {{firstName}}, just checking in from Liberty Bancard. Still interested in getting a statement review? Happy to help anytime. {{custom_values.booking_link}}`),
      },
    ],
  },

  // Retail Operations
  {
    name: "V-Retail: Account Management Ops",
    description: "Operational emails for existing retail merchant clients. Covers annual reviews, terminal upgrades, and seasonal tips.",
    triggerType: "manual",
    triggerConfig: { category: "operations", vertical: "retail" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Your annual processing review is ready",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>It's been a while since we last reviewed your processing rates. Interchange rates change twice a year, and we want to make sure your pricing is still optimized.</p>`,
          `<p>Your account manager will:</p>`,
          `<ul><li>Review your latest statements against current interchange tables</li><li>Identify any new savings opportunities</li><li>Check if your terminal firmware is up to date</li><li>Ensure your PCI compliance is current</li></ul>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule Your Review</a></p>`,
          `<p>— Liberty Bancard Account Management</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 30,
        delayHours: 0,
        subject: "Holiday season prep — is your payment setup ready?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Peak retail season is coming up. Here's a quick checklist to make sure your payment processing is ready:</p>`,
          `<ul><li>Test all terminals and backup devices</li><li>Ensure contactless payments are enabled</li><li>Verify your batch settlement time (aim for next-day funding)</li><li>Check that your chargeback protection is active</li><li>Update any POS software to the latest version</li></ul>`,
          `<p>Need help with any of these? Your account manager is here to help.</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Contact Your AM</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // AUTO VERTICAL
  // ═══════════════════════════════════════════════════════

  // Auto SDR Outbound
  {
    name: "V-Auto: SDR Outbound Prospecting",
    description: "Cold outreach for auto repair shops, dealerships, body shops, and tire/oil change businesses.",
    triggerType: "manual",
    triggerConfig: { category: "sdr", vertical: "auto" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Auto shops are overpaying on card processing — are you?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>I work with auto repair shops and service centers across Florida, and most of them were overpaying on processing before they switched to us.</p>`,
          `<p>The issue? Most processors charge flat rates that don't account for the mix of debit, credit, and high-ticket transactions that auto businesses process daily.</p>`,
          `<p>We structure pricing around your actual transaction mix — which usually means significant savings on repair invoices, parts purchases, and fleet cards.</p>`,
          `<p>Want to see what your numbers look like?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get a Free Analysis</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 1,
        delayHours: 0,
        body: smsBody(`Hi {{firstName}}, Liberty Bancard here. We specialize in payment processing for auto shops. Most of our clients save 15-25% vs. their old processor. Quick call? {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 4,
        delayHours: 0,
        subject: "Why auto shops lose money on fleet and corporate cards",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>If your shop accepts fleet cards, corporate cards, or high-ticket payments over $500, you're likely paying more than you need to.</p>`,
          `<p>Here's why: Fleet cards (like WEX, Voyager, Fuelman) have special interchange rates, but most processors lump them into a generic "qualified" tier that costs you more.</p>`,
          `<p>At Liberty Bancard, we route these transactions through the correct interchange categories — which typically saves auto businesses 20-40% on those specific cards.</p>`,
          `<p>Send us your latest statement and we'll show you exactly where the overcharges are.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Your Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 7,
        delayHours: 0,
        subject: "Terminals built for auto shops",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Beyond pricing, we provide terminals designed for shop environments:</p>`,
          `<ul><li>Countertop terminals that handle high-ticket amounts</li><li>Mobile readers for roadside or lot transactions</li><li>Text-to-pay links you can send from your phone</li><li>Integrated invoicing for repair orders</li><li>Next-day deposits — no waiting days for large payments</li></ul>`,
          `<p>All included at no extra cost when you process with us.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">See Options</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 10,
        delayHours: 0,
        body: smsBody(`{{firstName}}, last message from Liberty Bancard. If you ever want a free statement review, we're here. No contracts, no pressure.\n— Liberty Bancard`),
      },
    ],
  },

  // Auto Inbound Drip
  {
    name: "V-Auto: Inbound Lead Nurture",
    description: "Nurture sequence for auto industry leads who submitted a form or requested info.",
    triggerType: "form_submission",
    triggerConfig: { category: "inbound", vertical: "auto" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "We got your info — here's what's next",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Thanks for reaching out to Liberty Bancard. We work with auto shops, dealerships, and service centers throughout Florida.</p>`,
          `<p>Next steps are simple:</p>`,
          `<ol><li>Send us your most recent processing statement</li><li>We'll do a full fee analysis (takes about 24 hours)</li><li>We'll walk you through the findings — and if we can save you money, we'll show you exactly how much</li></ol>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "How auto shops benefit from interchange-plus pricing",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Auto businesses have a unique payment mix — high-ticket repairs, debit payments for oil changes, fleet cards for commercial accounts. Each has a different interchange cost.</p>`,
          `<p>With interchange-plus pricing, you pay the actual card network cost plus a small fixed margin. No bundled rates, no tier manipulation.</p>`,
          `<p>For most auto shops, this means:</p>`,
          `<ul><li>Lower effective rate on debit transactions</li><li>Better rates on fleet and corporate cards</li><li>Clear monthly statements you can actually understand</li></ul>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get Your Quote</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "sms",
        delayDays: 5,
        delayHours: 0,
        body: smsBody(`Hi {{firstName}}, checking in from Liberty Bancard. Have you had a chance to send over your statement? Happy to do the review whenever you're ready. {{custom_values.booking_link}}`),
      },
    ],
  },

  // Auto Operations
  {
    name: "V-Auto: Account Management Ops",
    description: "Operational emails for existing auto merchant clients. Covers fleet card optimization, terminal maintenance, and seasonal prep.",
    triggerType: "manual",
    triggerConfig: { category: "operations", vertical: "auto" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Fleet card optimization check for {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Fleet card interchange rates were updated recently. We want to make sure your account is routing fleet transactions (WEX, Voyager, Fuelman, etc.) through the most cost-effective channels.</p>`,
          `<p>Your account manager will review:</p>`,
          `<ul><li>Fleet card routing optimization</li><li>High-ticket transaction pricing</li><li>Terminal firmware updates</li><li>PCI compliance renewal status</li></ul>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule Review</a></p>`,
          `<p>— Liberty Bancard Account Management</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 60,
        delayHours: 0,
        subject: "Summer rush prep for your payment setup",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Summer is peak season for auto shops. Make sure your payment setup is ready:</p>`,
          `<ul><li>All terminals tested and backup devices charged</li><li>Text-to-pay links set up for large repair invoices</li><li>Mobile reader ready for roadside or lot payments</li><li>Batch settlement timing optimized for cash flow</li></ul>`,
          `<p>Need any terminal replacements or upgrades? We'll ship them overnight at no cost.</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Contact Your AM</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // MEDICAL / MED SPA VERTICAL
  // ═══════════════════════════════════════════════════════

  // Medical SDR Outbound
  {
    name: "V-Medical: SDR Outbound Prospecting",
    description: "Cold outreach for medical offices, dental practices, med spas, chiropractors, and healthcare providers.",
    triggerType: "manual",
    triggerConfig: { category: "sdr", vertical: "medical" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Payment processing designed for healthcare practices",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Healthcare practices have unique payment needs — patient copays, recurring billing for treatment plans, HSA/FSA cards, and compliance requirements that general processors don't understand.</p>`,
          `<p>At Liberty Bancard, we work with medical offices, dental practices, med spas, and specialty clinics to provide:</p>`,
          `<ul><li>Proper HSA/FSA card acceptance and routing</li><li>HIPAA-conscious payment workflows</li><li>Patient payment plans with recurring billing</li><li>Text-to-pay for balances and copays</li><li>Transparent interchange-plus pricing</li></ul>`,
          `<p>Would a quick call make sense to see if we can improve your payment setup?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book a Call</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 1,
        delayHours: 0,
        body: smsBody(`Hi {{firstName}}, Liberty Bancard here. We specialize in payment processing for medical practices. Better rates, better tools, better patient experience. Quick chat? {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 4,
        delayHours: 0,
        subject: "Why most medical offices overpay on HSA/FSA transactions",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>HSA and FSA cards have specific interchange rates that are often lower than standard credit cards. But many processors don't route them correctly — meaning you're paying more than you should on these transactions.</p>`,
          `<p>We ensure proper card identification and routing so your practice gets the best rate on every healthcare card type.</p>`,
          `<p>Combined with our transparent pricing model, most medical practices save 15-30% on their monthly processing costs.</p>`,
          `<p>Send us a recent statement and we'll show you exactly where the savings are.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 7,
        delayHours: 0,
        subject: "Patient-friendly payment tools for {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Beyond lower rates, we help medical practices improve the patient payment experience:</p>`,
          `<ul><li>Text-to-pay links sent directly to patients' phones</li><li>Online payment portals for balance payments</li><li>Recurring billing for treatment plans and memberships</li><li>Digital receipts with practice branding</li><li>Contactless payment at the front desk</li></ul>`,
          `<p>Happy patients who can pay easily = better collections and fewer AR headaches.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Learn More</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 10,
        delayHours: 0,
        body: smsBody(`{{firstName}}, last note from Liberty Bancard. If you ever want a free processing review for your practice, just reply here. No contracts required.\n— Liberty Bancard`),
      },
    ],
  },

  // Medical Inbound Drip
  {
    name: "V-Medical: Inbound Lead Nurture",
    description: "Nurture sequence for medical/dental/medspa leads who requested information.",
    triggerType: "form_submission",
    triggerConfig: { category: "inbound", vertical: "medical" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Thanks for your interest — healthcare payment solutions",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Thank you for reaching out to Liberty Bancard. We understand that healthcare practices need payment solutions that are efficient, patient-friendly, and compliant.</p>`,
          `<p>Here's our process:</p>`,
          `<ol><li>Share your current statement (we handle it securely)</li><li>We analyze your fee structure against healthcare-specific interchange rates</li><li>We present clear savings and recommend the right terminal/payment tools for your practice</li></ol>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "Reducing patient payment friction",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>One thing we hear from practices all the time: collecting patient balances is a headache.</p>`,
          `<p>Our tools help with that:</p>`,
          `<ul><li>Text-to-pay: Send a payment link via SMS after the visit</li><li>Recurring plans: Auto-charge for treatment plans or memberships</li><li>Online portal: Patients pay outstanding balances from their phone</li><li>Card-on-file: Securely store cards for future visits</li></ul>`,
          `<p>All PCI-compliant and designed to work with your existing practice management system.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">See a Demo</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "sms",
        delayDays: 5,
        delayHours: 0,
        body: smsBody(`Hi {{firstName}}, following up from Liberty Bancard. Ready to review your practice's payment setup whenever you are. {{custom_values.booking_link}}`),
      },
    ],
  },

  // Medical Operations
  {
    name: "V-Medical: Account Management Ops",
    description: "Operational emails for existing medical/dental/medspa merchant clients.",
    triggerType: "manual",
    triggerConfig: { category: "operations", vertical: "medical" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Annual payment review for {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>It's time for your annual payment processing review. Healthcare interchange rates change periodically, and we want to ensure your practice is still getting the best rates.</p>`,
          `<p>We'll check:</p>`,
          `<ul><li>HSA/FSA routing optimization</li><li>Recurring billing setup and efficiency</li><li>Terminal firmware and security updates</li><li>PCI compliance renewal</li><li>Patient payment portal usage and performance</li></ul>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule Review</a></p>`,
          `<p>— Liberty Bancard Account Management</p>`,
        ]),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // RESTAURANT / QSR VERTICAL
  // ═══════════════════════════════════════════════════════

  // Restaurant SDR Outbound
  {
    name: "V-Restaurant: SDR Outbound Prospecting",
    description: "Cold outreach for restaurants, cafes, QSR, bars, food trucks, and catering businesses.",
    triggerType: "manual",
    triggerConfig: { category: "sdr", vertical: "restaurant" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Restaurant payment processing — are you paying too much?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Restaurants process a ton of small transactions every day — and that makes your payment processing costs add up fast. The difference between a good rate and a bad one can be thousands per month.</p>`,
          `<p>We work with restaurants, cafes, and QSR operations across Florida. Here's what we typically find:</p>`,
          `<ul><li>Flat-rate processors charging 2.6-2.9% on every swipe — even debit cards that should cost under 1%</li><li>Hidden monthly fees for "PCI compliance" or "statement fees" that serve no purpose</li><li>Slow funding that hurts your cash flow when you need to pay suppliers</li></ul>`,
          `<p>Want us to take a look at your current setup?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get a Free Review</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 1,
        delayHours: 0,
        body: smsBody(`Hi {{firstName}}, Liberty Bancard here. We help restaurants save 15-30% on card processing. Next-day funding, tip-adjusted terminals, no long contracts. Worth a chat? {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "Tips, tabs, and terminals — built for restaurants",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Restaurant payment processing has specific needs that generic processors often get wrong:</p>`,
          `<ul><li><strong>Tip adjustment:</strong> Pre-auth with tip line, easy adjust at end of shift</li><li><strong>Tab management:</strong> Open/close tabs without double-charging</li><li><strong>Contactless:</strong> Apple Pay, Google Pay, tap-to-pay for fast counter service</li><li><strong>Kitchen integration:</strong> Terminals that work with your POS for ticket routing</li><li><strong>Next-day funding:</strong> Get your money tomorrow, not 3 days from now</li></ul>`,
          `<p>We provide all of this with transparent pricing — you see exactly what each transaction costs.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">See Restaurant Solutions</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 7,
        delayHours: 0,
        subject: "How {{companyName}} could keep more of every sale",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Quick numbers: If your restaurant processes $50,000/month in cards and you're on a flat 2.6% rate, you're paying about $1,300/month in processing fees.</p>`,
          `<p>With interchange-plus pricing, that same volume typically costs $800-$950 — saving you $350-$500 every month. That's $4,000-$6,000 per year back in your pocket.</p>`,
          `<p>The math is straightforward. Send us a statement and we'll show you your exact numbers.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 10,
        delayHours: 0,
        body: smsBody(`{{firstName}}, final note from Liberty Bancard. If you ever want a no-pressure processing review for your restaurant, just text back. We're here.\n— Liberty Bancard`),
      },
    ],
  },

  // Restaurant Inbound Drip
  {
    name: "V-Restaurant: Inbound Lead Nurture",
    description: "Nurture sequence for restaurant/QSR leads who submitted a form or requested info.",
    triggerType: "form_submission",
    triggerConfig: { category: "inbound", vertical: "restaurant" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Thanks for reaching out — restaurant payment solutions",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Thanks for connecting with Liberty Bancard. We specialize in payment processing for restaurants and food service businesses.</p>`,
          `<p>Here's what we'll do:</p>`,
          `<ol><li>Review your current statement to find savings opportunities</li><li>Show you a clear comparison with our pricing</li><li>Recommend the right terminal setup for your restaurant type (sit-down, counter, food truck, etc.)</li></ol>`,
          `<p>Upload your most recent statement to get started:</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 2,
        delayHours: 0,
        subject: "Why debit card processing matters for restaurants",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Here's a fact most restaurant owners don't know: debit cards cost significantly less to process than credit cards. But on a flat-rate plan, you pay the same high rate on both.</p>`,
          `<p>Restaurants typically see 30-50% of transactions on debit. That's a huge chunk of volume where you're overpaying.</p>`,
          `<p>With our interchange-plus model, debit transactions process at their actual cost — often under 1% vs. the 2.6% you might be paying now.</p>`,
          `<p>The savings on debit alone can pay for your processing costs on everything else.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">See Your Potential Savings</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "sms",
        delayDays: 5,
        delayHours: 0,
        body: smsBody(`Hi {{firstName}}, just following up from Liberty Bancard. Ready to do your restaurant's free processing review whenever you are. {{custom_values.booking_link}}`),
      },
    ],
  },

  // Restaurant Operations
  {
    name: "V-Restaurant: Account Management Ops",
    description: "Operational emails for existing restaurant merchant clients. Covers seasonal prep, terminal tips, and rate optimization.",
    triggerType: "manual",
    triggerConfig: { category: "operations", vertical: "restaurant" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Semi-annual rate check for {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Interchange rates update twice a year (April and October). We want to make sure {{companyName}} is still getting the best deal.</p>`,
          `<p>Your account manager will review:</p>`,
          `<ul><li>Current effective rate vs. new interchange tables</li><li>Tip adjustment and pre-auth settings</li><li>Terminal condition and firmware status</li><li>Any new payment features that could help your restaurant</li></ul>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule Your Check-Up</a></p>`,
          `<p>— Liberty Bancard Account Management</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 90,
        delayHours: 0,
        subject: "Busy season prep checklist for {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Before your busy season hits, here's a quick checklist:</p>`,
          `<ul><li>Test all terminals (especially portables for outdoor/patio seating)</li><li>Verify tip adjustment is working correctly</li><li>Enable contactless for faster counter service</li><li>Confirm batch auto-closes at the right time each night</li><li>Check that backup terminal is charged and ready</li></ul>`,
          `<p>Need a spare terminal or want to add patio processing? Let us know.</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Request Equipment</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // MED SPA VERTICAL
  // ═══════════════════════════════════════════════════════

  // Med Spa SDR Outbound
  {
    name: "V-Med Spa: SDR Outbound Prospecting",
    description: "Cold outreach for med spas, aesthetic clinics, laser centers, and cosmetic wellness studios.",
    triggerType: "manual",
    triggerConfig: { category: "sdr", vertical: "medspa" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Med spa payment processing — are you paying too much?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>I work with med spas and aesthetic clinics across Florida, and most were significantly overpaying on card processing before they switched to us.</p>`,
          `<p>Med spas have a unique payment mix: high-ticket treatments like Botox and laser services, recurring membership payments, HSA/FSA cards, and sometimes financing programs. Generic processors bundle all of this into one expensive flat rate.</p>`,
          `<p>We structure pricing around your actual transaction mix — which typically saves med spa clients 20-35% on their monthly processing costs.</p>`,
          `<p>Worth a quick 10-minute call to see if {{companyName}} could be saving more?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book a Free Analysis Call</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 0,
        delayHours: 4,
        body: smsBody(`Hi {{firstName}}, Liberty Bancard here. We specialize in payment processing for med spas — better rates on high-ticket treatments, memberships, and HSA/FSA cards. Quick chat? {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "Why med spas overpay on Botox and filler transactions",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>High-ticket aesthetic treatments ($300-$2,000+) should benefit from lower percentage-based processing costs — but most processors don't pass those savings through.</p>`,
          `<p>Here's what we typically find when reviewing a med spa's statement:</p>`,
          `<ul><li>HSA/FSA cards misrouted to generic credit card rates (they qualify for lower healthcare interchange)</li><li>Recurring membership charges billed at new-card rates instead of recurring card rates</li><li>Flat-rate plans that ignore debit vs. credit distinctions</li><li>Hidden monthly fees with no clear value</li></ul>`,
          `<p>Send us your most recent statement and we'll show you exactly where the overcharges are — no obligation.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Your Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 7,
        delayHours: 0,
        subject: "Payment tools built for the client experience at {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Beyond lower rates, the right payment setup improves the client experience at your med spa:</p>`,
          `<ul><li>Text-to-pay links for pre-visit deposits and post-visit balances</li><li>Recurring billing for monthly membership packages (Botox Club, HydraFacial memberships, etc.)</li><li>Sleek countertop terminals that match your aesthetic</li><li>Digital receipts — no clunky paper rolls at the front desk</li><li>Next-day deposits to keep your cash flow healthy</li></ul>`,
          `<p>No long-term contracts. No equipment fees when you process with us.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule a Review</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 7,
        delayHours: 4,
        body: smsBody(`Hi {{firstName}}, checking in from Liberty Bancard. Did the info on med spa processing resonate? Happy to do a free statement review whenever you're ready. {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 6,
        actionType: "email",
        delayDays: 14,
        delayHours: 0,
        subject: "Last note from Liberty Bancard — {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>I don't want to keep filling your inbox, so this will be my last message for now.</p>`,
          `<p>If {{companyName}} ever decides to look at your processing costs, we're here. Most med spa clients save $300-$800/month after switching — but the analysis is free either way.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book a Free Review</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 7,
        actionType: "sms",
        delayDays: 14,
        delayHours: 4,
        body: smsBody(`{{firstName}}, last message from Liberty Bancard. If you ever want that free med spa processing review, just reply anytime. No pressure.\n— Liberty Bancard`),
      },
    ],
  },

  // Med Spa Inbound Nurture
  {
    name: "V-Med Spa: Inbound Lead Nurture",
    description: "Nurture sequence for med spa leads who submitted a form or requested info. Educates on high-ticket, membership, and HSA/FSA payment optimization.",
    triggerType: "form_submission",
    triggerConfig: { category: "inbound", vertical: "medspa" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Thanks for reaching out — med spa payment solutions",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Thanks for contacting Liberty Bancard. We work specifically with med spas, aesthetic clinics, and wellness studios to optimize their payment processing.</p>`,
          `<p>Here's how we'll help:</p>`,
          `<ol><li>Review your current statement to identify overcharges</li><li>Build a custom pricing proposal based on your treatment mix</li><li>Show you the right tools — recurring billing, text-to-pay, HSA/FSA routing</li><li>You decide if it makes sense — zero pressure</li></ol>`,
          `<p>Upload a recent statement to get started:</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 2,
        delayHours: 0,
        subject: "HSA/FSA cards and med spa payments — what you should know",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>More patients are paying for aesthetic and wellness treatments with HSA and FSA funds — especially for medically-supervised services like laser therapy, skin treatments, and body contouring.</p>`,
          `<p>HSA/FSA cards have specific interchange categories that are typically lower than standard credit cards. But most processors route them incorrectly, so you pay the higher credit card rate.</p>`,
          `<p>We configure your terminal and processing account to properly identify and route healthcare cards — which lowers your cost on every HSA/FSA transaction.</p>`,
          `<p>This alone can save a busy med spa $200-$400 per month.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">See the Difference</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 5,
        delayHours: 0,
        subject: "How other Florida med spas are saving with Liberty Bancard",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Across our med spa client portfolio, the most common wins we deliver:</p>`,
          `<ul><li><strong>Membership billing:</strong> Automated recurring charges with failed-payment retry logic — no more chasing clients for monthly fees</li><li><strong>High-ticket routing:</strong> Treatments over $500 often qualify for Level II/III interchange if billed correctly</li><li><strong>Financing integration:</strong> Pairing our processing with patient financing programs (CareCredit, etc.) for zero-conflict billing</li><li><strong>Transparency:</strong> One clear monthly statement — no mystery fees</li></ul>`,
          `<p>Ready to see what this looks like for {{companyName}}?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get Your Custom Quote</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 10,
        delayHours: 0,
        subject: "Still interested? Here's the easiest next step",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Just checking in one more time. If you're still thinking about your processing costs, the easiest next step is uploading your most recent statement — we'll do the analysis and send you a comparison within 24 hours.</p>`,
          `<p>No commitment required. If we can't improve your situation, we'll tell you that too.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Statement Now</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 10,
        delayHours: 2,
        body: smsBody(`Hi {{firstName}}, last check-in from Liberty Bancard. Happy to do a free processing review for {{companyName}} whenever you're ready — just reply here or book at: {{custom_values.booking_link}}`),
      },
    ],
  },

  // Med Spa Account Ops
  {
    name: "V-Med Spa: Account Management Ops",
    description: "Operational emails for existing med spa merchant clients. Covers quarterly reviews, membership billing optimization, and seasonal upsell prompts.",
    triggerType: "manual",
    triggerConfig: { category: "operations", vertical: "medspa" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Quarterly account review for {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Time for your quarterly processing check-up. As your med spa grows, your payment mix changes — and we want to make sure your pricing is still optimized for it.</p>`,
          `<p>Your account manager will review:</p>`,
          `<ul><li>Current effective rate vs. latest interchange tables</li><li>HSA/FSA routing accuracy</li><li>Recurring membership billing performance (decline rates, retry success)</li><li>Terminal firmware and security updates</li><li>PCI compliance status</li></ul>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule Your Quarterly Review</a></p>`,
          `<p>— Liberty Bancard Account Management</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 30,
        delayHours: 0,
        subject: "New Year body contouring season — is your billing ready?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>January and spring are peak seasons for med spas as clients pursue aesthetic goals. Here's a quick prep checklist for your payment setup:</p>`,
          `<ul><li>Test recurring membership charges — especially if you've added new membership tiers</li><li>Confirm text-to-pay links are set up for pre-visit deposits</li><li>Verify your terminal is enabled for tap-to-pay (fast checkout during busy periods)</li><li>Check your next-day funding timing — you'll want cash available for supply orders</li></ul>`,
          `<p>Have questions or want to add a second terminal for the rush? Your account manager can help.</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Contact Your AM</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 60,
        delayHours: 0,
        subject: "Thinking about adding a membership program at {{companyName}}?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Membership programs are one of the fastest-growing revenue models in the med spa industry. If you're thinking about launching one — or expanding an existing program — we can make the billing side effortless.</p>`,
          `<p>Our recurring billing setup includes:</p>`,
          `<ul><li>Automatic monthly charges with card-on-file storage</li><li>Smart retry logic for failed payments (reduces churn)</li><li>Member portal integration for self-service card updates</li><li>Detailed reporting on membership revenue vs. à la carte</li></ul>`,
          `<p>Want to talk through what this would look like for {{companyName}}?</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Explore Membership Billing</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // DENTAL VERTICAL
  // ═══════════════════════════════════════════════════════

  // Dental SDR Outbound
  {
    name: "V-Dental: SDR Outbound Prospecting",
    description: "Cold outreach for dental practices — general dentistry, orthodontics, oral surgery, and pediatric dental.",
    triggerType: "manual",
    triggerConfig: { category: "sdr", vertical: "dental" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Dental practice payment processing — a quick question",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>I work with dental offices across Florida on payment processing, and I wanted to reach out to {{companyName}} specifically.</p>`,
          `<p>Most dental practices have a complex payment mix: patient copays, high-ticket procedures (crowns, implants, aligners), HSA/FSA card payments, and sometimes in-house financing. Generic processors charge the same flat rate on all of it — which costs you more than it should.</p>`,
          `<p>We build pricing around your actual transaction mix and properly route HSA/FSA cards so you get the healthcare interchange rate — not the generic credit card rate.</p>`,
          `<p>Would it be worth 10 minutes to see how your current setup compares?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book a Quick Call</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 0,
        delayHours: 4,
        body: smsBody(`Hi {{firstName}}, Liberty Bancard here. We help dental practices lower processing costs on copays, HSA/FSA cards, and high-ticket procedures. Quick 10-min call? {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "HIPAA-conscious payment terminals for dental practices",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Payment processing in a dental office isn't just about rates — it's also about compliance and patient experience.</p>`,
          `<p>Our dental-practice clients appreciate:</p>`,
          `<ul><li>HIPAA-conscious payment workflows that don't expose PHI through payment systems</li><li>Text-to-pay for balances sent after procedures — no awkward front-desk moments</li><li>HSA/FSA card acceptance with correct routing (patients love this)</li><li>Countertop terminals that fit the front desk without clutter</li><li>Detailed per-transaction reporting for dental billing reconciliation</li></ul>`,
          `<p>Would love to show you what this looks like in practice. Send over a recent statement and we'll build a comparison.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Your Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 7,
        delayHours: 0,
        subject: "How dental practices save on high-ticket procedures",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Implants, veneers, Invisalign, and full-arch restorations are high-ticket transactions — often $2,000-$30,000+. On a flat 2.6% rate, that's $52-$780 in processing fees on a single procedure.</p>`,
          `<p>With interchange-plus pricing, high-ticket transactions often qualify for corporate or purchasing card interchange rates — significantly lower. For practices doing significant cosmetic and restorative volume, this difference is material.</p>`,
          `<p>We can show you the math specific to {{companyName}}'s procedure mix. No obligation.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get My Free Analysis</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 7,
        delayHours: 4,
        body: smsBody(`Hi {{firstName}}, checking in from Liberty Bancard. Did the dental payment info resonate? Happy to do a free statement review anytime. {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 6,
        actionType: "email",
        delayDays: 14,
        delayHours: 0,
        subject: "Last note from Liberty Bancard — {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>I'll keep this short — this is my last reach-out for now.</p>`,
          `<p>If {{companyName}} ever wants to explore better pricing on HSA/FSA cards, high-ticket procedures, or patient financing billing, we're here. The analysis is free and takes 10 minutes.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get My Free Analysis</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 7,
        actionType: "sms",
        delayDays: 14,
        delayHours: 4,
        body: smsBody(`{{firstName}}, last message from Liberty Bancard. Free dental practice processing review available anytime — just reply or book: {{custom_values.booking_link}}\n— Liberty Bancard`),
      },
    ],
  },

  // Dental Inbound Nurture
  {
    name: "V-Dental: Inbound Lead Nurture",
    description: "Nurture sequence for dental practice leads who submitted a form or requested info.",
    triggerType: "form_submission",
    triggerConfig: { category: "inbound", vertical: "dental" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Thanks for reaching out — dental practice payment solutions",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Thanks for connecting with Liberty Bancard. We specialize in payment processing for dental practices — from solo general dentists to multi-location orthodontic groups.</p>`,
          `<p>Here's what we'll do for you:</p>`,
          `<ol><li>Analyze your current statement — line by line</li><li>Show you where HSA/FSA cards are being over-charged</li><li>Build a proposal specific to your procedure mix and volume</li><li>Walk you through the comparison — no pressure to switch</li></ol>`,
          `<p>Upload a recent statement to get started:</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 2,
        delayHours: 0,
        subject: "The HSA/FSA routing problem most dental offices don't know about",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>HSA and FSA cards are considered healthcare cards by the card networks — and they carry a lower interchange rate than standard consumer credit cards.</p>`,
          `<p>But here's the problem: unless your terminal is properly configured to identify and route these cards, your processor charges you the higher generic rate instead.</p>`,
          `<p>We configure every account to correctly identify healthcare cards at the point of sale — so you capture the lower rate automatically. For a dental practice processing significant HSA/FSA volume, this correction alone can be worth hundreds per month.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Fix My HSA/FSA Routing</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 5,
        delayHours: 0,
        subject: "Patient payment experience matters — here's how we help",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>The payment experience at your front desk shapes patient satisfaction. Here's how our dental-practice setup helps:</p>`,
          `<ul><li><strong>Text-to-pay:</strong> Send balance links via text — patients pay from their phone, no front-desk awkwardness</li><li><strong>Pre-auth for appointments:</strong> Capture card details during scheduling, charge after the procedure</li><li><strong>Digital receipts:</strong> Email receipts for HSA/FSA reimbursement documentation</li><li><strong>In-house financing support:</strong> Pair our processing with CareCredit or your own payment plan program</li></ul>`,
          `<p>All of this with transparent pricing and next-day deposits.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">See How It Works</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 10,
        delayHours: 0,
        subject: "Ready to see your savings? One easy step",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Just following up one more time. The fastest path to seeing your savings is uploading your most recent processing statement — we'll have a line-by-line comparison ready within 24 hours.</p>`,
          `<p>If we can't improve your situation, we'll tell you that. But in our experience with dental practices, there's almost always meaningful savings on the table.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload My Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 10,
        delayHours: 2,
        body: smsBody(`Hi {{firstName}}, last follow-up from Liberty Bancard. Still happy to do a free review for your dental practice whenever you're ready. Book here: {{custom_values.booking_link}}`),
      },
    ],
  },

  // Dental Account Ops
  {
    name: "V-Dental: Account Management Ops",
    description: "Operational emails for existing dental practice merchant clients. Covers quarterly reviews, HSA/FSA compliance, and upsell prompts.",
    triggerType: "manual",
    triggerConfig: { category: "operations", vertical: "dental" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Quarterly account review for {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Time for your quarterly check-in. Dental practices often see changes in their card mix as patient demographics shift — and we want to make sure your pricing is optimized for your current volume.</p>`,
          `<p>Your account manager will review:</p>`,
          `<ul><li>HSA/FSA routing accuracy and capture rate</li><li>High-ticket procedure transaction performance</li><li>Terminal firmware and PCI compliance status</li><li>Text-to-pay usage and patient adoption</li></ul>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule Your Review</a></p>`,
          `<p>— Liberty Bancard Account Management</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 45,
        delayHours: 0,
        subject: "FSA deadline season — is {{companyName}} ready?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>October through December is FSA spend-down season — patients race to use remaining FSA balances before year-end. Dental practices typically see a surge in FSA card usage for procedures, teeth whitening, and orthodontic payments.</p>`,
          `<p>Make sure your setup is ready:</p>`,
          `<ul><li>Confirm HSA/FSA card routing is active and correct</li><li>Verify text-to-pay links are set up for easy remote payments</li><li>Consider a short "use your FSA dollars here" campaign for active patients</li></ul>`,
          `<p>Your account manager can help with any of the above.</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Contact Your AM</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 90,
        delayHours: 0,
        subject: "Are you offering in-house payment plans at {{companyName}}?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>One of the most effective ways dental practices grow case acceptance is by offering in-house payment plans — especially for high-ticket procedures that insurance doesn't fully cover.</p>`,
          `<p>We support practices that want to set up recurring payment plans directly through our system:</p>`,
          `<ul><li>Set up custom payment schedules (monthly, bi-monthly, etc.)</li><li>Automatic card-on-file charges with failed-payment retry</li><li>Dashboard to track plan status and outstanding balances</li></ul>`,
          `<p>Interested in exploring this for {{companyName}}?</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Explore Payment Plans</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // AUTO REPAIR VERTICAL
  // ═══════════════════════════════════════════════════════

  // Auto Repair SDR Outbound
  {
    name: "V-Auto Repair: SDR Outbound Prospecting",
    description: "Cold outreach for independent auto repair shops, tire shops, oil change centers, and body shops.",
    triggerType: "manual",
    triggerConfig: { category: "sdr", vertical: "autorepair" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Auto repair shops are overpaying on processing — are you?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Independent auto repair shops have a specific problem with payment processing: large-ticket repairs get charged the same rate as a $20 oil change — and most processors never flag this.</p>`,
          `<p>We work with tire shops, repair centers, and body shops across Florida and consistently find that their effective processing rate is higher than it needs to be — often by 20-35%.</p>`,
          `<p>The fix is simple: structured pricing based on your actual transaction mix, with correct routing for fleet cards, debit, and large-ticket payments.</p>`,
          `<p>Would it be worth a quick call to review what {{companyName}} is actually paying?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get a Free Analysis</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 0,
        delayHours: 4,
        body: smsBody(`Hi {{firstName}}, Liberty Bancard here. We help auto repair shops lower processing costs on large repairs, fleet cards, and daily debit transactions. Quick chat? {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "Fleet cards, large repairs, and where your shop loses money",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Two areas where auto repair shops consistently overpay:</p>`,
          `<p><strong>1. Fleet and commercial cards:</strong> WEX, Voyager, Fuelman, and other fleet cards have specific interchange categories. Most processors route them as generic business cards — costing you 0.5-1% more per transaction. If you do commercial fleet work, this adds up fast.</p>`,
          `<p><strong>2. Large repair invoices:</strong> A $1,500 transmission repair on a flat 2.7% plan costs $40 in processing. With proper interchange-plus routing, that same transaction often qualifies for $20-$25 — a $15-20 savings on one ticket.</p>`,
          `<p>Multiply that across your monthly volume and you're looking at real money.</p>`,
          `<p>Send us a statement and we'll do the math for your shop specifically.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 7,
        delayHours: 0,
        subject: "Payment tools that make shop life easier at {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Auto repair shops have specific needs beyond just rates:</p>`,
          `<ul><li><strong>Text-to-pay:</strong> Send a payment link via text when the car is ready — customer pays before pickup, no waiting at the counter</li><li><strong>Pre-auth holds:</strong> Capture card info when the car drops off, process the final amount when work is complete</li><li><strong>Mobile readers:</strong> Process payment at the bay or during test drives</li><li><strong>Next-day deposits:</strong> Get paid tomorrow, not 3 days from now</li><li><strong>No long-term contracts:</strong> Month-to-month with no cancellation fees</li></ul>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">See All Features</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 7,
        delayHours: 4,
        body: smsBody(`Hi {{firstName}}, checking in from Liberty Bancard. Seen anything helpful in my notes on fleet cards and large repair savings? Happy to dig in whenever. {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 6,
        actionType: "email",
        delayDays: 14,
        delayHours: 0,
        subject: "Last note from Liberty Bancard — {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Last message from me — I don't want to overstay my welcome.</p>`,
          `<p>If {{companyName}} ever wants a free review of your processing costs — especially on fleet cards or large repair invoices — we're here. Most auto repair clients save $200-$600/month after switching.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get My Free Analysis</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 7,
        actionType: "sms",
        delayDays: 14,
        delayHours: 4,
        body: smsBody(`{{firstName}}, last message from Liberty Bancard. Free auto repair processing review available anytime — just reply or book: {{custom_values.booking_link}}\n— Liberty Bancard`),
      },
    ],
  },

  // Auto Repair Inbound Nurture
  {
    name: "V-Auto Repair: Inbound Lead Nurture",
    description: "Nurture sequence for auto repair shop leads who submitted a form or requested info.",
    triggerType: "form_submission",
    triggerConfig: { category: "inbound", vertical: "autorepair" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Thanks for reaching out — auto repair payment solutions",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Thanks for contacting Liberty Bancard. We work with independent auto repair shops, tire centers, and body shops throughout Florida.</p>`,
          `<p>Here's what happens next:</p>`,
          `<ol><li>Upload your most recent processing statement</li><li>We analyze fleet card routing, large-ticket performance, and debit vs. credit mix</li><li>We build a comparison showing your current cost vs. what you'd pay with us</li><li>You decide — no obligation</li></ol>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 2,
        delayHours: 0,
        subject: "How interchange-plus pricing saves auto shops money every month",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Most processors charge auto shops a flat rate — say 2.6% on everything. Sounds simple, but it's expensive.</p>`,
          `<p>With interchange-plus pricing, you pay the actual network cost for each card type plus a small, fixed margin:</p>`,
          `<ul><li>Debit cards: often 0.8-1.2% actual cost (vs. 2.6% on flat rate)</li><li>Fleet cards: routed correctly to fleet interchange categories</li><li>Large repairs on business cards: lower percentage than flat rate</li></ul>`,
          `<p>The more volume you process, the more this difference compounds. We'll show you the math on your specific numbers.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Run My Numbers</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 5,
        delayHours: 0,
        subject: "Text-to-pay for auto shops — how it works",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>One feature auto repair shops love: text-to-pay. Here's how it works in a repair shop context:</p>`,
          `<ol><li>Car is ready — technician sends a text to the customer's phone with a payment link</li><li>Customer pays from their phone (card, Apple Pay, Google Pay) while you're still working on another car</li><li>You get a payment confirmation — customer comes to pick up the car, no waiting at the register</li></ol>`,
          `<p>The result: faster car turnover, less front-desk congestion, and customers who pay before they arrive.</p>`,
          `<p>Included at no extra cost with our auto shop processing accounts.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">See Text-to-Pay in Action</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 10,
        delayHours: 0,
        subject: "Ready to see what {{companyName}} could save?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Last follow-up — if you'd like to see your savings, uploading a statement takes about 2 minutes and we'll have a full comparison back to you within 24 hours.</p>`,
          `<p>No commitment. If we can't improve your numbers, we'll say so.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload My Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 10,
        delayHours: 2,
        body: smsBody(`Hi {{firstName}}, last follow-up from Liberty Bancard. Happy to do a free review for {{companyName}} anytime — just reply or book: {{custom_values.booking_link}}`),
      },
    ],
  },

  // Auto Repair Account Ops
  {
    name: "V-Auto Repair: Account Management Ops",
    description: "Operational emails for existing auto repair merchant clients. Covers quarterly reviews, fleet card optimization, and upsell prompts.",
    triggerType: "manual",
    triggerConfig: { category: "operations", vertical: "autorepair" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Quarterly processing review for {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Time for your quarterly account check-in. Auto repair shops often see shifts in their commercial vs. consumer card mix — and we want to confirm your fleet card routing is still optimized.</p>`,
          `<p>Your account manager will review:</p>`,
          `<ul><li>Fleet card routing accuracy (WEX, Voyager, Fuelman, etc.)</li><li>Large-ticket transaction performance</li><li>Text-to-pay usage and customer adoption</li><li>Terminal firmware and PCI compliance status</li></ul>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule Your Review</a></p>`,
          `<p>— Liberty Bancard Account Management</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 45,
        delayHours: 0,
        subject: "Summer prep for your shop's payment setup",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Summer is busy season for auto shops in Florida — AC repairs, road trip prep, and heat-related issues spike. Make sure your payment setup is ready:</p>`,
          `<ul><li>All terminals tested and working (including any portable readers)</li><li>Text-to-pay links active and set up with your shop phone</li><li>Backup terminal charged and ready for a busy rush</li><li>Batch settlement timing confirmed — next-day deposits keep cash flow healthy</li></ul>`,
          `<p>Need an extra terminal for your busiest bays? We'll ship it overnight.</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Contact Your AM</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 90,
        delayHours: 0,
        subject: "Does {{companyName}} work with commercial fleet accounts?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>If you're growing your commercial fleet business, we can help structure your payment setup to capture the correct fleet interchange rates — which are often 30-50% lower than standard business card rates for properly routed fleet transactions.</p>`,
          `<p>We also support invoicing workflows for net-30 commercial clients if you're moving toward B2B billing for fleets or municipal accounts.</p>`,
          `<p>Interested in talking through your commercial payment strategy?</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Talk to Your AM</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // SALON / BEAUTY / BARBERSHOP VERTICAL
  // ═══════════════════════════════════════════════════════

  // Salon SDR Outbound
  {
    name: "V-Salon: SDR Outbound Prospecting",
    description: "Cold outreach for salons, barbershops, beauty studios, nail salons, and blow-dry bars.",
    triggerType: "manual",
    triggerConfig: { category: "sdr", vertical: "salon" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Quick question about your salon's payment processing",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>I work with salons, barbershops, and beauty studios across Florida on payment processing, and I wanted to reach out to {{companyName}} specifically.</p>`,
          `<p>Salons process a ton of tip-adjusted transactions — and that combination of service charges plus gratuity means your effective processing rate matters more than you might think. Most salons are on flat-rate plans that over-charge on debit and small-ticket services.</p>`,
          `<p>We help salon and beauty businesses save 15-25% on processing with transparent, interchange-plus pricing that actually makes sense for your transaction mix.</p>`,
          `<p>Worth a quick 10-minute call?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book a Call</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 0,
        delayHours: 4,
        body: smsBody(`Hi {{firstName}}, Liberty Bancard here. We help salons and barbershops save on card processing — better rates, tip-adjust terminals, next-day deposits. Worth a chat? {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "How salon tip processing is costing you more than it should",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Here's a common issue we find in salons: when a client adds a tip after the initial charge, the tip amount gets processed as a new transaction — sometimes at a higher rate category. Over hundreds of tip-adjusted transactions per month, this adds up.</p>`,
          `<p>We configure your terminal and processing account to handle tip adjustments correctly so the full transaction (service + tip) is settled at one optimized rate.</p>`,
          `<p>Combined with proper debit card routing, most salons see meaningful savings quickly.</p>`,
          `<p>Send us a recent statement and we'll show you the exact numbers for {{companyName}}.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 7,
        delayHours: 0,
        subject: "Modern payment setup built for the salon experience",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Your payment setup should match the experience you create for clients. Here's what salon and beauty clients love about our setup:</p>`,
          `<ul><li>Sleek countertop or handheld terminals that look great at any station</li><li>Tip prompts built into the checkout screen — no awkward cash ask</li><li>Text-to-pay for pre-booking deposits or balances</li><li>Digital receipts — no paper rolls, no clutter</li><li>Next-day deposits so your cash flow stays healthy between busy weekends</li></ul>`,
          `<p>No long-term contracts. Setup is fast — usually 48-72 hours.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule a Review</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 7,
        delayHours: 4,
        body: smsBody(`Hi {{firstName}}, checking in from Liberty Bancard. Did the info on tip-adjust savings and booking deposits resonate? Happy to review your statement anytime. {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 6,
        actionType: "email",
        delayDays: 14,
        delayHours: 0,
        subject: "Last note from Liberty Bancard — {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Last message — I don't want to clutter your inbox.</p>`,
          `<p>If {{companyName}} ever wants to lower processing costs on tip-adjusted transactions, debit, or booking deposits, we're here. Free statement review, no commitment.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get My Free Analysis</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 7,
        actionType: "sms",
        delayDays: 14,
        delayHours: 4,
        body: smsBody(`{{firstName}}, last note from Liberty Bancard. Free salon processing review available anytime — just reply or book: {{custom_values.booking_link}}`),
      },
    ],
  },

  // Salon Inbound Nurture
  {
    name: "V-Salon: Inbound Lead Nurture",
    description: "Nurture sequence for salon and beauty business leads who submitted a form or requested info.",
    triggerType: "form_submission",
    triggerConfig: { category: "inbound", vertical: "salon" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Thanks for reaching out — salon payment solutions",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Thanks for connecting with Liberty Bancard. We work with salons, barbershops, nail studios, and beauty businesses across Florida to optimize their payment processing.</p>`,
          `<p>Here's our process:</p>`,
          `<ol><li>Review your current statement</li><li>Identify overcharges on tip-adjusted transactions, debit cards, and service fees</li><li>Build a custom pricing proposal for your business</li><li>You decide — no obligation, no pressure</li></ol>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 2,
        delayHours: 0,
        subject: "What every salon owner should know about processing rates",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Most salons are on a flat-rate plan — something like 2.6% + $0.10 per transaction. Seems simple, but here's the problem:</p>`,
          `<ul><li>You pay that same rate on debit cards that actually cost under 1% to process</li><li>Tip adjustments can trigger re-authorization fees at your current processor</li><li>Small-ticket transactions get hit with a fixed per-transaction fee that raises your effective rate</li></ul>`,
          `<p>With interchange-plus pricing, each card type is charged at its actual cost plus a small, flat margin. For a salon doing $30,000/month, the savings difference is often $200-$500 per month.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">See My Potential Savings</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 5,
        delayHours: 0,
        subject: "How Florida salons use text-to-pay to reduce no-shows",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>No-shows and last-minute cancellations are a major challenge for salons. Our text-to-pay feature helps:</p>`,
          `<ul><li><strong>Booking deposits:</strong> Collect a $25-50 deposit via text link at the time of booking — clients who have paid a deposit show up</li><li><strong>Cancellation fees:</strong> Charge the card on file for late cancellations automatically</li><li><strong>Balance collection:</strong> Send a payment link after the appointment if a client needs to run or forgot their wallet</li></ul>`,
          `<p>It's all built into our standard salon processing package — no extra subscription, no third-party app.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Learn More</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 10,
        delayHours: 0,
        subject: "One step to see your savings — takes 2 minutes",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Last follow-up. If you want to see what {{companyName}} could save on processing, just upload your most recent statement — we'll have a full comparison ready within 24 hours.</p>`,
          `<p>No commitment required.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload My Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 10,
        delayHours: 2,
        body: smsBody(`Hi {{firstName}}, last message from Liberty Bancard. Happy to help {{companyName}} save on processing anytime — just reply or book: {{custom_values.booking_link}}`),
      },
    ],
  },

  // Salon Account Ops
  {
    name: "V-Salon: Account Management Ops",
    description: "Operational emails for existing salon/beauty merchant clients. Covers quarterly reviews, seasonal tips, and upsell prompts.",
    triggerType: "manual",
    triggerConfig: { category: "operations", vertical: "salon" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Quarterly account review for {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Time for your quarterly processing review. Salons often change their service mix and average ticket size — we want to confirm your pricing is still optimized for where your business is today.</p>`,
          `<p>Your account manager will check:</p>`,
          `<ul><li>Tip adjustment processing accuracy</li><li>Debit vs. credit card ratio and routing</li><li>Text-to-pay deposit usage and performance</li><li>Terminal condition and firmware updates</li><li>PCI compliance status</li></ul>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule Your Review</a></p>`,
          `<p>— Liberty Bancard Account Management</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 30,
        delayHours: 0,
        subject: "Holiday booking season — is your payment setup ready?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Holiday season is the busiest time for salons — blowouts, color updates, and special occasion styling fill the books fast. Quick prep checklist:</p>`,
          `<ul><li>Enable contactless tap-to-pay for fast checkout during peak hours</li><li>Set up booking deposits via text-to-pay to reduce no-shows during the rush</li><li>Confirm your tip prompts are showing on the terminal screen</li><li>Have a backup terminal ready for your busiest days</li></ul>`,
          `<p>Your account manager can ship a spare terminal overnight if needed.</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Contact Your AM</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 90,
        delayHours: 0,
        subject: "Are you collecting booking deposits at {{companyName}}?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Salons that collect booking deposits see 40-60% fewer no-shows on average. If you're not already using text-to-pay for pre-appointment deposits, it's one of the highest-ROI changes you can make.</p>`,
          `<p>Setup takes less than 30 minutes through your account dashboard, and clients can pay from any phone — no app required.</p>`,
          `<p>Want your account manager to walk you through the setup?</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Set Up Deposits</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // GYM / FITNESS / YOGA VERTICAL
  // ═══════════════════════════════════════════════════════

  // Gym SDR Outbound
  {
    name: "V-Gym: SDR Outbound Prospecting",
    description: "Cold outreach for gyms, fitness studios, yoga studios, CrossFit boxes, and martial arts schools.",
    triggerType: "manual",
    triggerConfig: { category: "sdr", vertical: "gym" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Gym membership billing — are you losing money on declines?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Gyms and fitness studios have a unique processing challenge: recurring membership billing. High decline rates, failed retry logic, and card-on-file fees can silently cost you hundreds per month in lost revenue and processing overcharges.</p>`,
          `<p>We work with gyms, yoga studios, and fitness businesses across Florida and consistently find two problems: processors charging too much on recurring membership charges, and poorly configured retry logic that lets churnable members slip through.</p>`,
          `<p>We solve both. Would it be worth a quick call to see how {{companyName}} is set up?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book a Free Analysis</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 0,
        delayHours: 4,
        body: smsBody(`Hi {{firstName}}, Liberty Bancard here. We help gyms and fitness studios cut processing costs on recurring memberships and reduce decline-related revenue loss. Quick chat? {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "Recurring billing for gyms — the hidden cost of high declines",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>When a membership charge declines, two things happen that cost you money:</p>`,
          `<ol><li>You pay a failed-transaction fee to your processor (often $0.10-0.35 per failed attempt)</li><li>You lose that member's revenue until the payment clears — and many don't chase it</li></ol>`,
          `<p>Our gym and fitness accounts include:</p>`,
          `<ul><li>Smart retry logic — attempts on optimal days/times when approval rates are highest</li><li>Automatic card-updater service — updates expired or replaced card numbers before they decline</li><li>Lower recurring-card interchange rates vs. standard credit card rates</li><li>Member self-service portal to update payment info and prevent cancellations</li></ul>`,
          `<p>This combination typically reduces decline rates by 20-40% and saves meaningful money on processing fees.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload My Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 7,
        delayHours: 0,
        subject: "Day passes, retail, and class packs — optimizing every revenue stream",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Most gyms and fitness studios have multiple payment streams — monthly memberships, drop-in passes, retail (supplements, apparel, gear), and class packs. Each has a different ideal payment structure.</p>`,
          `<p>We optimize all of them:</p>`,
          `<ul><li>Recurring billing with smart retry and card-updater for memberships</li><li>Point-of-sale with inventory tracking for retail</li><li>Text-to-pay for class pack purchases and one-time payments</li><li>Tap-to-pay for fast day-pass checkout at the front desk</li></ul>`,
          `<p>All under one account, one statement, one contact at Liberty Bancard.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule a Review</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 7,
        delayHours: 4,
        body: smsBody(`Hi {{firstName}}, checking in from Liberty Bancard. Did the gym billing info resonate? Happy to do a free membership billing audit for {{companyName}} anytime. {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 6,
        actionType: "email",
        delayDays: 14,
        delayHours: 0,
        subject: "Last note from Liberty Bancard — {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Last message — I don't want to keep filling your inbox.</p>`,
          `<p>If {{companyName}} ever wants to reduce membership decline rates, lower processing costs, or set up smarter recurring billing, we're here. Free audit, no commitment.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get My Free Analysis</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 7,
        actionType: "sms",
        delayDays: 14,
        delayHours: 4,
        body: smsBody(`{{firstName}}, last message from Liberty Bancard. Free gym billing audit available anytime — just reply or book: {{custom_values.booking_link}}\n— Liberty Bancard`),
      },
    ],
  },

  // Gym Inbound Nurture
  {
    name: "V-Gym: Inbound Lead Nurture",
    description: "Nurture sequence for gym and fitness studio leads who submitted a form or requested info.",
    triggerType: "form_submission",
    triggerConfig: { category: "inbound", vertical: "gym" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Thanks for reaching out — gym and fitness payment solutions",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Thanks for contacting Liberty Bancard. We specialize in payment processing for gyms, fitness studios, yoga and Pilates studios, CrossFit boxes, and martial arts schools across Florida.</p>`,
          `<p>Here's what we'll do:</p>`,
          `<ol><li>Audit your recurring billing setup — decline rates, retry logic, card-updater status</li><li>Review your statement for processing overcharges</li><li>Build a proposal showing your current cost vs. our setup</li><li>You decide — no pressure</li></ol>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 2,
        delayHours: 0,
        subject: "Why your gym's decline rate might be higher than it should be",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>The average gym has a monthly membership decline rate of 8-15%. With proper recurring billing configuration, that can drop to 4-7%.</p>`,
          `<p>The difference comes from two things most processors don't include:</p>`,
          `<p><strong>1. Card Updater Service:</strong> Visa and Mastercard issue new card numbers when cards expire or are replaced. A card-updater service automatically updates card-on-file data before the charge attempts — preventing many declines before they happen.</p>`,
          `<p><strong>2. Smart Retry Timing:</strong> Failed charges retry at statistically better times (mid-week, mid-month) when card balances are higher and approvals are more likely.</p>`,
          `<p>We include both in our standard gym processing accounts.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Fix My Decline Rate</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 5,
        delayHours: 0,
        subject: "What other Florida fitness studios are doing to lower processing costs",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Across our gym and fitness studio clients, the most common wins:</p>`,
          `<ul><li>Switching from flat-rate to interchange-plus saves an average of $180/month for a mid-size studio</li><li>Card-updater service recovers 30-50% of charges that would have declined due to expired cards</li><li>Recurring-card interchange rates are 15-20% lower than standard credit card rates</li><li>Text-to-pay for class packs and one-time purchases eliminates transaction friction</li></ul>`,
          `<p>Ready to see what this looks like for {{companyName}}?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get My Custom Quote</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 10,
        delayHours: 0,
        subject: "Last follow-up — one easy step to see your savings",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Final check-in. If you'd like to see your potential savings, just upload your most recent processing statement — we'll have a detailed comparison back to you within 24 hours.</p>`,
          `<p>No commitment. If we can't improve your numbers, we'll tell you that too.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload My Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 10,
        delayHours: 2,
        body: smsBody(`Hi {{firstName}}, last follow-up from Liberty Bancard. Free billing audit for {{companyName}} available anytime — just reply or book: {{custom_values.booking_link}}`),
      },
    ],
  },

  // Gym Account Ops
  {
    name: "V-Gym: Account Management Ops",
    description: "Operational emails for existing gym/fitness merchant clients. Covers quarterly reviews, January surge prep, and upsell prompts.",
    triggerType: "manual",
    triggerConfig: { category: "operations", vertical: "gym" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Quarterly billing health check for {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Time for your quarterly account review. For gyms and fitness studios, recurring billing health is the most important metric — and we want to make sure everything is running optimally.</p>`,
          `<p>Your account manager will review:</p>`,
          `<ul><li>Current membership decline rate vs. benchmark</li><li>Card-updater service activity and recoveries</li><li>Retry logic performance</li><li>Processing rate vs. latest interchange tables</li><li>PCI compliance and terminal status</li></ul>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule Your Review</a></p>`,
          `<p>— Liberty Bancard Account Management</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 45,
        delayHours: 0,
        subject: "January surge prep for {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>January is the busiest new-member acquisition month for gyms. Make sure your payment infrastructure is ready for the influx:</p>`,
          `<ul><li>Test your online membership signup payment flow</li><li>Confirm card-on-file enrollment is active for new joiners</li><li>Verify your card-updater service is processing the post-holiday card replacement surge (many people get new cards in December)</li><li>Set up a front-desk tablet or mobile reader for fast onboarding</li></ul>`,
          `<p>Need anything adjusted before January? Your account manager is on it.</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Contact Your AM</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 90,
        delayHours: 0,
        subject: "Are you selling class packs and add-ons effectively at {{companyName}}?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Beyond memberships, class packs, personal training sessions, retail supplements, and branded merchandise are significant revenue opportunities — but only if checkout is frictionless.</p>`,
          `<p>Our gym clients who set up text-to-pay for class packs and one-time purchases see a 20-30% increase in add-on sales vs. those who only accept cash or card-present payments for extras.</p>`,
          `<p>Want to explore what additional revenue tools might make sense for {{companyName}}?</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Explore Revenue Tools</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // HOTEL / HOSPITALITY / SHORT-TERM RENTAL VERTICAL
  // ═══════════════════════════════════════════════════════

  // Hotel SDR Outbound
  {
    name: "V-Hotel: SDR Outbound Prospecting",
    description: "Cold outreach for hotels, motels, vacation rentals, bed & breakfasts, and short-term rental hosts.",
    triggerType: "manual",
    triggerConfig: { category: "sdr", vertical: "hotel" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Hospitality payment processing — are you on the right pricing model?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Hotels and hospitality businesses have some of the most complex payment needs of any industry: pre-auth holds, deposit collection, incidental charges, online booking payments, and in-person guest transactions — all processed under one merchant account.</p>`,
          `<p>Most hospitality businesses are on generic flat-rate plans that don't account for this complexity — and as a result, they're paying more than they need to on pre-auth holds, keyed-entry transactions, and large-ticket room charges.</p>`,
          `<p>We specialize in hospitality payment setups. Would it be worth a quick call to review {{companyName}}'s current setup?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book a Call</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 0,
        delayHours: 4,
        body: smsBody(`Hi {{firstName}}, Liberty Bancard here. We help hotels and short-term rental operators lower processing costs on room charges, deposits, and OTA payments. Quick chat? {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "Pre-auth holds and keyed-entry transactions — where hotels overpay",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Two areas where hospitality businesses consistently overpay on processing:</p>`,
          `<p><strong>1. Pre-authorization holds:</strong> When you place a hold for incidentals or deposits, many processors charge a fee on the hold AND on the final settlement. Properly structured hospitality accounts avoid the double-charge.</p>`,
          `<p><strong>2. Keyed-entry transactions:</strong> Card-not-present charges (online bookings, phone reservations) carry a higher interchange rate than card-present. But they can still be optimized with proper lodging interchange category codes that most generic processors don't configure.</p>`,
          `<p>We set up every hospitality account with lodging-specific interchange codes and proper hold management — which typically saves 0.3-0.8% on these transaction types.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload My Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 7,
        delayHours: 0,
        subject: "Payment tools built for the guest experience at {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>The right payment setup improves the guest experience at check-in and checkout:</p>`,
          `<ul><li>Mobile terminal for seamless lobby check-in without a fixed front desk</li><li>Text-to-pay for pre-arrival balance collection — guest pays before they arrive, faster check-in</li><li>Digital receipts for corporate guests who need expense documentation</li><li>Multiple card-on-file storage for extended stays</li><li>Next-day deposits — essential for cash flow management in hospitality</li></ul>`,
          `<p>All with transparent pricing, no long-term contracts.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule a Review</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 7,
        delayHours: 4,
        body: smsBody(`Hi {{firstName}}, checking in from Liberty Bancard. Did the lodging interchange info resonate? Happy to do a free hospitality payment audit for {{companyName}} anytime. {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 6,
        actionType: "email",
        delayDays: 14,
        delayHours: 0,
        subject: "Last note from Liberty Bancard — {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Last message from me — I don't want to overstay my welcome.</p>`,
          `<p>If {{companyName}} ever wants to optimize lodging interchange codes, pre-auth holds, or keyed-entry transaction costs, we're here. Free audit, no commitment.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get My Free Analysis</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 7,
        actionType: "sms",
        delayDays: 14,
        delayHours: 4,
        body: smsBody(`{{firstName}}, last message from Liberty Bancard. Free hospitality processing audit available anytime — just reply or book: {{custom_values.booking_link}}\n— Liberty Bancard`),
      },
    ],
  },

  // Hotel Inbound Nurture
  {
    name: "V-Hotel: Inbound Lead Nurture",
    description: "Nurture sequence for hotel and hospitality leads who submitted a form or requested info.",
    triggerType: "form_submission",
    triggerConfig: { category: "inbound", vertical: "hotel" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Thanks for reaching out — hospitality payment solutions",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Thanks for connecting with Liberty Bancard. We work with hotels, motels, vacation rental operators, and bed & breakfast owners across Florida to optimize their payment processing.</p>`,
          `<p>Here's how we'll help:</p>`,
          `<ol><li>Review your current statement — including pre-auth hold fees and keyed-entry charges</li><li>Identify lodging-specific interchange savings opportunities</li><li>Recommend the right terminal and payment workflow for your property type</li><li>Build a custom quote — no commitment required</li></ol>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 2,
        delayHours: 0,
        subject: "Lodging interchange codes — why they matter for your property",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Visa and Mastercard have specific interchange categories for lodging businesses — lower rates than standard retail or card-not-present rates, designed for how hotels and rental properties operate.</p>`,
          `<p>To qualify, your merchant account needs to be configured with lodging-specific MCC codes and your transactions need to include lodging-specific data fields (check-in/out dates, room rate, etc.).</p>`,
          `<p>Most generic processors never configure this correctly. We do it as standard for every hospitality client.</p>`,
          `<p>The savings vary by property and volume, but typically range from 0.3-0.8% on eligible transactions — which on a $100,000/month property can mean $300-$800 in monthly savings.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">See My Savings</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 5,
        delayHours: 0,
        subject: "Short-term rental and Airbnb hosts — this is for you too",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>If you're managing vacation rentals or short-term rental properties through Airbnb, VRBO, or direct bookings, we can help with the direct booking payment piece — the revenue stream where you avoid OTA commission fees.</p>`,
          `<p>Our short-term rental setup includes:</p>`,
          `<ul><li>Text-to-pay links for direct booking deposits and balances</li><li>Recurring billing for monthly stays</li><li>Damage deposit pre-auth holds</li><li>Fast deposits — funds available next business day</li></ul>`,
          `<p>If you're growing your direct booking channel, the right payment setup matters.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get a Custom Quote</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 10,
        delayHours: 0,
        subject: "Ready to see your savings? One quick step",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Last follow-up. Uploading your most recent statement takes 2 minutes — and we'll have a detailed hospitality-specific comparison back to you within 24 hours.</p>`,
          `<p>No commitment. If we can't improve your situation, we'll tell you.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload My Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 10,
        delayHours: 2,
        body: smsBody(`Hi {{firstName}}, last follow-up from Liberty Bancard. Happy to audit {{companyName}}'s processing anytime — just reply or book: {{custom_values.booking_link}}`),
      },
    ],
  },

  // Hotel Account Ops
  {
    name: "V-Hotel: Account Management Ops",
    description: "Operational emails for existing hotel/hospitality merchant clients. Covers quarterly reviews, seasonal prep, and upsell prompts.",
    triggerType: "manual",
    triggerConfig: { category: "operations", vertical: "hotel" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Quarterly account review for {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Time for your quarterly hospitality account review. Lodging interchange codes and pre-auth configurations can drift over time — we want to confirm everything is still running optimally.</p>`,
          `<p>Your account manager will review:</p>`,
          `<ul><li>Lodging interchange code accuracy and capture rate</li><li>Pre-authorization hold performance</li><li>Keyed-entry and card-not-present transaction costs</li><li>Terminal firmware and PCI compliance status</li></ul>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule Your Review</a></p>`,
          `<p>— Liberty Bancard Account Management</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 30,
        delayHours: 0,
        subject: "Peak season prep for {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Florida's tourism peak is coming up. Make sure your payment setup is ready for the increase in volume:</p>`,
          `<ul><li>Test all terminals and backup devices</li><li>Confirm pre-auth hold amounts are set correctly for current room rates</li><li>Enable text-to-pay for pre-arrival balance collection</li><li>Verify next-day deposit timing is optimized for your cash flow needs</li><li>Check that corporate card routing is configured for business traveler season</li></ul>`,
          `<p>Your account manager can help with any of these quickly.</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Contact Your AM</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 90,
        delayHours: 0,
        subject: "Growing your direct booking revenue at {{companyName}}?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>If you're working to shift more bookings away from OTAs and toward direct reservations, your payment infrastructure matters. Direct bookings require a seamless payment experience — from deposit collection to checkout.</p>`,
          `<p>We can help {{companyName}} set up:</p>`,
          `<ul><li>Direct booking payment links for your website or social media</li><li>Text-to-pay for pre-arrival balance collection</li><li>Automated deposit and final balance workflows</li><li>Competitive card-not-present rates optimized for lodging</li></ul>`,
          `<p>Interested in growing your direct channel?</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Talk to Your AM</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // LANDSCAPING / LAWN CARE / TREE SERVICE VERTICAL
  // ═══════════════════════════════════════════════════════

  // Landscaping SDR Outbound
  {
    name: "V-Landscaping: SDR Outbound Prospecting",
    description: "Cold outreach for landscaping companies, lawn care services, tree services, and irrigation contractors.",
    triggerType: "manual",
    triggerConfig: { category: "sdr", vertical: "landscaping" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Lawn and landscaping businesses — are you still chasing checks?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>I work with landscaping and lawn care companies across Florida, and the most common payment challenge I hear is still collecting payment after the job. Checks that don't show up, clients who forget to pull cash — it costs real time and money.</p>`,
          `<p>At Liberty Bancard, we help landscaping businesses collect faster with mobile readers, text-to-pay links, and recurring billing for maintenance contracts — all at rates that are consistently 15-25% lower than most processors charge.</p>`,
          `<p>Would it be worth a quick call to see how {{companyName}} is set up?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book a Free Call</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 0,
        delayHours: 4,
        body: smsBody(`Hi {{firstName}}, Liberty Bancard here. We help landscaping businesses collect faster with mobile readers, text-to-pay, and recurring billing for maintenance contracts. Lower rates too. Quick chat? {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "Recurring lawn contracts — the smarter way to bill",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>If {{companyName}} has recurring monthly maintenance contracts, you should be using automatic billing — not monthly invoices that require manual collection.</p>`,
          `<p>Our recurring billing setup for landscaping businesses:</p>`,
          `<ul><li>Set up once — charges run automatically on your schedule (weekly, bi-weekly, monthly)</li><li>Card-updater service keeps client card data current without re-asking every year</li><li>Failed payment retry logic to handle declined cards without interrupting service</li><li>Lower recurring-card interchange rates vs. standard credit card rates</li></ul>`,
          `<p>For a company with 50 recurring accounts at $150/month each, switching to automated billing typically recovers 2-4 hours of admin time per month and improves cash flow predictability significantly.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload My Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 7,
        delayHours: 0,
        subject: "Collect payment at the job site — mobile readers for outdoor crews",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Your crews are in the field — your payment setup should be too. Here's what we provide for landscaping and lawn care businesses:</p>`,
          `<ul><li>Mobile card readers that work anywhere with a cell signal</li><li>Text-to-pay links — send a payment link via text when the job is done, client pays from their phone</li><li>Pre-set job estimates that can be approved and paid digitally before work begins</li><li>Next-day deposits — get paid the day after the job, not a week later</li><li>Tap, chip, and swipe support for any card type</li></ul>`,
          `<p>No long-term contracts. Month-to-month with no cancellation fees.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">See Field Payment Options</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 7,
        delayHours: 4,
        body: smsBody(`Hi {{firstName}}, checking in from Liberty Bancard. Did the field payment and recurring billing info resonate? Happy to review {{companyName}}'s setup anytime. {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 6,
        actionType: "email",
        delayDays: 14,
        delayHours: 0,
        subject: "Last note from Liberty Bancard — {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Last message — I'll leave you alone after this.</p>`,
          `<p>If {{companyName}} ever wants to set up text-to-pay for field jobs, automate recurring maintenance billing, or just lower your processing costs, we're here. Free review, no commitment.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get My Free Analysis</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 7,
        actionType: "sms",
        delayDays: 14,
        delayHours: 4,
        body: smsBody(`{{firstName}}, last message from Liberty Bancard. Free landscaping processing review available anytime — just reply or book: {{custom_values.booking_link}}\n— Liberty Bancard`),
      },
    ],
  },

  // Landscaping Inbound Nurture
  {
    name: "V-Landscaping: Inbound Lead Nurture",
    description: "Nurture sequence for landscaping and lawn care leads who submitted a form or requested info.",
    triggerType: "form_submission",
    triggerConfig: { category: "inbound", vertical: "landscaping" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Thanks for reaching out — landscaping payment solutions",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Thanks for contacting Liberty Bancard. We work with landscaping companies, lawn care services, tree services, and irrigation contractors across Florida to improve how they collect payment and what they pay to process it.</p>`,
          `<p>Here's what we'll do:</p>`,
          `<ol><li>Review your current processing setup and statement</li><li>Identify opportunities on recurring maintenance billing and field payment collection</li><li>Show you a clear comparison — current cost vs. our pricing</li><li>You decide — no obligation</li></ol>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 2,
        delayHours: 0,
        subject: "Text-to-pay for landscaping — how it works in the field",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Text-to-pay is one of the highest-impact tools for landscaping businesses. Here's the workflow:</p>`,
          `<ol><li>Job is complete — crew lead texts the client from their phone</li><li>Client receives a secure payment link — pays by card, Apple Pay, or Google Pay from their phone</li><li>Payment confirmed immediately — money in your account next business day</li><li>No invoices to chase, no checks to deposit, no cash to handle on-site</li></ol>`,
          `<p>For businesses doing one-time jobs (tree removal, irrigation installs, clean-ups), this eliminates the biggest friction point in getting paid.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Set Up Text-to-Pay</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 5,
        delayHours: 0,
        subject: "What landscaping businesses save with Liberty Bancard",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Across our landscaping clients, the most common improvements after switching:</p>`,
          `<ul><li>15-25% reduction in monthly processing costs (interchange-plus vs. flat-rate)</li><li>50-70% less time spent chasing payments after jobs (text-to-pay adoption)</li><li>2-4 hours/month saved on billing admin for recurring maintenance accounts</li><li>Improved cash flow — next-day deposits instead of waiting days for card settlements</li></ul>`,
          `<p>Want to see your specific numbers?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get My Custom Quote</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 10,
        delayHours: 0,
        subject: "One easy step to see your savings",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Last follow-up from our side. If you'd like to see what {{companyName}} could save, upload your most recent statement — we'll have a full comparison ready within 24 hours.</p>`,
          `<p>No commitment, no pressure. If we can't improve your numbers, we'll tell you.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload My Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 10,
        delayHours: 2,
        body: smsBody(`Hi {{firstName}}, last follow-up from Liberty Bancard. Free review for {{companyName}} available anytime — just reply or book: {{custom_values.booking_link}}`),
      },
    ],
  },

  // Landscaping Account Ops
  {
    name: "V-Landscaping: Account Management Ops",
    description: "Operational emails for existing landscaping merchant clients. Covers quarterly reviews, seasonal prep, and upsell prompts.",
    triggerType: "manual",
    triggerConfig: { category: "operations", vertical: "landscaping" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Quarterly account review for {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Time for your quarterly check-in. Landscaping businesses often grow their recurring maintenance base each season — and we want to confirm your billing setup scales with you.</p>`,
          `<p>Your account manager will review:</p>`,
          `<ul><li>Recurring billing performance (decline rates, retry success)</li><li>Card-updater service activity</li><li>Mobile reader and text-to-pay adoption</li><li>Processing rate vs. current interchange tables</li><li>PCI compliance status</li></ul>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule Your Review</a></p>`,
          `<p>— Liberty Bancard Account Management</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 30,
        delayHours: 0,
        subject: "Spring season prep for {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Spring is peak growth season for landscaping businesses in Florida. Make sure your payment infrastructure is ready for increased volume:</p>`,
          `<ul><li>Test mobile readers — charge them, test connectivity in the field</li><li>Confirm text-to-pay links are set up and working for one-time jobs</li><li>Verify recurring billing is running correctly for all maintenance contracts</li><li>Add crew members to the mobile payment app if you've hired for the season</li></ul>`,
          `<p>Need extra readers for expanded crews? Your account manager can ship them quickly.</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Contact Your AM</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 90,
        delayHours: 0,
        subject: "Are all your maintenance contracts on automatic billing?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>If any of your recurring maintenance clients are still paying by check or manually-sent invoice, there's a better way. Converting those accounts to automatic card-on-file billing eliminates the chase — clients rarely notice, and you get paid reliably on schedule.</p>`,
          `<p>Want help migrating your remaining manual accounts to automated billing? Your account manager can walk you through the process — it usually takes less than 30 minutes per account batch.</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Automate My Billing</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // CONSTRUCTION / GENERAL CONTRACTORS / TRADES VERTICAL
  // ═══════════════════════════════════════════════════════

  // Construction SDR Outbound
  {
    name: "V-Construction: SDR Outbound Prospecting",
    description: "Cold outreach for general contractors, home builders, remodelers, plumbers, electricians, and trade businesses.",
    triggerType: "manual",
    triggerConfig: { category: "sdr", vertical: "construction" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Large contractor payments — are you paying 2.5-3% on every invoice?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>General contractors and trade businesses have a specific problem with payment processing: large B2B transactions. When a client pays a $50,000 project invoice by business card, a flat 2.7% rate costs you $1,350. That's expensive.</p>`,
          `<p>We help contractors structure their merchant accounts to capture commercial and purchasing card interchange rates — which are significantly lower for properly qualified B2B transactions. Combined with transparent interchange-plus pricing, most contractor clients save 20-35% on processing costs.</p>`,
          `<p>Worth a quick call to see if {{companyName}} qualifies?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book a Free Analysis</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 0,
        delayHours: 4,
        body: smsBody(`Hi {{firstName}}, Liberty Bancard here. We help contractors lower processing costs on large B2B invoices and project payments. Significant savings available. Quick chat? {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "Level II/III processing — the secret to lower B2B transaction costs",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>When businesses pay with corporate cards, purchasing cards, or government cards, Visa and Mastercard allow for Level II and Level III interchange rates — significantly lower than standard credit card rates.</p>`,
          `<p>To qualify, the merchant account needs to pass additional data with each transaction (tax amount, PO number, line-item detail). Most generic processors never configure this — so contractors get charged standard commercial rates instead of the much-lower Level II/III rates.</p>`,
          `<p>For a contractor doing $200,000/month in B2B card volume, the difference between standard commercial and Level III rates can be $800-$2,000 per month.</p>`,
          `<p>We configure Level II/III data capture as standard. Send us a statement and we'll show you the impact for {{companyName}}.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload My Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 7,
        delayHours: 0,
        subject: "Payment tools for the job site and the office",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Contractors need payment tools that work in both environments — here's what we provide:</p>`,
          `<p><strong>Field:</strong></p>`,
          `<ul><li>Mobile readers for job site payments and progress billing</li><li>Text-to-pay links for milestone invoices sent from your phone</li><li>Pre-auth holds for material deposits before work begins</li></ul>`,
          `<p><strong>Office:</strong></p>`,
          `<ul><li>Virtual terminal for phone payments and final invoice collection</li><li>Level II/III data entry for commercial and government card transactions</li><li>Detailed reporting for job costing and billing reconciliation</li><li>Next-day deposits to fund materials and payroll without waiting</li></ul>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule a Review</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 7,
        delayHours: 4,
        body: smsBody(`Hi {{firstName}}, checking in from Liberty Bancard. Did the Level II/III and milestone billing info resonate? Happy to review {{companyName}}'s B2B payment setup anytime. {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 6,
        actionType: "email",
        delayDays: 14,
        delayHours: 0,
        subject: "Last note from Liberty Bancard — {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Last message — I'll leave you alone after this.</p>`,
          `<p>If {{companyName}} ever processes significant B2B card volume or wants to explore Level II/III interchange savings, text-to-pay for milestone billing, or just lower processing costs overall, we're here. Free review, no commitment.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get My Free Analysis</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 7,
        actionType: "sms",
        delayDays: 14,
        delayHours: 4,
        body: smsBody(`{{firstName}}, last message from Liberty Bancard. Free contractor payment review available anytime — especially for B2B volume. Reply or book: {{custom_values.booking_link}}\n— Liberty Bancard`),
      },
    ],
  },

  // Construction Inbound Nurture
  {
    name: "V-Construction: Inbound Lead Nurture",
    description: "Nurture sequence for construction and trades leads who submitted a form or requested info.",
    triggerType: "form_submission",
    triggerConfig: { category: "inbound", vertical: "construction" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Thanks for reaching out — contractor payment solutions",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Thanks for contacting Liberty Bancard. We specialize in payment processing for general contractors, builders, remodelers, and trade businesses (plumbing, electrical, HVAC, roofing) across Florida.</p>`,
          `<p>Here's how we'll help {{companyName}}:</p>`,
          `<ol><li>Analyze your statement — with focus on B2B commercial card transactions</li><li>Identify Level II/III processing opportunities for corporate and purchasing card payments</li><li>Recommend field payment tools for job site billing</li><li>Build a custom quote — no commitment required</li></ol>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 2,
        delayHours: 0,
        subject: "Net-30 invoicing vs. card — what's the real cost for contractors?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Many contractors stick with net-30 invoicing to avoid processing fees. But the hidden cost of slow collection often exceeds what you'd pay in processing — especially when you factor in:</p>`,
          `<ul><li>Time spent following up on unpaid invoices (typical contractor: 3-5 hours/month)</li><li>Cash flow gaps when payroll and materials hit before client payments arrive</li><li>Write-offs on uncollected balances</li></ul>`,
          `<p>With text-to-pay and milestone billing via card, contractors often collect 2-3 weeks faster — and processing costs on properly structured B2B transactions are far lower than the standard rates people assume.</p>`,
          `<p>We can show you the real math for your business model.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">See the Numbers</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 5,
        delayHours: 0,
        subject: "How Florida contractors use milestone billing to stay cash-positive",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>The best-capitalized contractors we work with use milestone billing — collecting a portion of the project at defined completion stages rather than waiting for project end.</p>`,
          `<p>With our payment setup, milestone billing is easy:</p>`,
          `<ul><li>Send a text-to-pay link when a milestone is hit</li><li>Client pays from their phone in seconds</li><li>Funds available in your account next business day</li><li>Materials and subcontractors get paid on time</li></ul>`,
          `<p>This single workflow change can eliminate most cash flow problems in a growing construction business.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Learn More</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 10,
        delayHours: 0,
        subject: "One step to see your B2B savings",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Last follow-up from Liberty Bancard. If {{companyName}} does any significant commercial or B2B card volume, the Level II/III savings alone are worth the 10-minute call.</p>`,
          `<p>Upload a recent statement — we'll have a detailed contractor-specific comparison ready within 24 hours. No commitment required.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload My Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 10,
        delayHours: 2,
        body: smsBody(`Hi {{firstName}}, last follow-up from Liberty Bancard. Free B2B payment audit for {{companyName}} available anytime — just reply or book: {{custom_values.booking_link}}`),
      },
    ],
  },

  // Construction Account Ops
  {
    name: "V-Construction: Account Management Ops",
    description: "Operational emails for existing construction/trades merchant clients. Covers quarterly reviews, Level II/III optimization, and upsell prompts.",
    triggerType: "manual",
    triggerConfig: { category: "operations", vertical: "construction" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Quarterly account review for {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Time for your quarterly check-in. As your project mix evolves — more B2B clients, larger ticket sizes — we want to make sure your Level II/III processing is capturing every optimization opportunity.</p>`,
          `<p>Your account manager will review:</p>`,
          `<ul><li>Level II/III data capture rate and accuracy</li><li>Commercial card routing optimization</li><li>Mobile reader and text-to-pay field adoption</li><li>Virtual terminal performance for remote billing</li><li>Processing rate vs. current interchange tables</li></ul>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule Your Review</a></p>`,
          `<p>— Liberty Bancard Account Management</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 45,
        delayHours: 0,
        subject: "New construction season — is your payment setup ready to scale?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Spring and summer bring new projects, new subcontractors, and more milestone payments. Make sure your payment infrastructure scales with you:</p>`,
          `<ul><li>Add crew or project managers to the mobile payment app</li><li>Set up text-to-pay templates for common milestone amounts</li><li>Confirm Level II/III data is being passed on all commercial client invoices</li><li>Check that your virtual terminal is configured for large-ticket keyed entries</li></ul>`,
          `<p>Need to add a user or terminal? Your account manager can set that up quickly.</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Contact Your AM</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 90,
        delayHours: 0,
        subject: "Working with government or municipal clients? Read this.",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Government purchasing cards (GSA SmartPay, state procurement cards) and municipal payment vouchers qualify for Level III interchange rates — the lowest B2B rates available from the card networks.</p>`,
          `<p>If {{companyName}} does any government or municipal contract work and accepts payment by card, we can ensure you're capturing Level III rates on those transactions. This typically represents a 0.5-1.0% savings vs. what you'd pay on a generic commercial card setup.</p>`,
          `<p>Worth a conversation with your account manager to verify your current configuration?</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Talk to Your AM</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // LEGAL / PROFESSIONAL SERVICES VERTICAL
  // ═══════════════════════════════════════════════════════

  // Legal SDR Outbound
  {
    name: "V-Legal: SDR Outbound Prospecting",
    description: "Cold outreach for law firms, CPA firms, insurance agencies, and professional services offices.",
    triggerType: "manual",
    triggerConfig: { category: "sdr", vertical: "legal" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Professional service firms and payment processing — a quick question",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>I work with law firms, CPA practices, and insurance agencies across Florida on payment processing — and most were overpaying before they switched to us.</p>`,
          `<p>Professional services have specific needs: retainer billing, IOLTA trust account compliance, large one-time invoice payments, and in some cases recurring billing for service agreements. Generic processors don't account for any of this.</p>`,
          `<p>We build payment setups specifically for professional service firms — proper trust account separation, compliant retainer billing, and transparent interchange-plus pricing that saves 15-25% vs. most current setups.</p>`,
          `<p>Would it be worth a 10-minute call to see how {{companyName}} is currently set up?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book a Free Call</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 0,
        delayHours: 4,
        body: smsBody(`Hi {{firstName}}, Liberty Bancard here. We help law firms, CPAs, and professional service firms lower processing costs on retainers and invoices — with IOLTA-compliant account structures. Quick chat? {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "IOLTA trust accounts and card payments — the compliance piece most firms miss",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>For law firms that accept retainer payments, IOLTA compliance is non-negotiable. Card processing fees cannot be deducted from client trust funds — which means the processing fee structure and fund flow must be set up correctly from the start.</p>`,
          `<p>Most generic processors don't understand this. We specialize in law firm merchant accounts that:</p>`,
          `<ul><li>Properly separate operating and trust account deposits</li><li>Ensure processing fees are deducted from operating funds, not client trust funds</li><li>Provide clear transaction records for trust account reconciliation</li><li>Support both retainer deposits and earned-fee collections</li></ul>`,
          `<p>This isn't just a nice-to-have — it's an ethics compliance requirement in Florida. We set it up right the first time.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Review My Setup</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 7,
        delayHours: 0,
        subject: "Client payment experience matters for retention — here's how we help",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>For professional service firms, the payment experience reflects on your practice. Here's what our clients appreciate:</p>`,
          `<ul><li>Text-to-pay for invoice balances — clients pay from their phone without a login or portal friction</li><li>Secure card-on-file for recurring service agreements or subscription-based billing</li><li>Virtual terminal for phone payments from clients who prefer to call in</li><li>Digital receipts with your firm's branding</li><li>Next-day deposits — no waiting for large invoice payments to clear</li></ul>`,
          `<p>All with transparent pricing. No bundled rates, no mystery fees on your monthly statement.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule a Review</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 7,
        delayHours: 4,
        body: smsBody(`Hi {{firstName}}, checking in from Liberty Bancard. Did the IOLTA compliance and invoice billing info resonate? Happy to review {{companyName}}'s setup anytime. {{custom_values.booking_link}}`),
      },
      {
        stepOrder: 6,
        actionType: "email",
        delayDays: 14,
        delayHours: 0,
        subject: "Last note from Liberty Bancard — {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Last message — I won't keep filling your inbox.</p>`,
          `<p>If {{companyName}} ever wants to review IOLTA trust account payment compliance, lower invoice processing costs, or set up text-to-pay for faster collection, we're here. Free review, no commitment.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get My Free Analysis</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 7,
        actionType: "sms",
        delayDays: 14,
        delayHours: 4,
        body: smsBody(`{{firstName}}, last message from Liberty Bancard. Free professional services processing review available anytime — just reply or book: {{custom_values.booking_link}}\n— Liberty Bancard`),
      },
    ],
  },

  // Legal Inbound Nurture
  {
    name: "V-Legal: Inbound Lead Nurture",
    description: "Nurture sequence for legal and professional services leads who submitted a form or requested info.",
    triggerType: "form_submission",
    triggerConfig: { category: "inbound", vertical: "legal" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Thanks for reaching out — professional services payment solutions",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Thanks for contacting Liberty Bancard. We work with law firms, CPA practices, insurance agencies, and professional consulting firms across Florida on payment processing.</p>`,
          `<p>Here's our process for professional service firms:</p>`,
          `<ol><li>Review your current processing setup for compliance and cost</li><li>Identify the right account structure for your billing model (retainer, invoice, recurring)</li><li>For law firms: verify IOLTA trust account compliance in your current setup</li><li>Build a custom quote — no commitment required</li></ol>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 2,
        delayHours: 0,
        subject: "Why professional service firms overpay on large invoice payments",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Law firms, CPA practices, and consulting firms often process large one-time invoice payments — $2,000, $5,000, $25,000+. On a flat 2.7% rate, a $10,000 invoice costs $270 in processing fees.</p>`,
          `<p>With interchange-plus pricing and proper commercial card routing, large invoices paid by business cards often qualify for significantly lower rates. For a firm processing $50,000/month in invoices, the difference can be $300-$600 per month.</p>`,
          `<p>We also offer surcharging programs for Florida firms that want to pass processing costs to clients transparently — in full compliance with Florida state law.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">See My Potential Savings</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 5,
        delayHours: 0,
        subject: "How professional service firms improve collection rates with text-to-pay",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Invoice collection is one of the biggest administrative burdens for professional service firms. Text-to-pay changes the dynamic:</p>`,
          `<ul><li>Send a payment link via text or email when the invoice is ready</li><li>Client pays from their phone in seconds — no login, no portal, no friction</li><li>Funds available in your account next business day</li><li>Automated reminders for unpaid invoices (if enabled)</li></ul>`,
          `<p>Firms that switch to text-to-pay for invoice collection typically see 30-50% faster average collection times and significantly less staff time spent on billing follow-up.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Learn More</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 10,
        delayHours: 0,
        subject: "Ready to see your savings? One quick step",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Last follow-up from our side. Uploading your most recent statement takes 2 minutes and we'll have a detailed professional-services-specific comparison ready within 24 hours.</p>`,
          `<p>For law firms, we'll also flag any IOLTA compliance concerns we see in your current setup — at no charge.</p>`,
          `<p>No commitment. No pressure.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload My Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 10,
        delayHours: 2,
        body: smsBody(`Hi {{firstName}}, last follow-up from Liberty Bancard. Free processing review for {{companyName}} available anytime — just reply or book: {{custom_values.booking_link}}`),
      },
    ],
  },

  // Legal Account Ops
  {
    name: "V-Legal: Account Management Ops",
    description: "Operational emails for existing legal/professional services merchant clients. Covers quarterly reviews, IOLTA reminders, and upsell prompts.",
    triggerType: "manual",
    triggerConfig: { category: "operations", vertical: "legal" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Quarterly account review for {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Time for your quarterly review. Professional service firms often see shifts in their billing mix — more recurring clients, larger invoices, new service lines. We want to confirm your pricing and setup are still optimized.</p>`,
          `<p>Your account manager will review:</p>`,
          `<ul><li>For law firms: IOLTA trust account fund flow verification</li><li>Commercial card routing and Level II processing</li><li>Text-to-pay invoice collection adoption and performance</li><li>Processing rate vs. latest interchange tables</li><li>PCI compliance status</li></ul>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule Your Review</a></p>`,
          `<p>— Liberty Bancard Account Management</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 45,
        delayHours: 0,
        subject: "Tax season billing surge — is {{companyName}} ready?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>For CPA firms and legal practices with tax advisory clients, Q1 brings a surge in billing activity. Make sure your payment setup handles the volume:</p>`,
          `<ul><li>Test your text-to-pay links — confirm they're generating correctly</li><li>Verify your virtual terminal is accessible for phone-in payments</li><li>For law firms: confirm trust account deposits are routing correctly</li><li>Check that next-day deposits are set up correctly for cash flow during billing surges</li></ul>`,
          `<p>Your account manager is available to assist with any setup adjustments.</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Contact Your AM</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 90,
        delayHours: 0,
        subject: "Thinking about surcharging at {{companyName}}?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Florida law allows professional service firms to pass card processing fees to clients as a compliant surcharge — effectively eliminating processing costs from your P&L.</p>`,
          `<p>Surcharging is increasingly common in law firms and CPA practices. When implemented correctly with clear client disclosure, most clients understand and accept it — particularly for large invoices where the fee is transparent.</p>`,
          `<p>We can configure a compliant surcharging program for {{companyName}} within your existing account — no new equipment, no disruption to your current workflows.</p>`,
          `<p>Interested in learning more?</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Explore Surcharging</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
    ],
  },
];

export async function seedVerticalCampaigns() {
  try {
    const existingSequences = await storage.getFollowUpSequences();
    const existingNames = new Set(existingSequences.map((s: any) => s.name));

    const toSeed = VERTICAL_SEQUENCES.filter(seq => !existingNames.has(seq.name));
    if (toSeed.length === 0) {
      console.log(`[Seed] All ${VERTICAL_SEQUENCES.length} vertical campaign sequences already exist, skipping.`);
      return;
    }

    console.log(`[Seed] Seeding ${toSeed.length} vertical campaign sequences...`);

    for (const seq of toSeed) {
      const created = await storage.createFollowUpSequence({
        name: seq.name,
        description: seq.description,
        triggerType: seq.triggerType,
        triggerConfig: seq.triggerConfig,
        totalSteps: seq.steps.length,
        status: "active",
      });

      for (const step of seq.steps) {
        await storage.createSequenceStep({
          sequenceId: created.id,
          stepOrder: step.stepOrder,
          actionType: step.actionType,
          delayDays: step.delayDays,
          delayHours: step.delayHours,
          subject: step.subject || null,
          body: step.body || null,
          templateId: null,
          config: step.config || null,
        });
      }

      console.log(`[Seed] Created vertical sequence: "${seq.name}" (${seq.steps.length} steps)`);
    }

    console.log(`[Seed] All ${toSeed.length} vertical campaign sequences seeded.`);
  } catch (error) {
    console.error("[Seed] Error seeding vertical campaigns:", error);
  }
}
