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

const SALES_CALENDAR = "https://api.leadconnectorhq.com/widget/bookings/libertybancard";
const AM_CALENDAR = "https://api.leadconnectorhq.com/widget/booking/kBRoNz5XoTpddupMQg0c";

const COMPLIANCE_FOOTER = `<p style="font-size:11px;color:#888;margin-top:24px;">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>`;

function emailBody(paragraphs: string[]): string {
  return paragraphs.join("") + COMPLIANCE_FOOTER;
}

function smsBody(text: string): string {
  return text.trim();
}

const SEQUENCES: SequenceSeed[] = [
  // ═══════════════════════════════════════════════════════
  // 1) SWITCH & SAVE — STATEMENT AUDIT (7 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "1. Switch & Save — Statement Audit",
    description: "Get merchants to request a statement review and pricing call. Targets merchants who visited pricing page or expressed interest in fees.",
    triggerType: "manual",
    triggerConfig: { category: "sales", vertical: "all" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Most merchants are overpaying — here's how to check",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Most business owners don't realize this, but payment processors often hide fees in places no one explains clearly.</p>`,
          `<p>We review merchant statements every day and typically find 10-30% in unnecessary costs — sometimes more.</p>`,
          `<p>If you'd like, we'll:</p>`,
          `<ul><li>Review your current statement</li><li>Show you exactly where fees are hiding</li><li>Tell you whether switching would actually save you money</li></ul>`,
          `<p>No pressure. Even if your setup is good, we'll tell you.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload a Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 0,
        delayHours: 1,
        body: smsBody(`Hey {{firstName}}, Liberty Bancard here. We can usually find hidden processing fees in under 10 minutes. Want us to review your statement?\n— Liberty Bancard`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "Where processors usually hide extra fees",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Here's where we most often find overcharges:</p>`,
          `<ul><li>Downgraded transactions</li><li>Marked-up interchange</li><li>Junk "non-qualified" rates</li><li>Batch and compliance fees no one explains</li></ul>`,
          `<p>Most merchants never see these clearly — until we break them out line by line.</p>`,
          `<p>If you want a clean breakdown of what you're paying and why:</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Upload a Statement</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "sms",
        delayDays: 5,
        delayHours: 0,
        body: smsBody(`Quick check-in — still curious if you're overpaying on processing? Happy to take a look even if you don't switch.\n— Liberty Bancard`),
      },
      {
        stepOrder: 5,
        actionType: "email",
        delayDays: 7,
        delayHours: 0,
        subject: "No obligation — just clarity",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>This isn't a sales trick. It's just transparency.</p>`,
          `<p>If your pricing is fair, we'll say so. If it isn't, we'll show you how to fix it.</p>`,
          `<p>Either way, you'll understand your processing costs better than 99% of merchants.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get Your Free Review</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // 2) PAYMENT STACK 101 — EDUCATION (4 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "2. Payment Stack 101 — Education",
    description: "Build trust with new or early-stage merchants by educating them on payment infrastructure and recommending the right setup.",
    triggerType: "manual",
    triggerConfig: { category: "education", vertical: "all" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Terminal, POS, gateway — what actually matters",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Payment processing feels confusing because no one explains the pieces clearly.</p>`,
          `<p>Quick breakdown:</p>`,
          `<ul><li><strong>Processor:</strong> moves money</li><li><strong>Terminal/POS:</strong> takes the payment</li><li><strong>Gateway:</strong> routes online transactions</li><li><strong>Bank:</strong> settles funds</li></ul>`,
          `<p>Most problems happen when these don't match your business model.</p>`,
          `<p>If you want, tell us how you take payments and we'll recommend the cleanest setup.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get a Recommendation</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 1,
        delayHours: 0,
        body: smsBody(`Processing setups confuse almost everyone at first. If you want a simple recommendation, we've got you.\n— Liberty Bancard`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 4,
        delayHours: 0,
        subject: "The wrong setup costs more than higher rates",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>We see merchants with "low rates" losing money because:</p>`,
          `<ul><li>They're using the wrong hardware</li><li>Transactions downgrade</li><li>Refunds and disputes are mishandled</li></ul>`,
          `<p>The right setup often matters more than the rate itself.</p>`,
          `<p>If you want clarity, we'll map the best stack for your business.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get Your Stack Recommendation</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "sms",
        delayDays: 6,
        delayHours: 0,
        body: smsBody(`Tell us if you're in-person, mobile, online, or mixed — we'll point you in the right direction.\n— Liberty Bancard`),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // 3) FAST APPROVAL — APPLICATION COMPLETION (4 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "3. Fast Approval — Application Completion",
    description: "Reduce friction and drive application completion for merchants who started but didn't finish their application.",
    triggerType: "manual",
    triggerConfig: { category: "onboarding", vertical: "all" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "You're almost approved",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>You're close — we just need a few final details to complete your application.</p>`,
          `<p>Once submitted, most approvals take minutes, not days.</p>`,
          `<p>If you want, we can review it before it goes in to avoid delays.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Finish Your Application</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 1,
        delayHours: 0,
        body: smsBody(`Hey {{firstName}} — saw you started your app. Want help finishing it so approval goes fast?\n— Liberty Bancard`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "Avoid approval delays",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Three things that slow approvals:</p>`,
          `<ul><li>Inaccurate monthly volume</li><li>Missing bank info</li><li>Mismatch between business type and activity</li></ul>`,
          `<p>We're happy to double-check everything before submission.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Complete Your App</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "sms",
        delayDays: 4,
        delayHours: 0,
        body: smsBody(`Happy to sanity-check your application before it's submitted. Just reply HELP if you want us to review it.\n— Liberty Bancard`),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // 4) TRUST BUILDER — AUTHORITY (6 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "4. Trust Builder — Authority Sequence",
    description: "Overcome skepticism from merchants who have been burned before. Builds trust through transparency, education, and no-pressure offers.",
    triggerType: "manual",
    triggerConfig: { category: "sales", vertical: "all" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "How to spot sketchy processing offers",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>If you've been burned by a processor before, you're not alone.</p>`,
          `<p>Here are the red flags we tell merchants to watch for:</p>`,
          `<ul><li>Rates that seem too good to be true (they usually are)</li><li>"Guaranteed savings" without reviewing your statement</li><li>Long-term contracts with early termination fees</li><li>Equipment leases disguised as "free" terminals</li></ul>`,
          `<p>We believe in transparency — that's why we review your actual statement before making any recommendations.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get a No-Obligation Review</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 1,
        delayHours: 0,
        body: smsBody(`Totally fair if you're cautious — a lot of merchants get burned by processors. We're happy to walk you through pricing and contracts with zero pressure.\n— Liberty Bancard`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "What 'rate baiting' looks like",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>"Rate baiting" is when a processor advertises a low rate but makes up the difference with:</p>`,
          `<ul><li>Monthly fees you didn't expect</li><li>PCI non-compliance charges</li><li>Batch fees, statement fees, regulatory fees</li><li>Downgrades on most of your transactions</li></ul>`,
          `<p>The advertised rate is almost never what you actually pay. We show you the <em>effective</em> rate — what you're truly paying as a percentage of sales.</p>`,
          `<p>If you want, we can review your current setup and tell you if it's actually decent. No pitch if it is.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Review My Setup</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "sms",
        delayDays: 5,
        delayHours: 0,
        body: smsBody(`If you want, we can review your current setup and tell you if it's actually decent. No pitch if it is.\n— Liberty Bancard`),
      },
      {
        stepOrder: 5,
        actionType: "email",
        delayDays: 7,
        delayHours: 0,
        subject: "Funding holds explained (what triggers them)",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>One of the scariest things for merchants: unexpected funding holds.</p>`,
          `<p>Here's what usually triggers them:</p>`,
          `<ul><li>Sudden volume spikes</li><li>High average ticket jumps</li><li>Excessive refund ratios</li><li>Chargeback ratio above threshold</li></ul>`,
          `<p>The good news: most holds are avoidable with the right setup and communication with your processor.</p>`,
          `<p>We help our merchants stay ahead of this. If you want a quick risk assessment:</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get a Risk Assessment</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 6,
        actionType: "email",
        delayDays: 10,
        delayHours: 0,
        subject: "Get a no-obligation review",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>We've helped merchants escape bad processing situations — locked contracts, hidden fees, unreliable funding.</p>`,
          `<p>If any of that sounds familiar, we're happy to take a look. No pitch, no pressure.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get a No-Obligation Review</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // 5) CHARGEBACK DEFENSE (6 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "5. Chargeback Defense",
    description: "Convert high-risk or high-dispute merchants by educating them on chargeback prevention, representment, and fraud vs friendly fraud.",
    triggerType: "manual",
    triggerConfig: { category: "risk", vertical: "all" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Chargebacks cost more than fees — here's why",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Every chargeback costs you more than the transaction amount:</p>`,
          `<ul><li>The sale amount (gone)</li><li>Chargeback fee ($15-$100 per incident)</li><li>Higher risk score = higher rates over time</li><li>Potential account termination if ratio exceeds 1%</li></ul>`,
          `<p>The real cost of chargebacks is 2-3x what most merchants realize.</p>`,
          `<p>Want a quick look at how exposed your business might be?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Free Chargeback Risk Score</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 1,
        delayHours: 0,
        body: smsBody(`Chargebacks add up fast — not just fees, but higher risk scores too. Want a quick look at how exposed your business might be?\n— Liberty Bancard`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "5 prevention levers most merchants miss",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Here are 5 things you can do today to reduce chargebacks:</p>`,
          `<ol><li><strong>Clear descriptors:</strong> Make sure customers recognize your business name on their statement</li><li><strong>Better receipts:</strong> Include return policy, terms, and contact info</li><li><strong>AVS + CVV:</strong> Always collect for card-not-present transactions</li><li><strong>Signed authorizations:</strong> Especially for deposits and recurring</li><li><strong>Fast refunds:</strong> Process refunds before customers file disputes</li></ol>`,
          `<p>A few small changes can cut disputes significantly.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get Prevention Help</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 5,
        delayHours: 0,
        subject: "Fraud vs friendly fraud — the difference matters",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Not all chargebacks are actual fraud:</p>`,
          `<ul><li><strong>True fraud:</strong> Stolen card, merchant never sees the customer</li><li><strong>Friendly fraud:</strong> Customer received the service but disputes anyway</li></ul>`,
          `<p>Friendly fraud is preventable with better documentation, policies, and receipts — and it's more common than you think.</p>`,
          `<p>We'll show you exactly what to adjust for your business type.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book a Review</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 7,
        delayHours: 0,
        body: smsBody(`A few small changes (receipts, descriptors, policies) can cut disputes a lot. We'll show you exactly what to adjust.\n— Liberty Bancard`),
      },
      {
        stepOrder: 6,
        actionType: "email",
        delayDays: 10,
        delayHours: 0,
        subject: "Your free chargeback risk score",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>We offer a free chargeback risk assessment that covers:</p>`,
          `<ul><li>Your current dispute ratio</li><li>Descriptor clarity</li><li>Receipt and policy gaps</li><li>Prevention tools you could add</li></ul>`,
          `<p>It takes 10 minutes and could save you thousands.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get Your Risk Score</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // 6) FUNDING SPEED (4 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "6. Funding Speed & Reliability",
    description: "Sell reliability and cashflow control. Addresses merchants frustrated with unpredictable funding and reserve holds.",
    triggerType: "manual",
    triggerConfig: { category: "sales", vertical: "all" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Funding timelines: what's realistic (and what's hype)",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>One of the biggest frustrations we hear from merchants: random funding delays.</p>`,
          `<p>Here's the reality:</p>`,
          `<ul><li><strong>Standard funding:</strong> 1-2 business days for most merchants</li><li><strong>Same-day funding:</strong> Available for qualifying merchants</li><li><strong>Weekend/holiday:</strong> Batches process but banks don't settle until next business day</li></ul>`,
          `<p>We focus on predictable funding, not surprises. Want to see your options?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">See Your Funding Options</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 1,
        delayHours: 0,
        body: smsBody(`One of the biggest frustrations we hear: random funding delays. We focus on predictable funding, not surprises. Want to see your options?\n— Liberty Bancard`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 4,
        delayHours: 0,
        subject: "What causes reserves and holds (and how to avoid them)",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Funding reserves and holds usually happen because:</p>`,
          `<ul><li>Processing volume suddenly spikes without notice</li><li>Average ticket size jumps significantly</li><li>Refund or chargeback ratio is too high</li><li>Business type or activity doesn't match the application</li></ul>`,
          `<p>Most of these are avoidable with proper setup and communication with your processor.</p>`,
          `<p>We help merchants stay ahead of holds — not scramble to fix them.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get a Cashflow Checkup</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "sms",
        delayDays: 6,
        delayHours: 0,
        body: smsBody(`Same-day or next-day funding depends on setup + volume. Happy to check what you qualify for.\n— Liberty Bancard`),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // 7) POS VS TERMINAL DECISION (4 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "7. POS vs Terminal — Decision Guide",
    description: "Help merchants choose the right hardware path based on their business type and payment workflow.",
    triggerType: "manual",
    triggerConfig: { category: "hardware", vertical: "all" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Terminal vs POS — which is right for your business?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Choosing between a terminal and a full POS depends on your business:</p>`,
          `<ul><li><strong>Smart Terminal:</strong> Great for service businesses, simple retail, and field work. Fast, portable, easy for staff.</li><li><strong>Full POS:</strong> Best for inventory-heavy retail, multi-employee locations, and businesses that need receipt customization + reporting.</li><li><strong>Mobile/Field:</strong> Best for HVAC, plumbing, delivery, or any on-site payments.</li></ul>`,
          `<p>We'll recommend the right tool — not upsell what you don't need.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get the Right Setup</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 1,
        delayHours: 0,
        body: smsBody(`Quick question {{firstName}} — are you mostly in-person, mobile, or a mix?\n— Liberty Bancard`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "The right hardware saves more than a low rate",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>The wrong hardware causes:</p>`,
          `<ul><li>Transaction downgrades (higher fees)</li><li>Slower checkout (frustrated customers)</li><li>Missing features your staff needs</li></ul>`,
          `<p>Based on how you take payments, we'll tell you if a POS or smart terminal makes more sense. No upsell — just the right tool.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get a Setup Recommendation</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "sms",
        delayDays: 5,
        delayHours: 0,
        body: smsBody(`Based on how you take payments, we'll tell you if a POS or smart terminal makes more sense. No upsell — just the right tool.\n— Liberty Bancard`),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // 8) LIBERTY SMART TERMINAL — DEJAVOO QD4 (4 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "8. Liberty Smart Terminal — Product Showcase",
    description: "Drive hardware interest and signups by showcasing the Liberty Smart Terminal (Dejavoo QD4) features and fast setup.",
    triggerType: "manual",
    triggerConfig: { category: "hardware", vertical: "all" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "A smart terminal built for real businesses",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Our Liberty Smart Terminal is designed for merchants who want:</p>`,
          `<ul><li>Fast checkout</li><li>Tap, chip, swipe — all payment types</li><li>Tips, receipts, and cash discount support</li><li>No gimmicks or locked ecosystems</li></ul>`,
          `<p>Most merchants are live within 24-48 hours after approval.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">See If It's Right For You</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 1,
        delayHours: 0,
        body: smsBody(`Our Liberty Smart Terminal is simple, fast, and flexible. Want specs or pricing?\n— Liberty Bancard`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "Set up once. It just works.",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>We handle:</p>`,
          `<ul><li>Terminal configuration</li><li>Support</li><li>Replacements</li><li>Updates</li></ul>`,
          `<p>You focus on running your business.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Claim Your Terminal</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "sms",
        delayDays: 5,
        delayHours: 0,
        body: smsBody(`Most merchants are processing in 1-2 days after approval. Let us know if you want to get started.\n— Liberty Bancard`),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // 9) SURCHARGE / CASH DISCOUNT COMPLIANCE (4 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "9. Surcharge & Cash Discount — Compliance",
    description: "Convert price-sensitive merchants safely with compliant surcharge or cash discount programs, proper signage, receipts, and messaging.",
    triggerType: "manual",
    triggerConfig: { category: "sales", vertical: "all" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "One mistake here can cost you thousands",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Surcharge and cash discount programs are powerful — if done correctly.</p>`,
          `<p>Done wrong, they can:</p>`,
          `<ul><li>Trigger fines from card brands</li><li>Upset customers</li><li>Cause chargebacks</li></ul>`,
          `<p>We'll help you implement it compliantly with proper signage, receipts, and messaging.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">See If You Qualify</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 1,
        delayHours: 0,
        body: smsBody(`Quick heads up — surcharge and cash discount aren't the same legally. Want to make sure yours is compliant?\n— Liberty Bancard`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 4,
        delayHours: 0,
        subject: "Save on fees without customer backlash",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>The key is transparency:</p>`,
          `<ul><li>Clear signage at point of entry</li><li>Correct receipt language</li><li>Proper terminal setup and configuration</li><li>Staff training on how to explain it</li></ul>`,
          `<p>We guide you through all of it — setup, compliance, and customer messaging.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get a Compliant Setup</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "sms",
        delayDays: 6,
        delayHours: 0,
        body: smsBody(`We'll handle setup, compliance, and messaging so there are no surprises.\n— Liberty Bancard`),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // 10) RETAIL — SDR OUTBOUND + DRIP (10 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "10. Retail Merchants — SDR Outbound + Drip",
    description: "Vertical-specific outreach for retail/in-store merchants. Covers checkout speed, downgrades, returns, staff permissions, and equipment.",
    triggerType: "manual",
    triggerConfig: { category: "sdr_outbound", vertical: "retail" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Quick question about payments at {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Quick note — I work with a lot of retail businesses, and most are dealing with some combination of:</p>`,
          `<ul><li>Busy checkout moments</li><li>Returns/exchanges</li><li>Staff turnover</li><li>Confusing processing fees</li></ul>`,
          `<p>We usually help retail merchants:</p>`,
          `<ul><li>Reduce hidden processing costs</li><li>Avoid downgrade fees</li><li>Simplify checkout for staff</li><li>Get more predictable funding</li></ul>`,
          `<p>If you're open to it, I can do a quick 10-minute review and tell you if there's anything worth fixing (even if you don't switch).</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book a 10-Minute Review</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 2,
        delayHours: 0,
        subject: "3 ways retail merchants overpay without realizing it",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Here are the 3 most common cost traps we see in retail:</p>`,
          `<ol><li>Transaction downgrades from card types + terminal setup</li><li>Junk fees buried outside the "rate"</li><li>Return/refund handling that increases costs and disputes</li></ol>`,
          `<p>Most processors never explain this — we break it out line by line.</p>`,
          `<p>If you want clarity, we can walk through your setup or a recent statement.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Walk Through My Setup</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "sms",
        delayDays: 4,
        delayHours: 0,
        body: smsBody(`Quick question {{firstName}} — are you mostly tap/chip at the counter, or do you also take phone orders or invoices?\n— Liberty Bancard`),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 6,
        delayHours: 0,
        subject: "What we fixed for a retail store like yours",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>We recently helped a retail merchant by:</p>`,
          `<ul><li>Cleaning up pricing (eliminated unnecessary downgrades)</li><li>Simplifying returns + receipt settings</li><li>Improving checkout speed for staff</li><li>Making funding more predictable</li></ul>`,
          `<p>If you tell me roughly what your monthly volume looks like, I'll recommend the best setup (terminal vs POS).</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get a Recommendation</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "email",
        delayDays: 8,
        delayHours: 0,
        subject: "Should I close this out?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Totally fine if now isn't the right time — just don't want to keep bugging you.</p>`,
          `<p>Should I:</p>`,
          `<ul><li>Close the loop, or</li><li>Set up a quick 10-minute review?</li></ul>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book 10 Minutes</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 6,
        actionType: "sms",
        delayDays: 10,
        delayHours: 0,
        body: smsBody(`Should I close this out or is it worth a quick 10 minutes?\n${SALES_CALENDAR}\n— Liberty Bancard`),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // 11) AUTO — SDR OUTBOUND + DRIP (6 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "11. Auto Merchants — SDR Outbound + Drip",
    description: "Vertical-specific outreach for auto repair, body shop, towing, and parts businesses. Covers deposits, keyed-in transactions, invoices, and dispute prevention.",
    triggerType: "manual",
    triggerConfig: { category: "sdr_outbound", vertical: "auto" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Quick question about payments at {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Quick note — I work with a lot of auto repair / towing / parts businesses, and payments tend to be different because of:</p>`,
          `<ul><li>Deposits for parts</li><li>Higher-ticket invoices</li><li>Phone/keyed-in transactions</li><li>Disputes when customers "change their mind"</li></ul>`,
          `<p>We usually help auto merchants:</p>`,
          `<ul><li>Set up deposits + partial payments cleanly</li><li>Reduce disputes with better receipts/policies</li><li>Improve approval rates for keyed-in when needed</li><li>Keep funding predictable</li></ul>`,
          `<p>If you're open to it, I can do a 10-minute review and recommend the best setup for your shop.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book a 10-Minute Review</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 2,
        delayHours: 0,
        subject: "3 payment issues we see in auto shops every week",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Here are 3 common issues that quietly cost auto shops money:</p>`,
          `<ol><li>Deposits handled incorrectly (creates disputes + refund problems)</li><li>Keyed-in/MOTO done without guardrails (more risk, more fees)</li><li>Weak invoice documentation (harder to win chargebacks)</li></ol>`,
          `<p>We can show you a cleaner flow that protects the shop and keeps customers happy.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">See a Cleaner Flow</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "sms",
        delayDays: 4,
        delayHours: 0,
        body: smsBody(`Quick one {{firstName}} — do you usually take deposits for parts or do customers pay after the work is done?\n— Liberty Bancard`),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 6,
        delayHours: 0,
        subject: "A cleaner deposit + invoice flow for auto payments",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>We recently helped an auto business by:</p>`,
          `<ul><li>Setting up deposit + partial payment workflow</li><li>Improving dispute prevention (clear docs + receipts)</li><li>Reducing friction for customers paying remotely</li><li>Keeping funding more predictable</li></ul>`,
          `<p>If you tell me roughly your monthly volume range, I'll recommend the simplest setup (terminal + invoice links / text-to-pay where needed).</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get a Recommendation</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "email",
        delayDays: 8,
        delayHours: 0,
        subject: "Worth 10 minutes or should I close this out?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Totally fine if now isn't the right time — just don't want to bug you.</p>`,
          `<p>Should I close the loop, or is it worth a quick 10-minute review?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book 10 Minutes</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 6,
        actionType: "sms",
        delayDays: 10,
        delayHours: 0,
        body: smsBody(`Should I close this out or is it worth a quick 10 minutes?\n${SALES_CALENDAR}\n— Liberty Bancard`),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // 12) MEDICAL — SDR OUTBOUND + DRIP (6 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "12. Medical & Med Spa — SDR Outbound + Drip",
    description: "Vertical-specific outreach for medical clinics, dental offices, and med spas. Covers card-on-file, recurring payments, patient experience, and compliance.",
    triggerType: "manual",
    triggerConfig: { category: "sdr_outbound", vertical: "medical" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Quick question about payments at {{companyName}}",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Quick note — I work with a lot of medical and med spa practices, and payments tend to be different because of:</p>`,
          `<ul><li>Deposits and co-pays</li><li>Treatment packages and memberships</li><li>Card-on-file for recurring visits</li><li>Patient experience and consent requirements</li></ul>`,
          `<p>We usually help medical practices:</p>`,
          `<ul><li>Set up card-on-file and recurring billing correctly</li><li>Prevent friendly fraud with proper consent documentation</li><li>Streamline patient checkout</li><li>Keep funding reliable and predictable</li></ul>`,
          `<p>If you're open to it, I can do a 10-minute review and recommend the best payment workflow for your practice.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book a 10-Minute Review</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 2,
        delayHours: 0,
        subject: "3 payment issues medical practices deal with",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Here are 3 common payment issues we see in medical/med spa practices:</p>`,
          `<ol><li>Card-on-file stored insecurely or without proper consent</li><li>Recurring billing that causes patient disputes</li><li>No-show fees that trigger chargebacks without documentation</li></ol>`,
          `<p>Each of these is fixable with the right setup and policies.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get Setup Help</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "sms",
        delayDays: 4,
        delayHours: 0,
        body: smsBody(`Quick one {{firstName}} — do you run memberships/packages or mostly one-time visits?\n— Liberty Bancard`),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 6,
        delayHours: 0,
        subject: "A patient-friendly payment flow that protects your practice",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>The best medical payment setups include:</p>`,
          `<ul><li>Secure card-on-file with signed consent</li><li>Recurring billing with clear terms</li><li>Clean receipts that reduce disputes</li><li>Remote payment options for deposits and balances</li></ul>`,
          `<p>We'll map this to your exact practice workflow.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get a Workflow Map</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "email",
        delayDays: 8,
        delayHours: 0,
        subject: "Worth a quick review or should I close this out?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Totally fine if now isn't the right time.</p>`,
          `<p>Should I close the loop, or is it worth a quick 10-minute payment workflow review?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book 10 Minutes</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 6,
        actionType: "sms",
        delayDays: 10,
        delayHours: 0,
        body: smsBody(`Should I close this out or is it worth a quick 10 minutes?\n${SALES_CALENDAR}\n— Liberty Bancard`),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // 13) RECURRING BILLING (5 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "13. Recurring Billing — Subscription Merchants",
    description: "Convert subscription and membership merchants by addressing churn, failed payments, card updater, and dunning best practices.",
    triggerType: "manual",
    triggerConfig: { category: "sales", vertical: "subscription" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Why recurring billing fails (and how to fix it)",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>If you run memberships, subscriptions, or recurring services, you know the pain of:</p>`,
          `<ul><li>Expired cards causing failed payments</li><li>Customers disputing charges they forgot about</li><li>High involuntary churn eating into revenue</li></ul>`,
          `<p>The fix isn't just retrying — it's a system:</p>`,
          `<ul><li>Card updater (auto-refresh expired cards)</li><li>Smart retry logic (right timing = higher success)</li><li>Dunning sequences (polite reminders before cancellation)</li></ul>`,
          `<p>We'll set this up the right way for your business.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Set Up Recurring Right</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 1,
        delayHours: 0,
        body: smsBody(`Quick question — are you losing members/subscribers to failed payments? Card updater + smart retries can fix most of that.\n— Liberty Bancard`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "Payment links + invoicing for recurring merchants",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Beyond automatic billing, many recurring merchants benefit from:</p>`,
          `<ul><li>SMS/email payment links for manual collections</li><li>Invoice reminders for outstanding balances</li><li>Cancellation and refund policy templates that prevent disputes</li></ul>`,
          `<p>These tools work alongside recurring billing to recover revenue you'd otherwise lose.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Learn More</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 6,
        delayHours: 0,
        subject: "Chargeback prevention for subscriptions",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Subscription chargebacks are common — and preventable:</p>`,
          `<ul><li>Clear cancellation policies visible before signup</li><li>Confirmation emails for every recurring charge</li><li>Easy cancellation process (reduces disputes significantly)</li><li>Proper descriptors so customers recognize charges</li></ul>`,
          `<p>We'll help you implement each of these.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book a Setup Call</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 8,
        delayHours: 0,
        body: smsBody(`Worth a quick look at your recurring billing setup? We can usually spot issues and improvements in 10 minutes.\n${SALES_CALENDAR}\n— Liberty Bancard`),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // 14) TEXT-TO-PAY / PAYMENT LINKS (4 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "14. Text-to-Pay & Payment Links",
    description: "Capture service and remote payment merchants by showcasing text-to-pay, email invoicing, and payment link capabilities.",
    triggerType: "manual",
    triggerConfig: { category: "sales", vertical: "service" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Get paid without chasing invoices",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>If you're still chasing customers for payment after the work is done, there's a better way:</p>`,
          `<ul><li><strong>Text-to-pay:</strong> Send a payment link via SMS — customer pays in seconds</li><li><strong>Email invoices:</strong> Professional invoices with embedded payment buttons</li><li><strong>Deposits:</strong> Collect before scheduling to reduce no-shows</li></ul>`,
          `<p>No app downloads, no complicated setup for your customers.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Enable Payment Links</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 1,
        delayHours: 0,
        body: smsBody(`Do your customers usually pay on-site or after the job? Text-to-pay can speed up collections significantly.\n— Liberty Bancard`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 3,
        delayHours: 0,
        subject: "Deposits + partial payments made simple",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>The smartest service businesses collect deposits before scheduling and balances upon completion.</p>`,
          `<p>With payment links, you can:</p>`,
          `<ul><li>Send a deposit request via text before the appointment</li><li>Collect remaining balance on-site or remotely</li><li>Keep clean documentation that prevents disputes</li></ul>`,
          `<p>We'll set this up for your workflow.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Set Up Payment Links</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "sms",
        delayDays: 5,
        delayHours: 0,
        body: smsBody(`Want to see how text-to-pay works? Takes 10 minutes to set up and your customers will love it.\n${SALES_CALENDAR}\n— Liberty Bancard`),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // 15) OMNICHANNEL (5 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "15. Omnichannel — Online + In-Person",
    description: "Convert merchants with multiple channels by addressing unified reporting, fraud rules, tokenization, and reconciliation across in-store and online.",
    triggerType: "manual",
    triggerConfig: { category: "sales", vertical: "omnichannel" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Why mismatched systems create reporting chaos",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>If you accept payments both online and in-person, you might be dealing with:</p>`,
          `<ul><li>Two separate reports that don't reconcile</li><li>Different rates for online vs in-store</li><li>Chargebacks harder to track across channels</li><li>Customer profiles that don't sync</li></ul>`,
          `<p>A unified payment setup solves all of this — one dashboard, one settlement, one set of rules.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Build Your Omnichannel Stack</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 2,
        delayHours: 0,
        body: smsBody(`Do you take payments both online and in-person? Most merchants with mixed channels have reporting and reconciliation headaches we can fix.\n— Liberty Bancard`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 4,
        delayHours: 0,
        subject: "Fraud rules for online vs in-store — the differences matter",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Online and in-store transactions have very different risk profiles:</p>`,
          `<ul><li><strong>In-store:</strong> Card-present, lower fraud risk, lower interchange</li><li><strong>Online:</strong> Card-not-present, higher fraud risk, needs AVS/CVV/3DS</li></ul>`,
          `<p>Using the wrong fraud settings wastes money or leaves you exposed.</p>`,
          `<p>We'll configure the right rules for each channel so you're protected without blocking good sales.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get a Channel Review</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 7,
        delayHours: 0,
        subject: "One dashboard for all your payment channels",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Imagine one view showing:</p>`,
          `<ul><li>All in-store and online sales</li><li>Unified settlements and reconciliation</li><li>Customer profiles across channels</li><li>Chargeback tracking in one place</li></ul>`,
          `<p>That's what we set up. Less spreadsheet chaos, more control.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">See How It Works</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 10,
        delayHours: 0,
        body: smsBody(`Worth a quick look at unifying your payment channels? 10 minutes and we'll map the best setup.\n${SALES_CALENDAR}\n— Liberty Bancard`),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // 16) SECURITY & PCI MADE EASY (4 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "16. Security & PCI Compliance — Made Easy",
    description: "Reduce fear and build enterprise trust by demystifying PCI compliance, EMV, tokenization, and fraud prevention.",
    triggerType: "manual",
    triggerConfig: { category: "education", vertical: "all" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "PCI compliance in plain English",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>PCI compliance sounds intimidating, but it's simpler than most processors make it:</p>`,
          `<ul><li><strong>What it is:</strong> A set of security standards for handling card data</li><li><strong>Why it matters:</strong> Non-compliance can mean fines of $5,000-$100,000/month</li><li><strong>What you need to do:</strong> Usually a short annual questionnaire + basic security practices</li></ul>`,
          `<p>We help you stay compliant without the headache.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">PCI Quick-Start</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 2,
        delayHours: 0,
        body: smsBody(`Are you PCI compliant? Most merchants aren't sure. We can check and fix it in minutes — no charge.\n— Liberty Bancard`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 4,
        delayHours: 0,
        subject: "EMV + tokenization + encryption — why they matter",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Modern payment security has three layers:</p>`,
          `<ul><li><strong>EMV chip:</strong> Makes counterfeiting nearly impossible</li><li><strong>Tokenization:</strong> Replaces card numbers with random tokens (so you never store real data)</li><li><strong>Encryption:</strong> Scrambles data in transit so it can't be intercepted</li></ul>`,
          `<p>If your terminal and processor support all three, you're in good shape. If not, you're exposed.</p>`,
          `<p>We'll check your setup and make sure you're protected.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Check My Security Setup</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 7,
        delayHours: 0,
        subject: "Fraud prevention checklist for merchants",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Quick fraud prevention checklist:</p>`,
          `<ul><li>Always use EMV chip (don't rely on swipe)</li><li>Require CVV for all card-not-present transactions</li><li>Enable AVS (Address Verification Service)</li><li>Use clear billing descriptors</li><li>Train staff to spot suspicious transactions</li><li>Review transactions regularly for anomalies</li></ul>`,
          `<p>We help merchants implement every item on this list.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get Security Help</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // 17) CONTRACT ESCAPE / SWITCH HELP (5 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "17. Contract Escape — Switch Help",
    description: "Convert locked-in merchants by addressing contract myths, termination fees, timing, data export, and migration planning.",
    triggerType: "manual",
    triggerConfig: { category: "sales", vertical: "all" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Are you actually locked in? (contract myths)",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Many merchants think they're locked into their processor — but often they're not.</p>`,
          `<p>Here's what's usually true:</p>`,
          `<ul><li>Many contracts have expired and auto-renewed to month-to-month</li><li>Early termination fees are often negotiable or waivable</li><li>Equipment leases are separate from processing agreements</li><li>Some fees are padded beyond what the contract actually states</li></ul>`,
          `<p>We'll review your agreement and tell you exactly what your options are.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Review My Contract</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 2,
        delayHours: 0,
        body: smsBody(`Think you're stuck in a processing contract? Many merchants are actually month-to-month without knowing it. Want us to check?\n— Liberty Bancard`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 4,
        delayHours: 0,
        subject: "How to time a switch with zero downtime",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Switching processors doesn't mean any downtime if you plan it right:</p>`,
          `<ol><li>Get approved with the new processor first (before canceling)</li><li>Schedule the hardware swap during off-hours</li><li>Run parallel for 1-2 days if needed</li><li>Cancel old processor only after new one is confirmed working</li></ol>`,
          `<p>We handle the entire migration — most merchants are live in 24-48 hours.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Plan My Switch</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 7,
        delayHours: 0,
        subject: "Data you should export before switching",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Before switching processors, make sure to save:</p>`,
          `<ul><li>Transaction history (at least 12 months)</li><li>Customer card-on-file data (if applicable)</li><li>Recurring billing schedules</li><li>Chargeback/dispute records</li><li>Tax reporting documents (1099-K)</li></ul>`,
          `<p>We'll walk you through what to keep and help make the transition seamless.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule a Switch Plan Call</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 10,
        delayHours: 0,
        body: smsBody(`Switching processors is easier than most merchants think. Want a quick migration plan? 10 minutes and you'll know exactly what's involved.\n${SALES_CALENDAR}\n— Liberty Bancard`),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // 18) OBJECTION CRUSHER (6 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "18. Objection Crusher — Overcome Hesitation",
    description: "Handle common sales objections at scale: rate skepticism, contract concerns, switching fear, chargebacks, funding holds, and support quality.",
    triggerType: "manual",
    triggerConfig: { category: "sales", vertical: "all" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "\"Your rate seems too low\" — let's explain",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>We hear this a lot: "That rate seems too good to be true."</p>`,
          `<p>Here's how pricing actually works:</p>`,
          `<ul><li><strong>Interchange:</strong> Set by Visa/Mastercard — same for every processor</li><li><strong>Markup:</strong> What YOUR processor adds on top — this is where the difference is</li><li><strong>Junk fees:</strong> Monthly charges, PCI fees, statement fees, etc. — this is where most overpayment happens</li></ul>`,
          `<p>Our rates aren't "too low" — we just don't pad interchange or add unnecessary fees.</p>`,
          `<p>Want to see the difference with your actual numbers?</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Compare With My Numbers</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "email",
        delayDays: 2,
        delayHours: 0,
        subject: "\"I don't want a contract\" — we get it",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Fair concern. Here's how we handle contracts:</p>`,
          `<ul><li>We offer flexible terms — no long-term lock-ins required</li><li>No early termination surprises</li><li>No equipment leases disguised as "free"</li></ul>`,
          `<p>We earn your business every month by being better, not by trapping you.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Learn About Our Terms</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 3,
        actionType: "sms",
        delayDays: 4,
        delayHours: 0,
        body: smsBody(`"My processor is fine" — maybe. But even if you don't switch, a free fee audit shows you where the money goes. Worth 10 minutes?\n— Liberty Bancard`),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 6,
        delayHours: 0,
        subject: "\"Chargebacks are killing me\" — here's help",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>If chargebacks are a problem, the fix usually involves:</p>`,
          `<ul><li>Better receipts and billing descriptors</li><li>Clear refund/cancellation policies</li><li>Documentation that wins representment</li><li>Fraud alerts before disputes are filed</li></ul>`,
          `<p>We'll build a chargeback prevention plan specific to your business type.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get Chargeback Help</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "email",
        delayDays: 8,
        delayHours: 0,
        subject: "\"Support is everything\" — here's how ours works",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>We get it — bad support ruins everything, even good rates.</p>`,
          `<p>Here's what you get with Liberty Bancard:</p>`,
          `<ul><li>Real humans who answer the phone</li><li>Dedicated account management for your business</li><li>Terminal replacements and remote troubleshooting</li><li>Proactive check-ins — we don't wait for problems</li></ul>`,
          `<p>That's the difference between a vendor and a partner.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Apply / Get a Quote</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 6,
        actionType: "sms",
        delayDays: 10,
        delayHours: 0,
        body: smsBody(`Still have questions about switching? Happy to address any concern in a quick 10-minute call — no pressure.\n${SALES_CALENDAR}\n— Liberty Bancard`),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // 19) REACTIVATION — COLD LEAD REVIVAL (5 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "19. Reactivation — Cold Lead Revival",
    description: "Revive leads who went dark. Re-engages with new value offers, savings reports, and vertical-specific case studies.",
    triggerType: "manual",
    triggerConfig: { category: "reactivation", vertical: "all" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Still processing with the same provider?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Quick check-in — we connected a while back about your payment processing.</p>`,
          `<p>A lot has changed since then:</p>`,
          `<ul><li>Interchange rates have shifted</li><li>New compliance requirements are in effect</li><li>Better hardware and funding options are available</li></ul>`,
          `<p>If you're still with the same provider, it might be worth a fresh look to make sure you're not leaving money on the table.</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get a Fresh Review</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 2,
        delayHours: 0,
        body: smsBody(`Hey {{firstName}} — still with the same processor? We have new savings tools that weren't available last time we talked. Worth 10 minutes?\n— Liberty Bancard`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 5,
        delayHours: 0,
        subject: "New savings report available",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>We've updated our analysis tools and can now provide an even more detailed breakdown:</p>`,
          `<ul><li>Effective rate calculation (what you're truly paying)</li><li>Fee-by-fee comparison</li><li>Hardware optimization recommendations</li><li>Funding speed options</li></ul>`,
          `<p>If you want a fresh report, just reply or book time here:</p>`,
          `<p><a href="${SALES_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Get a New Savings Report</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 8,
        delayHours: 0,
        subject: "Here's what we'd change in your setup",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Based on businesses like yours, here's what we typically improve:</p>`,
          `<ul><li>Eliminate junk fees that don't serve you</li><li>Optimize terminal settings to avoid downgrades</li><li>Improve funding speed and predictability</li><li>Add chargeback prevention tools</li></ul>`,
          `<p>Reply with your monthly volume range and we'll give you a specific recommendation.</p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 10,
        delayHours: 0,
        body: smsBody(`Reply with your monthly volume and we'll send you a quick recommendation — no commitment needed.\n— Liberty Bancard`),
      },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // 20) REFERRAL FLYWHEEL — MERCHANT TO MERCHANT (5 steps)
  // ═══════════════════════════════════════════════════════
  {
    name: "20. Referral Flywheel — Merchant to Merchant",
    description: "Turn signed merchants into referrers with referral credits, easy intro templates, and success spotlight stories.",
    triggerType: "manual",
    triggerConfig: { category: "referral", vertical: "all" },
    steps: [
      {
        stepOrder: 1,
        actionType: "email",
        delayDays: 0,
        delayHours: 0,
        subject: "Know a business owner who'd want better payments?",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Thanks for being a Liberty Bancard merchant. We'd love your help reaching other business owners who deserve better processing.</p>`,
          `<p>Our referral program is simple:</p>`,
          `<ul><li>You refer a business owner</li><li>They get the same great service and pricing review</li><li>You receive a referral credit as a thank you</li></ul>`,
          `<p>Who's a great referral?</p>`,
          `<ul><li>Any business owner frustrated with their current processor</li><li>Someone paying too much or dealing with funding issues</li><li>A friend/neighbor/colleague who owns a business</li></ul>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Submit a Referral</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 2,
        actionType: "sms",
        delayDays: 2,
        delayHours: 0,
        body: smsBody(`Know 1-2 business owners who'd want better payments or support? We'll take great care of them — and you get a referral credit.\n— Liberty Bancard`),
      },
      {
        stepOrder: 3,
        actionType: "email",
        delayDays: 5,
        delayHours: 0,
        subject: "Make an intro in 10 seconds",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Here's a quick message you can text or forward to anyone who might benefit:</p>`,
          `<blockquote style="border-left:3px solid #1a56db;padding-left:12px;margin:16px 0;color:#555;">"Hey — I switched my payment processing to Liberty Bancard and it's been great. They did a free statement review and found savings I didn't know about. If you want, they'll do the same for you: ${SALES_CALENDAR}"</blockquote>`,
          `<p>That's it. Takes 10 seconds and could help a fellow business owner.</p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 4,
        actionType: "email",
        delayDays: 10,
        delayHours: 0,
        subject: "Merchant spotlight: how referrals help everyone",
        body: emailBody([
          `<p>Hi {{firstName}},</p>`,
          `<p>Some of our best merchants came through referrals — and the merchants who referred them earned credits along the way.</p>`,
          `<p>It's a win-win:</p>`,
          `<ul><li>Your referral gets better processing and real support</li><li>You get credited for the introduction</li><li>We get to help another business owner</li></ul>`,
          `<p>If anyone comes to mind, just reply with their name and number, or have them reach out directly.</p>`,
          `<p><a href="${AM_CALENDAR}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Submit a Referral</a></p>`,
          `<p>— Liberty Bancard</p>`,
        ]),
      },
      {
        stepOrder: 5,
        actionType: "sms",
        delayDays: 14,
        delayHours: 0,
        body: smsBody(`Quick reminder — if you know a business owner who wants better processing, just send them our way and you'll both benefit.\n${SALES_CALENDAR}\n— Liberty Bancard`),
      },
    ],
  },
];

export async function seedSequences() {
  try {
    const existingSequences = await storage.getFollowUpSequences();
    const existingNames = new Set(existingSequences.map((s: any) => s.name));

    const toSeed = SEQUENCES.filter(seq => !existingNames.has(seq.name));
    if (toSeed.length === 0) {
      console.log(`[Seed] All ${SEQUENCES.length} sequences already exist, skipping seed.`);
      return;
    }

    console.log(`[Seed] Seeding ${toSeed.length} drip campaign sequences (${existingSequences.length} already exist)...`);

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

      console.log(`[Seed] Created sequence: "${seq.name}" (${seq.steps.length} steps)`);
    }

    console.log("[Seed] All 20 sequences seeded successfully.");
  } catch (error) {
    console.error("[Seed] Error seeding sequences:", error);
  }
}
