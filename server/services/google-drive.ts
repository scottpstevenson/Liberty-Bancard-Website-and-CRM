// Google Drive + Google Docs service
// Uses @replit/connectors-sdk to proxy requests through Replit-managed OAuth
// Integrations: google-drive, google-docs

import { ReplitConnectors } from "@replit/connectors-sdk";

function getConnectors() {
  return new ReplitConnectors();
}

// Training document content definitions
const TRAINING_CONTENT: Record<string, { title: string; content: string }> = {
  Prospecting: {
    title: "Prospecting — Finding & Qualifying Merchants",
    content: `PROSPECTING GUIDE
==================

HOW TO FIND AND QUALIFY MERCHANTS

1. TARGET VERTICALS
-------------------
Focus on high-volume, card-heavy businesses:
- Medical / Dental / Medspa (high average ticket, low chargeback)
- Automotive (service centers, dealers)
- Restaurants (high volume, open to 0% surcharge)
- Home Services (HVAC, plumbing, electric)
- Retail (boutiques, hardware, specialty)

2. LEAD SOURCES
---------------
- Cold calling from Google Maps / Yelp searches by category + city
- Sunbiz entity searches (Florida) — sort by new registrations
- LinkedIn Sales Navigator — filter by employee count 5-50, industry
- Door-to-door in commercial strips and plazas
- Chamber of Commerce member directories
- Referrals from existing merchants

3. COLD CALL OPENERS
--------------------
"Hi, this is [Name] from Liberty Bancard. We help [vertical] businesses
eliminate credit card processing fees entirely — I wanted to take 30 seconds
to see if that's something worth a quick conversation."

Pattern interrupt opener:
"I know you probably get a hundred of these calls — but I promise this one
is different. We have merchants just like you saving $800–$2,000 a month. 
Can I ask what you're currently paying?"

4. LINKEDIN OUTREACH
--------------------
Message template:
"Hi [Name], I work with [vertical] businesses in [city] on eliminating
credit card processing costs. Would it be worth 10 minutes to show you
how it works? No pressure, just a quick numbers conversation."

Connect first, then message after 3 days if they accept.

5. DOOR-TO-DOOR APPROACH
------------------------
- Target strip malls, plazas, commercial corridors
- Best times: Tue–Thu, 10am–12pm and 2pm–4pm (avoid lunch rush)
- Lead with: "We work with several businesses on this block — mind if I
  grab 2 minutes to show you what they're saving?"
- Drop a one-pager if owner isn't available; follow up by phone next day

6. QUALIFYING QUESTIONS
-----------------------
- "What credit card processor do you use right now?"
- "Roughly how much per month do you pay in processing fees?"
- "What's your average ticket size?"
- "Do you process mostly debit, credit, or a mix?"
- "Have you heard of the dual pricing / cash discount program?"

Qualified lead criteria:
✓ Processing $10K+/month
✓ Open to a quick statement review
✓ Decision maker is accessible
✓ Not locked in a long-term contract with heavy ETF`,
  },
  "How to Sell": {
    title: "How to Sell — Value Proposition & Scripts",
    content: `HOW TO SELL — SCRIPTS & OBJECTION HANDLING
==========================================

1. CORE VALUE PROPOSITION
--------------------------
Liberty Bancard gives merchants two powerful options:
A) 0% / Dual Pricing Program — pass processing fees to card users,
   merchants pay $0 in fees
B) Wholesale / Interchange-Plus — lowest possible cost structure,
   full transparency, no bundled pricing tricks

Open with: "We help businesses stop giving away 2–4% of every sale to
their processor. Most of our merchants either pay nothing at all, or cut
their rate in half."

2. PAIN POINT IDENTIFICATION
-----------------------------
Ask open-ended questions:
- "What do you find most frustrating about your current processor?"
- "Do you feel like you know exactly what you're paying and why?"
- "Has your rate gone up in the last year without explanation?"
- "Do you get hit with extra fees at the end of each month?"

Listen for: hidden fees, rate increases, poor service, locked contracts,
not understanding their bill.

3. DUAL PRICING / 0% PITCH
---------------------------
"The 0% program works like this: instead of you absorbing the processing
fee, it's split between cash and card prices — exactly like a gas station.
Card customers pay a small service fee (typically 3.5%), cash customers
get a discount. You collect the same amount either way — the fee just
disappears from your P&L."

Key proof point: "Over 80% of consumers say they would still pay by card
even with a small fee — and many prefer it over carrying cash."

4. HIGH-RISK PITCH
------------------
For merchants declined elsewhere:
"We work with high-risk categories that traditional banks won't touch.
Whether that's nutraceuticals, CBD, firearms, or high-ticket online sales
— we have underwriting relationships that can get you approved."

5. OBJECTION HANDLING
----------------------

Objection: "We've been with our processor for years."
Response: "That loyalty is great — I'm just asking for 5 minutes to show
you what you're actually paying vs. what's possible. You can always say no."

Objection: "I don't want to pass fees to my customers."
Response: "Completely fair. In that case, we can look at our wholesale
program — you'd still likely cut your current rate by 30–50% without
changing anything for your customers."

Objection: "I'm locked in a contract."
Response: "Let's look at your statement first. If the savings are big
enough, breaking a contract almost always makes sense financially — and
sometimes ETFs are negotiable."

Objection: "I need to talk to my partner."
Response: "Of course. Would it help if I put together a short savings
analysis you two could review together? Takes me about 10 minutes."

6. CLOSING SETUP
-----------------
After identifying pain points:
"Based on what you've told me, I think there's a real opportunity here.
Can I get a recent processing statement — just the last 1–2 months? I'll
do a free analysis and come back with exact numbers. No obligation."`,
  },
  "Statement Review": {
    title: "Statement Review — Reading Processing Statements",
    content: `STATEMENT REVIEW GUIDE
======================

STEP-BY-STEP GUIDE TO READING A MERCHANT PROCESSING STATEMENT

1. WHAT YOU'RE LOOKING FOR
---------------------------
Goal: Calculate the merchant's effective rate and identify savings opportunities.

Effective Rate = Total Fees Paid ÷ Total Volume Processed × 100

Example: $1,200 in fees on $45,000 in volume = 2.67% effective rate

2. KEY LINE ITEMS TO FIND
--------------------------
Look for these sections on any statement:

a) PROCESSING VOLUME
   - "Total Sales Volume" or "Gross Sales"
   - Should match their POS or bank deposits

b) INTERCHANGE FEES
   - The actual cost the card networks charge (Visa/MC/Amex)
   - Typically listed as a % + per-transaction rate

c) PROCESSOR MARKUP
   - This is what goes to your competitor — the profit layer on top
   - Look for: "Service Fee," "Margin," "Markup," "Assessment"

d) MONTHLY FEES
   - Statement fee ($10–$25/mo) — often unnecessary
   - PCI compliance fee ($30–$120/yr) — check if merchant is actually compliant
   - Gateway fee — if they use a separate payment gateway
   - Minimum monthly fee — charged if volume is low

e) OTHER RED FLAGS
   - Non-qualified surcharges (NQS) — sign of tiered pricing abuse
   - Batch fees — per-batch settlement charges
   - Annual fee — often hidden
   - Paper statement fee — easy win to eliminate

3. TIERED vs. INTERCHANGE-PLUS
--------------------------------
TIERED PRICING (BAD for merchant):
- Qualified / Mid-Qualified / Non-Qualified tiers
- Processor picks which tier to assign transactions
- Creates hidden markup; non-qual rate often 3.5–4%+
- Sign: no interchange line items, just tier percentages

INTERCHANGE-PLUS (GOOD for merchant):
- Shows exact interchange cost for each card type
- Processor markup is clearly stated separately
- Fully transparent; easy to compare

Most competitors use tiered — this is your main talking point.

4. BUILDING THE SAVINGS CASE
------------------------------
Step 1: Calculate current effective rate
Step 2: Estimate what they'd pay on Liberty's wholesale program
   - Typical wholesale markup: 0.10% + $0.05–0.08/transaction
   - Add average interchange cost for their vertical
Step 3: Show monthly and annual savings

Example Savings Case:
   Current:    $45,000/mo × 2.67% = $1,201/mo
   Liberty:    $45,000/mo × 1.45% = $652/mo
   Savings:    $549/mo = $6,588/year

Step 4: If eligible for 0% — show zero-fee scenario with card price adjustment

5. COMMON STATEMENT FORMATS
-----------------------------
- Fiserv/First Data: Look for "Interchange Summary" section
- TSYS/Global Payments: Tiered pricing breakdown on page 2–3
- Square/Stripe: Simple flat-rate, usually 2.6–2.9% + 30¢
  (Square/Stripe users are easiest to convert — show the math clearly)
- Heartland: Often interchange-plus but with high markup

6. WHAT TO BRING BACK TO THE MERCHANT
---------------------------------------
Prepare a one-page savings proposal showing:
- Their current effective rate
- Projected rate on Liberty program
- Monthly savings
- Annual savings
- Break-even on any transition costs (if applicable)`,
  },
  Closing: {
    title: "Closing — Scripts, Urgency & Follow-Up",
    content: `CLOSING GUIDE
=============

CLOSING SCRIPTS, URGENCY TRIGGERS & FOLLOW-UP CADENCE

1. TRIAL CLOSES (USE THROUGHOUT THE CONVERSATION)
---------------------------------------------------
Trial closes test commitment before the final ask:

"If the numbers make sense, is there any reason you wouldn't want to move forward?"

"Based on everything we've talked about, does this sound like something that
could work for your business?"

"If I can show you saving $600/month with no disruption to your operations,
what would you need to make a decision?"

2. THE SAVINGS CLOSE
---------------------
After presenting the analysis:
"You're currently paying $1,200/month in fees. On our program, you'd pay
roughly $650 — that's $550 back in your pocket every month, or $6,600 a year.
I can get your new terminal programmed and set up within a week. Want to get
the paperwork started today?"

3. THE URGENCY CLOSE
---------------------
"Our current pricing promotion ends [date]. If we can get your application
in this week, you'd lock in the lowest available rate."

"Interchange rates just went up across the board — the sooner we lock in your
wholesale rate, the more you save before the next adjustment."

4. WHEN THEY STALL
-------------------
"I want to think about it."
→ "Absolutely. What's the one thing that's holding you back? Let me address
   that right now so you can think about it with all the information."

"I need to compare other options."
→ "That makes sense. Here's what I'd suggest: let me send you our comparison
   sheet. Most merchants who compare find we're lowest — but if you find
   better, I'll match it or tell you honestly that you should go with them."

"I'm happy with what I have."
→ "I respect that. Can I ask — when did you last have someone actually
   audit your rate? Most merchants we find are paying 2–3% more than they
   need to. Five minutes — just let me show you the math."

5. THE ASSUMPTIVE CLOSE
------------------------
Stop asking "do you want to move forward?" — assume they do.

"Let me grab your application. What's the legal business name on your license?"

"I'll get your terminal shipped overnight. What's the delivery address?"

"Since we're going with the 0% program — do you have a voided check handy
or do you want to send your banking info electronically?"

6. FOLLOW-UP CADENCE AFTER DEMO
---------------------------------
Day 0: Send savings summary + one-pager via email
Day 1: Text: "Did you get a chance to look at the proposal I sent over?"
Day 3: Call: "Just following up on the analysis. Any questions come up?"
Day 7: Email: "Checking back in — the proposal is still on the table."
Day 14: Call with new angle: "One of our restaurants in [city] just saved
         $900/month — made me think of you."
Day 30: Final check-in: "I want to make sure I haven't dropped the ball.
         Is this still something you'd like to revisit?"

7. WHAT NOT TO DO
------------------
✗ Don't chase more than 5–6 times without a response — move on
✗ Don't negotiate rate before the application is submitted
✗ Don't promise approval — underwriting makes that call
✗ Don't skip the trial close — always gauge commitment before the final ask`,
  },
  "Onboarding & Compliance": {
    title: "Onboarding & Compliance — After the Close",
    content: `ONBOARDING & COMPLIANCE GUIDE
==============================

WHAT HAPPENS AFTER SIGNING

1. THE ONBOARDING PROCESS
--------------------------
After the merchant signs the application, the following steps occur:

Step 1 — Document Collection (Day 1–2)
- Signed merchant application
- Voided check (for ACH/deposit setup)
- Copy of government-issued photo ID (owner/signer)
- 3 months of processing statements (if applicable)
- Business license (if required by vertical or volume)

Step 2 — Underwriting Submission (Day 2–3)
- Application submitted to underwriting
- Risk team reviews: credit, volume history, vertical, chargeback rate
- High-risk verticals may require additional documentation

Step 3 — Approval & Setup (Day 3–7)
- Merchant ID (MID) assigned
- Terminal or gateway programmed and shipped
- Test transaction run to confirm setup

Step 4 — Go-Live (Day 7–14)
- Terminal delivered and activated
- First batch processed
- Confirm deposit lands in merchant's bank account

2. MERCHANT EXPECTATIONS (SET THESE UPFRONT)
---------------------------------------------
Be transparent about:
- Timing: "Expect 5–10 business days from application to live"
- Deposits: "Funds typically settle within 1–2 business days"
- Statements: "You'll receive a monthly statement via email/portal"
- Support: "For any issues, call/text me directly or use our support line"

3. PCI COMPLIANCE BASICS
-------------------------
PCI DSS (Payment Card Industry Data Security Standard) applies to ALL merchants.

Merchant levels:
- Level 4 (most small merchants): Self-Assessment Questionnaire (SAQ)
- Level 1–3: Full audit required (high volume)

Key PCI requirements for merchants:
- Never store full card numbers in any system
- Use a PCI-compliant terminal (EMV/chip)
- Complete annual SAQ (questionnaire)
- Scan network quarterly (if applicable)

PCI non-compliance fee: typically $20–$40/month charged by processor
→ Help merchants get compliant to avoid this fee

Common SAQ types:
- SAQ A: Card-not-present, fully outsourced (e-commerce)
- SAQ B: Imprinters or standalone dial-up terminals
- SAQ C-VT: Web-based virtual terminal, no electronic storage
- SAQ D: All other merchants

4. CHARGEBACK PREVENTION
-------------------------
Chargebacks occur when a customer disputes a transaction with their bank.
High chargeback rates (>1%) trigger account reviews and possible termination.

Best practices to share with merchants:
- Always get a signed receipt for high-ticket sales
- Use AVS (Address Verification) for card-not-present
- Have a clear refund/return policy visible at point of sale
- Respond to all disputes within the deadline (typically 7–10 days)
- Document delivery confirmation for shipped goods
- Use clear billing descriptors (what shows on customer's statement)

5. WHAT AGENTS SHOULD DO AFTER GO-LIVE
----------------------------------------
- Check in at day 7: "Is everything working? First deposit come through?"
- Check in at day 30: "How's the new setup treating you?"
- Ask for a referral at 30-day mark when satisfaction is highest
- Flag any volume drops to the support team`,
  },
  "Agent Quick-Start Guide": {
    title: "Agent Quick-Start Guide — Day-One Orientation",
    content: `AGENT QUICK-START GUIDE
========================

DAY-ONE ORIENTATION FOR NEW REPS

1. SYSTEMS ACCESS
------------------
You'll need access to the following tools:

CRM (This System)
- Log in at [your CRM URL]
- Set up your profile and notification preferences
- Your manager will assign you a territory or lead queue

GoHighLevel (GHL)
- Used for email sequences, SMS campaigns, call tracking
- Ask your manager for login credentials
- Connect your GHL calendar for appointment booking

Google Workspace
- Company email: firstname@libertybancardteam.com
- Access to shared Drive folder for templates and collateral

Proposal Tool
- Built into the CRM under Statement Review
- Upload a merchant statement to generate a savings proposal in minutes

2. YOUR FIRST 5 CALLS
----------------------
Before making any calls, review:
✓ Prospecting Guide (what to say when calling cold)
✓ How to Sell Guide (value prop and objection handling)
✓ Statement Review Guide (so you can intelligently discuss their bill)

Your first calls should focus on:
- Introducing yourself and the company
- Asking qualifying questions
- NOT trying to close — your goal is to get a statement or book a follow-up

Script for first call:
"Hi, this is [Name] with Liberty Bancard. We specialize in helping [vertical]
businesses reduce their credit card processing costs. I'm not here to pitch
you today — I just wanted to introduce myself and see if it's worth a 10-minute
conversation about what you're currently paying. Would that be okay?"

3. COMPENSATION STRUCTURE
--------------------------
You earn residual income based on the merchants you bring on.

How it works:
- You earn a % of the gross profit generated by each merchant's processing
- Residuals are paid monthly, typically on the 15th
- The more volume your merchants process, the higher your monthly residual

Residual tiers (example structure):
- Months 1–3: 40% of gross profit
- Months 4–12: 50% of gross profit
- Month 13+: 60% of gross profit (loyalty bonus)

You also earn upfront bonuses for hitting merchant activation targets.
Ask your manager for the current bonus schedule.

4. HOW RESIDUALS WORK
----------------------
Residuals are recurring monthly income from merchants you've signed.

Example:
- You sign a restaurant processing $50,000/month
- Liberty earns $300/month gross profit from that merchant
- You earn 50% = $150/month from that one merchant — forever, as long as they stay

After 12 months with 20 merchants averaging $150/residual each:
= $3,000/month in passive income, growing each month

Keys to growing residuals:
✓ Sign merchants with high volume (restaurants, auto, medical)
✓ Keep merchants happy so they stay (check in monthly)
✓ Ask for referrals from happy merchants
✓ Never stop prospecting — your book of business compounds

5. FIRST WEEK CHECKLIST
------------------------
Day 1:
☐ Complete system access setup
☐ Read all 6 training guides
☐ Shadow a senior rep on 2+ calls

Day 2:
☐ Make your first 10 cold calls
☐ Log all activity in the CRM

Day 3–5:
☐ Aim for 1 statement request or appointment booked
☐ Review a sample processing statement with your manager
☐ Complete your first savings proposal walkthrough

6. RESOURCES & SUPPORT
-----------------------
- Direct manager: Contact your assigned team lead
- Technical support: support@libertybancardteam.com
- Underwriting questions: Run all questions through your manager first
- Marketing materials: Available in the CRM Asset Library
- Competitive intel: Ask your manager for the latest compare sheets

Remember: The reps who succeed are the ones who dial consistently,
follow up relentlessly, and genuinely help merchants understand their savings.`,
  },
};

