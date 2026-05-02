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