const TRAINING_CATEGORIES = [
  "Prospecting",
  "How to Sell",
  "Statement Review",
  "Closing",
  "Onboarding & Compliance",
  "Agent Quick-Start Guide",
];

// Helper to check response status and parse JSON, throwing on non-2xx
async function parseJsonOrThrow<T>(resp: Response, context: string): Promise<T> {
  if (!resp.ok) {
    let body = "";
    try { body = await resp.text(); } catch {}
    throw new Error(`Google API error in ${context}: HTTP ${resp.status} — ${body}`);
  }
  return resp.json() as Promise<T>;
}

// Find existing folder by name within a parent
async function findFile(
  connectors: ReplitConnectors,
  name: string,
  mimeType: string,
  parentId?: string
): Promise<string | null> {
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='${mimeType}' and trashed=false${parentId ? ` and '${parentId}' in parents` : ""}`;
  const resp = await connectors.proxy("google-drive", `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
    method: "GET",
  });
  const data = await parseJsonOrThrow<{ files: { id: string; name: string }[] }>(resp, "findFile");
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }
  return null;
}

// Create a Drive folder
async function createFolder(
  connectors: ReplitConnectors,
  name: string,
  parentId?: string
): Promise<string> {
  const body: any = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) body.parents = [parentId];

  const resp = await connectors.proxy("google-drive", "/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJsonOrThrow<{ id: string }>(resp, "createFolder");
  return data.id;
}

// Create a Google Doc with content
async function createDoc(
  connectors: ReplitConnectors,
  title: string,
  parentFolderId: string
): Promise<{ id: string; url: string }> {
  // Create blank doc first
  const createResp = await connectors.proxy("google-docs", "/v1/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const doc = await parseJsonOrThrow<{ documentId: string }>(createResp, "createDoc");
  const docId = doc.documentId;

  // Move the doc into the folder by updating its parents via Drive API
  const moveResp = await connectors.proxy(
    "google-drive",
    `/drive/v3/files/${docId}?addParents=${parentFolderId}&fields=id`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }
  );
  await parseJsonOrThrow(moveResp, "createDoc:moveToFolder");

  return { id: docId, url: `https://docs.google.com/document/d/${docId}/edit` };
}

// Insert text content into a Google Doc
async function insertDocContent(
  connectors: ReplitConnectors,
  docId: string,
  text: string
): Promise<void> {
  const resp = await connectors.proxy("google-docs", `/v1/documents/${docId}:batchUpdate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text,
          },
        },
      ],
    }),
  });
  await parseJsonOrThrow(resp, "insertDocContent");
}

export interface TrainingFolder {
  id: string;
  name: string;
  docId: string;
  docTitle: string;
  docUrl: string;
}

export interface TrainingHubStatus {
  exists: boolean;
  folderId?: string;
  folders?: TrainingFolder[];
}

// Check if the Sales Training Hub already exists
export async function getTrainingHubStatus(): Promise<TrainingHubStatus> {
  const connectors = getConnectors();
  const parentId = await findFile(connectors, "Sales Training Hub", "application/vnd.google-apps.folder");

  if (!parentId) {
    return { exists: false };
  }

  // List subfolders — only recognized categories are included (whitelist for determinism)
  const q = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const resp = await connectors.proxy("google-drive", `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
    method: "GET",
  });
  const data = await parseJsonOrThrow<{ files: { id: string; name: string }[] }>(resp, "getTrainingHubStatus:listFolders");
  const subfolderMap = new Map((data.files || []).map((f) => [f.name, f]));

  const folders: TrainingFolder[] = [];

  // Iterate in TRAINING_CATEGORIES order for deterministic UI rendering
  for (const category of TRAINING_CATEGORIES) {
    const subfolder = subfolderMap.get(category);
    if (!subfolder) continue;

    // Find doc inside subfolder
    const docQ = `'${subfolder.id}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`;
    const docResp = await connectors.proxy("google-drive", `/drive/v3/files?q=${encodeURIComponent(docQ)}&fields=files(id,name)`, {
      method: "GET",
    });
    const docData = await parseJsonOrThrow<{ files: { id: string; name: string }[] }>(docResp, "getTrainingHubStatus:listDocs");
    const docs = docData.files || [];

    if (docs.length > 0) {
      folders.push({
        id: subfolder.id,
        name: subfolder.name,
        docId: docs[0].id,
        docTitle: docs[0].name,
        docUrl: `https://docs.google.com/document/d/${docs[0].id}/edit`,
      });
    } else {
      folders.push({
        id: subfolder.id,
        name: subfolder.name,
        docId: "",
        docTitle: "",
        docUrl: "",
      });
    }
  }

  return { exists: true, folderId: parentId, folders };
}

// Create the full Sales Training Hub structure
export async function createTrainingHub(): Promise<TrainingHubStatus> {
  const connectors = getConnectors();

  // Create or find parent folder
  let parentId = await findFile(connectors, "Sales Training Hub", "application/vnd.google-apps.folder");
  if (!parentId) {
    parentId = await createFolder(connectors, "Sales Training Hub");
  }

  const folders: TrainingFolder[] = [];

  for (const category of TRAINING_CATEGORIES) {
    // Create or find subfolder
    let subfolderId = await findFile(connectors, category, "application/vnd.google-apps.folder", parentId);
    if (!subfolderId) {
      subfolderId = await createFolder(connectors, category, parentId);
    }

    // Check if doc already exists
    let docId: string;
    let docUrl: string;
    const docQ = `'${subfolderId}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`;
    const docResp = await connectors.proxy("google-drive", `/drive/v3/files?q=${encodeURIComponent(docQ)}&fields=files(id,name)`, {
      method: "GET",
    });
    const docData = await parseJsonOrThrow<{ files: { id: string; name: string }[] }>(docResp, "createTrainingHub:listDocs");
    const existingDocs = docData.files || [];

    const content = TRAINING_CONTENT[category];
    if (!content) continue;

    if (existingDocs.length > 0) {
      docId = existingDocs[0].id;
      docUrl = `https://docs.google.com/document/d/${docId}/edit`;
    } else {
      const created = await createDoc(connectors, content.title, subfolderId);
      docId = created.id;
      docUrl = created.url;
      // Insert training content
      await insertDocContent(connectors, docId, content.content);
    }

    folders.push({
      id: subfolderId,
      name: category,
      docId,
      docTitle: content.title,
      docUrl,
    });
  }

  return { exists: true, folderId: parentId, folders };
}
