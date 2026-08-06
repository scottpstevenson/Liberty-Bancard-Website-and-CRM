// Liberty Bancard — Master Business Vault Builder
// Creates the complete folder structure and all 35 production-ready documents in Google Drive.

import { ReplitConnectors } from "@replit/connectors-sdk";

function getConnectors() {
  return new ReplitConnectors();
}

async function parseJsonOrThrow<T>(resp: Response, context: string): Promise<T> {
  if (!resp.ok) {
    let body = "";
    try { body = await resp.text(); } catch {}
    throw new Error(`Google API error in ${context}: HTTP ${resp.status} — ${body}`);
  }
  return resp.json() as Promise<T>;
}

async function findFile(
  connectors: ReplitConnectors,
  name: string,
  mimeType: string,
  parentId?: string
): Promise<string | null> {
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='${mimeType}' and trashed=false${parentId ? ` and '${parentId}' in parents` : ""}`;
  const resp = await connectors.proxy("google-drive", `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, { method: "GET" });
  const data = await parseJsonOrThrow<{ files: { id: string; name: string }[] }>(resp, "findFile");
  return data.files?.length > 0 ? data.files[0].id : null;
}

async function createFolder(connectors: ReplitConnectors, name: string, parentId?: string): Promise<string> {
  const body: any = { name, mimeType: "application/vnd.google-apps.folder" };
  if (parentId) body.parents = [parentId];
  const resp = await connectors.proxy("google-drive", "/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJsonOrThrow<{ id: string }>(resp, "createFolder");
  return data.id;
}

// Create a Google Doc with content using only the Drive API (multipart upload).
// This avoids the google-docs connector entirely — critical when the google-drive
// and google-docs Replit integrations are authed to different Google accounts.
async function createDocWithContent(
  connectors: ReplitConnectors,
  title: string,
  content: string,
  parentFolderId: string
): Promise<{ id: string; url: string }> {
  const BOUNDARY = "lb_vault_boundary_20260502";
  const metadata = JSON.stringify({
    name: title,
    mimeType: "application/vnd.google-apps.document",
    parents: [parentFolderId],
  });
  const body =
    `--${BOUNDARY}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${BOUNDARY}\r\n` +
    `Content-Type: text/plain; charset=UTF-8\r\n\r\n` +
    `${content}\r\n` +
    `--${BOUNDARY}--`;

  const resp = await connectors.proxy(
    "google-drive",
    "/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${BOUNDARY}` },
      body,
    }
  );
  const data = await parseJsonOrThrow<{ id: string }>(resp, "createDocWithContent");
  return { id: data.id, url: `https://docs.google.com/document/d/${data.id}/edit` };
}

async function ensureDoc(
  connectors: ReplitConnectors,
  title: string,
  content: string,
  folderId: string
): Promise<{ id: string; url: string; created: boolean }> {
  const existing = await findFile(connectors, title, "application/vnd.google-apps.document", folderId);
  if (existing) return { id: existing, url: `https://docs.google.com/document/d/${existing}/edit`, created: false };
  const result = await createDocWithContent(connectors, title, content, folderId);
  return { ...result, created: true };
}

async function ensureFolder(connectors: ReplitConnectors, name: string, parentId?: string): Promise<string> {
  const existing = await findFile(connectors, name, "application/vnd.google-apps.folder", parentId);
  if (existing) return existing;
  return createFolder(connectors, name, parentId);
}

// ============================================================
// DOCUMENT CONTENT DEFINITIONS
// ============================================================

const DOCS: Record<string, { title: string; folder: string; content: string }> = {

  // ── FOLDER 01: Brand & Marketing ─────────────────────────────────────────

  brandGuidelines: {
    title: "Brand Guidelines — Liberty Bancard",
    folder: "01",
    content: `LIBERTY BANCARD — BRAND GUIDELINES
====================================
Version 1.0 | Internal Use & Production

────────────────────────────────────
1. BRAND PROMISE
────────────────────────────────────
"We don't sell a rate. We prove your real cost and fix it."

Everything Liberty Bancard produces — from a cold call script to a proposal to a social post — must reflect this promise. Proof first, hype never.

────────────────────────────────────
2. COLOR PALETTE
────────────────────────────────────
Primary Navy (Deep Trust):
  HEX: #1a2744   RGB: 26, 39, 68   Usage: headers, primary buttons, nav

Accent Blue (Action):
  HEX: #2563eb   RGB: 37, 99, 235   Usage: CTAs, links, highlights

Sky Blue (Energy):
  HEX: #0ea5e9   RGB: 14, 165, 233   Usage: hero accents, feature callouts

Emerald (Savings / Proof):
  HEX: #10b981   RGB: 16, 185, 129   Usage: savings numbers, positive results

Neutral Light (Backgrounds):
  HEX: #f0f4f8   RGB: 240, 244, 248   Usage: page backgrounds, card backgrounds

White (Clean Surfaces):
  HEX: #ffffff   Usage: cards, modal surfaces

Red (Alerts / Before State):
  HEX: #ef4444   Usage: "current fees" comparisons, error states

────────────────────────────────────
3. TYPOGRAPHY
────────────────────────────────────
Display / Headlines: Outfit
  - Weights used: 600 (semibold), 700 (bold), 800 (extrabold)
  - Usage: H1, H2, H3 headers; hero headlines; section titles

Body Copy: DM Sans
  - Weights used: 400 (regular), 500 (medium), 600 (semibold)
  - Usage: all body text, form labels, captions, footnotes

Type Scale (approximate):
  H1 (hero):      48–64px / Outfit Bold
  H2 (section):   32–40px / Outfit SemiBold
  H3 (card):      20–24px / Outfit SemiBold
  Body:           16–18px / DM Sans Regular
  Small:          12–14px / DM Sans Regular
  Micro/legal:    10–12px / DM Sans Regular

Line height: 1.6 for body text, 1.2–1.3 for headlines.

────────────────────────────────────
4. LOGO USAGE RULES
────────────────────────────────────
Primary logo: Liberty Bancard wordmark on navy background
Reversed logo: white wordmark on navy or dark photo backgrounds
Monochrome: navy wordmark only on light backgrounds

DO:
  ✓ Use the logo in its approved color combinations
  ✓ Maintain minimum clear space equal to the height of the "L" around all sides
  ✓ Scale proportionally from approved files

DO NOT:
  ✗ Stretch, distort, or rotate the logo
  ✗ Place the logo on busy backgrounds without sufficient contrast
  ✗ Recreate the logo in a different typeface
  ✗ Display manufacturer device logos (Dejavoo, PAX, Clover) in marketing imagery unless required by partner agreement
  ✗ Use "Liberty Bancard Smart Terminal" imagery that shows another brand's hardware logos

────────────────────────────────────
5. BRAND VOICE
────────────────────────────────────
Core Voice Attributes:
  Transparent:     We show the math. We don't hide behind jargon.
  Proof-First:     Claims backed by data, comparisons, or real savings numbers.
  Professional:    Knowledgeable without being condescending.
  Human:           Direct, conversational — never robotic or stuffy.
  Confident:       We know what we do is better. We don't need to shout about it.

Tone Variations by Context:
  Cold outreach email:   Respectful, brief, curiosity-provoking. No hype.
  Proposal:              Precise, numerical, side-by-side. The math does the talking.
  Support response:      Warm, direct, action-oriented. Acknowledge, explain, resolve.
  Social media:          Educational, slightly informal, proof-backed. Never salesy.
  Legal/compliance:      Plain English. Clear, not intimidating.

────────────────────────────────────
6. TONE DO/DON'T EXAMPLES
────────────────────────────────────
WRITING ABOUT RATES
  ✗ DON'T: "We offer the lowest rates in the industry!"
  ✓ DO:    "We show you your real effective rate and where it's coming from — then give you apples-to-apples options."

WRITING ABOUT 0% PROCESSING
  ✗ DON'T: "Pay nothing to accept credit cards!"
  ✓ DO:    "Liberty Zero shifts the processing cost to card-paying customers through a disclosed service fee — fully compliant with card brand rules. Eligibility, state law, and underwriting apply."

WRITING ABOUT SAVINGS
  ✗ DON'T: "Save thousands every year with Liberty Bancard!"
  ✓ DO:    "After reviewing your statement, we identified $847/month in avoidable fees. Here's exactly where."

WRITING ABOUT SPEED
  ✗ DON'T: "Next-day funding guaranteed!"
  ✓ DO:    "Next-day funding options may be available for qualified merchants. Eligibility and cutoff times apply."

WRITING ABOUT COMPETITORS
  ✗ DON'T: "Don't be ripped off by Square or Stripe!"
  ✓ DO:    "Square's 2.6% flat rate looks simple. For a restaurant processing $50K/month, that's $1,300/month in fees. On our interchange-plus wholesale program, the same merchant typically pays $650–750. Here's the math."

────────────────────────────────────
7. REQUIRED COMPLIANCE LANGUAGE
────────────────────────────────────
Any document, email, or web content that mentions:
  • Rates or savings → append: "No savings claims without statement review."
  • 0% processing / Liberty Zero → append: "Eligibility, underwriting, card brand rules, and applicable laws apply."
  • Next-day funding → append: "Eligibility, cutoff times, and bank schedule apply."
  • 'fastest-growing' → use "one of the fastest-growing" unless substantiation exists.

Global footer disclaimer (verbatim for any PDF or printable collateral):
  "Disclosures: Liberty Bancard provides payment processing and related services. Pricing, program eligibility, funding speed, and equipment offers vary by merchant profile and are subject to underwriting approval. 0% processing refers to compliant cash discount or surcharging programs where permitted. PCI compliance is the merchant's responsibility. We do not provide legal or tax advice."

────────────────────────────────────
8. IMAGERY GUIDELINES
────────────────────────────────────
Approved imagery styles:
  ✓ Hands at a POS terminal — real, unposed moments preferred
  ✓ Business owners (diverse, professional) reviewing paperwork or a tablet
  ✓ Clean, professional environments (restaurant, clinic, retail counter)
  ✓ Data/graph visualizations (fintech aesthetic — dark background, colored numbers)

Avoid:
  ✗ Stock photo smiling office workers with no context
  ✗ Generic "handshake" or "agreement" imagery
  ✗ Images showing card numbers or actual PCI-sensitive data
  ✗ Imagery that looks like competing processors' brand visual styles`,
  },

  companyOverview: {
    title: "Company Overview & Value Proposition",
    folder: "01",
    content: `LIBERTY BANCARD — COMPANY OVERVIEW & VALUE PROPOSITION
=======================================================
Suitable for sharing with prospective merchants, partners, and new team members.

────────────────────────────────────
WHO WE ARE
────────────────────────────────────
Liberty Bancard is an independent payment processing company headquartered in Fort Lauderdale, Florida. Founded in 2014, we have served 5,000+ merchants and processed $2 billion+ in annual card volume across every major business vertical in the United States.

We are not a bank. We are not a fintech startup. We are a payments specialist — built by merchants, for merchants — with one foundational belief: transparency creates loyalty, and loyalty creates growth.

Our registered ISO/MSP status means we have direct relationships with card-acquiring banks and can offer wholesale interchange rates that retail processors cannot. We pass those savings directly to our merchants with full, line-item documentation.

────────────────────────────────────
THE PROBLEM WE SOLVE
────────────────────────────────────
Most business owners have no idea what they actually pay to accept credit cards. They were quoted a rate during signup — maybe 1.8% or 2.4% — but their actual effective rate (total fees ÷ total volume) is often 3–4% or higher.

The difference is hidden in:
  • Interchange downgrades (transactions that qualify for higher-cost tiers due to card type or data submission errors)
  • Monthly add-on fees (statement fee, PCI fee, batch fee, minimum monthly fee)
  • Mid- and non-qualified surcharges (tiered pricing at its worst)
  • Annual fees and paper statement fees most merchants don't notice

These hidden costs are real, legal, and deliberate. They're designed to be confusing. Liberty Bancard's job is to make them visible — and then offer a better path.

────────────────────────────────────
THE LIBERTY BANCARD DIFFERENCE
────────────────────────────────────
1. STATEMENT-FIRST DIAGNOSTIC APPROACH
   Every engagement starts with a statement review. We upload the merchant's most recent processing statement, identify their effective rate, surface every cost driver line by line, and build a comparison using real math — not estimated "up to X%" claims.

   If we can't beat their current arrangement, we tell them honestly. That integrity is what generates referrals.

2. INTERCHANGE-PLUS PRICING
   The most transparent pricing model in payments. The merchant pays the actual interchange rate set by Visa/Mastercard/Amex/Discover plus a fixed, disclosed markup. No bundled pricing tricks. No tiered mystery fees. The bill explains itself.

   Compare this to tiered pricing (the industry default) where the processor decides which "tier" to assign each transaction — often routing premium rewards cards to non-qualified at 3.5%+ without explanation.

3. LIBERTY ZERO™ — 0% PROCESSING PROGRAM
   For qualifying merchants, our fee-offset programs (cash discount or compliant surcharging) can bring processing costs to $0 — with compliant disclosures, signage, and receipts handled entirely by us.

   When properly implemented (compliant signage, receipt formatting, staff script, and card brand registration where required), merchants process thousands of dollars per month at $0 in processor fees.

   Liberty Zero is available in all 50 states for cash discount structures. Surcharging-based structures depend on state law, card brand rules, and underwriting — we verify eligibility before recommending.

4. REAL HUMAN SUPPORT
   Every Liberty Bancard merchant has a named support contact — not a 1-800 number or a help ticket queue. When something goes wrong with a terminal, a deposit, or a chargeback, there's a person who picks up the phone.

────────────────────────────────────
WHAT WE OFFER
────────────────────────────────────
Processing Programs:
  • Interchange-Plus Wholesale (most transparent, lowest cost for card-paying merchants)
  • Liberty Zero™ Cash Discount / Surcharge (0% effective cost to merchant)
  • Flat Rate (simple, predictable — best for very low-volume merchants)

Equipment:
  • Liberty Bancard Smart Terminal (Dejavoo QD4 — rugged, surcharge-ready, mobile)
  • Clover Flex 3, Clover Mini 3, Clover Station Duo (full POS ecosystem)
  • PAX A920 (sleek Android smart terminal)
  • SwipeSimple (mobile card reader for iOS/Android)
  Equipment pricing varies by merchant profile and underwriting.

Industries Served:
  Restaurant, Medical/Dental, Retail, Auto Repair, Hotel/Hospitality, Law Firms,
  Salon & Spa, Dental, Gym & Fitness, E-Commerce, Contractors, Grocery, Convenience Store,
  and many more.

────────────────────────────────────
BY THE NUMBERS
────────────────────────────────────
  • Founded:              2014
  • HQ:                   Fort Lauderdale, Florida
  • Merchants Served:     5,000+
  • Annual Volume:        $2B+ processed
  • Platform Uptime:      99.9%
  • Support Style:        Named rep, direct line — no anonymous call centers

────────────────────────────────────
OUR PROCESS (3 STEPS)
────────────────────────────────────
Step 1 — Statement Review (Free, ~10 minutes)
  Upload your most recent processing statement. We analyze effective rate, cost drivers, fee structure, and whether Liberty Zero is a fit. No obligation.

Step 2 — Apples-to-Apples Proposal
  We present 2–3 options with exact math — your current rate vs. what you'd pay on our program. No estimates, no "up to X%" promises. Real numbers based on your statement.

Step 3 — Seamless Transition
  If you choose to switch, we handle terminal setup, programming, and go-live. The transition takes 5–10 business days from application to processing. Your first month includes check-ins at day 7 and day 30.

────────────────────────────────────
COMPLIANCE & LEGAL
────────────────────────────────────
Liberty Bancard is a registered ISO/MSP (Independent Sales Organization / Member Service Provider). We operate under agreements with our acquiring bank partners and comply with Visa, Mastercard, Discover, and American Express card brand regulations.

All processing programs, pricing, and equipment offers are subject to underwriting approval. Liberty Zero eligibility depends on state law, card brand rules, merchant business type, and underwriting. No savings claims are made without a completed statement review.

For more information: libertybancard.com | support@libertybancard.com | 954-266-8214`,
  },

  // ── VERTICAL ONE-PAGERS — 13 individual docs ────────────────────────────

  vop_restaurant: {
    title: "Vertical One-Pager — Restaurant",
    folder: "01",
    content: `LIBERTY BANCARD — VERTICAL ONE-PAGER: RESTAURANT
==================================================
HEADLINE: Stop Losing 3% of Every Table to Your Processor

THE PROBLEM FOR RESTAURANTS:
High card volume, thin margins (4–8% net), and processors who don't explain why their effective rate keeps climbing. Most restaurants process $30K–$150K/month. At 2.8% effective, that's $840–$4,200/month in fees — often with no real understanding of why.

PROOF POINTS:
  • Restaurants average 85–90% card volume — fees are unavoidable. What isn't unavoidable is overpaying.
  • Tiered pricing hits restaurants hardest: rewards cards (Visa Infinite, Amex) often downgrade to non-qual at 3.5–4%.
  • Liberty Zero is a natural fit: diners understand surcharging from the gas pump model. Most accept it.

HOW IT WORKS (3 STEPS):
  1. Upload last month's statement — free review in 24 hours
  2. See your real effective rate vs. what's possible on interchange-plus or Liberty Zero
  3. Switch in under 2 weeks — same day settlement, next-day funding options available*

SAMPLE SAVINGS:
"A Miami restaurant processing $75,000/month at 2.9% pays $2,175/month in fees. On Liberty Bancard's interchange-plus program, that same volume costs approximately $1,100–1,300. With Liberty Zero, processor fees drop to $0."

CTA: Get your free restaurant statement review → libertybancard.com/upload-statement

*Eligibility, underwriting, card brand rules, and applicable laws apply.`,
  },

  vop_medical: {
    title: "Vertical One-Pager — Medical & Healthcare",
    folder: "01",
    content: `LIBERTY BANCARD — VERTICAL ONE-PAGER: MEDICAL & HEALTHCARE
=============================================================
HEADLINE: Healthcare Practices Shouldn't Pay Retail Rates on Every Card Swipe

THE PROBLEM FOR MEDICAL:
Medical practices have high average tickets ($200–$2,000+), low chargeback rates, and processors that charge them the same bundled rate as a pizza shop. Interchange-plus is the obvious solution — most medical offices aren't on it.

PROOF POINTS:
  • Medical practices have some of the best interchange categories — Health Care transactions qualify for lower interchange than retail. Tiered pricing hides this.
  • PCI non-compliance fees of $20–$40/month are common in medical — often the office isn't aware.
  • Statement reviews in this vertical consistently reveal $500–$2,000+/month in avoidable cost.

HOW IT WORKS (3 STEPS):
  1. Submit your statement — HIPAA data not required; we only need totals and fee line items
  2. Review shows exact interchange categories and markup — fully transparent
  3. Transition with zero disruption to patient billing workflows

SAMPLE SAVINGS:
"A dental practice processing $50,000/month at 2.7% pays $1,350/month. On interchange-plus, that same volume — with healthcare interchange rates — costs $750–900/month."

CTA: Medical/dental statement review → libertybancard.com/upload-statement

*Eligibility, underwriting, card brand rules, and applicable laws apply.`,
  },

  vop_retail: {
    title: "Vertical One-Pager — Retail",
    folder: "01",
    content: `LIBERTY BANCARD — VERTICAL ONE-PAGER: RETAIL
=============================================
HEADLINE: Your Retail Margins Are Too Thin to Pay Tiered Pricing

THE PROBLEM FOR RETAIL:
Retail runs on 20–40% gross margins. Losing 3%+ to processing is giving away 7–15% of your margin to a processor. Rewards cards increasingly downgrade to non-qualified under tiered pricing, spiking effective rates.

PROOF POINTS:
  • Boutiques, hardware stores, and specialty retail typically have 70–85% card volume
  • Average retail effective rate on tiered pricing: 2.6–3.4%
  • Interchange-plus captures the lower cost of debit and basic credit cards, passing savings through

HOW IT WORKS (3 STEPS):
  1. Free statement review — upload any format (PDF, photo)
  2. We identify your card mix and exact downgrade patterns
  3. Proposal shows itemized cost reduction by card type

SAMPLE SAVINGS:
"A boutique processing $40,000/month at 3.1% pays $1,240/month. On interchange-plus with proper data submission, effective rate typically falls to 1.8–2.2%. Monthly savings: $360–520."

CTA: Retail savings review → libertybancard.com/upload-statement

*Eligibility, underwriting, card brand rules, and applicable laws apply.`,
  },

  vop_auto: {
    title: "Vertical One-Pager — Auto Repair",
    folder: "01",
    content: `LIBERTY BANCARD — VERTICAL ONE-PAGER: AUTO REPAIR
===================================================
HEADLINE: Auto Repair Shops Have High Tickets and High Fees — Fix the Fees

THE PROBLEM FOR AUTO:
Average auto repair ticket: $400–$1,500. Most shops process $30K–$100K/month. High average ticket means more rewards cards, which means more non-qualified downgrades under tiered pricing. The result: effective rates of 3–4%+ on a margin business.

PROOF POINTS:
  • B2B and fleet accounts often use corporate cards — highest interchange category under tiered pricing
  • Liberty Zero is extremely well-suited: customers paying $800 for a repair are comfortable with a disclosed service fee
  • Shops that switch to interchange-plus typically drop from 3.2%+ to 1.9–2.3%

HOW IT WORKS (3 STEPS):
  1. Statement upload (we know how to read Heartland, Cayan, Square, and First Data formats)
  2. Fleet card / corporate card analysis — often the biggest hidden cost driver
  3. Proposal with Liberty Zero and interchange-plus options side by side

SAMPLE SAVINGS:
"An auto shop processing $60,000/month at 3.0% pays $1,800/month. On interchange-plus: approximately $1,100–1,300. With Liberty Zero: $0 in processor fees."

CTA: Auto repair statement review → libertybancard.com/upload-statement

*Eligibility, underwriting, card brand rules, and applicable laws apply.`,
  },

  vop_hotel: {
    title: "Vertical One-Pager — Hotel & Hospitality",
    folder: "01",
    content: `LIBERTY BANCARD — VERTICAL ONE-PAGER: HOTEL & HOSPITALITY
============================================================
HEADLINE: Hotels Pay Too Much to Process — And Most Don't Know It

THE PROBLEM FOR HOSPITALITY:
Hotels deal with card-not-present authorization holds, manual key-entry transactions, and guests using premium rewards cards — all of which trigger the worst interchange categories under tiered pricing. Most hotel processors bundle this into a "hospitality rate" that obscures the actual cost structure.

PROOF POINTS:
  • CNP hotel transactions carry higher interchange — but under interchange-plus the merchant sees the actual rate, not a bundled worst-case tier
  • Authorization hold + final settlement patterns create downgrade exposure — we help fix this
  • Statement reviews in hospitality regularly surface 0.8–1.2% in avoidable excess markup

HOW IT WORKS (3 STEPS):
  1. Upload your statement — we understand hotel-specific billing structures
  2. Identify CNP vs. card-present breakdown and downgrade exposure
  3. Program recommendation: interchange-plus with proper data submission protocols

SAMPLE SAVINGS:
"A 40-room boutique hotel processing $80,000/month at 3.2% pays $2,560/month. With proper interchange-plus setup: $1,600–1,900/month."

CTA: Hospitality statement review → libertybancard.com/upload-statement

*Eligibility, underwriting, card brand rules, and applicable laws apply.`,
  },

  vop_lawfirm: {
    title: "Vertical One-Pager — Law Firms",
    folder: "01",
    content: `LIBERTY BANCARD — VERTICAL ONE-PAGER: LAW FIRMS
=================================================
HEADLINE: Attorneys Shouldn't Pay Consumer Card Rates on Client Retainers

THE PROBLEM FOR LAW FIRMS:
Law firms typically collect large retainers and flat fees via credit card. These high-ticket transactions frequently involve corporate cards and premium rewards cards, which downgrade aggressively under tiered pricing. Many law firms pay 3–3.5%+ on transactions that should qualify for lower interchange.

PROOF POINTS:
  • Business credit cards used for legal retainers qualify for B2B interchange — dramatically lower than consumer tiers
  • Level 2/3 data submission (invoice number, tax amount) can reduce interchange by 0.5–1.0% on B2B transactions
  • Liberty Bancard supports Level 2/3 data capture for law firm billing software integrations

HOW IT WORKS (3 STEPS):
  1. Statement review — we identify card type mix (consumer vs. corporate) immediately
  2. Level 2/3 analysis: are you leaving B2B savings on the table?
  3. Proposal shows cost reduction by implementing interchange-plus + proper data submission

SAMPLE SAVINGS:
"A law firm processing $60,000/month in retainers at 3.1% pays $1,860/month. With interchange-plus + B2B data submission: $1,000–1,200/month."

CTA: Law firm payment review → libertybancard.com/upload-statement

*Eligibility, underwriting, card brand rules, and applicable laws apply.`,
  },

  vop_salon: {
    title: "Vertical One-Pager — Salon & Spa",
    folder: "01",
    content: `LIBERTY BANCARD — VERTICAL ONE-PAGER: SALON & SPA
===================================================
HEADLINE: Your Stylists Hustle for Every Dollar — Stop Giving It to Your Processor

THE PROBLEM FOR SALONS & SPAS:
Salons operate on service margins with high credit card usage and frequent tip transactions. Tip-adjust transactions have specific settlement requirements — missing them creates downgrades. Most salons are on tiered pricing and don't know it's costing them 0.5–1% extra per month.

PROOF POINTS:
  • Tip-adjusted transactions must be settled within 24 hours to avoid downgrade — many POS systems miss this
  • Beauty and wellness customers use premium rewards cards at high rates
  • Liberty Zero is a strong fit: salons that implement it typically save $200–800/month

HOW IT WORKS (3 STEPS):
  1. Statement review (15-minute call to walk through results)
  2. Tip-adjustment and settlement timing analysis
  3. Liberty Zero or interchange-plus recommendation with side-by-side math

SAMPLE SAVINGS:
"A full-service salon processing $25,000/month at 2.9% pays $725/month. With Liberty Zero: $0 in fees. With interchange-plus: approximately $425–500."

CTA: Salon savings review → libertybancard.com/upload-statement

*Eligibility, underwriting, card brand rules, and applicable laws apply.`,
  },

  vop_dental: {
    title: "Vertical One-Pager — Dental",
    folder: "01",
    content: `LIBERTY BANCARD — VERTICAL ONE-PAGER: DENTAL
=============================================
HEADLINE: Dental Practices Overpay Every Month — Here's the Proof

THE PROBLEM FOR DENTAL:
Dental insurance copays and out-of-pocket balances are paid by patients using their best rewards cards. Under tiered pricing, those rewards cards cost the practice 3–3.5%. Under interchange-plus, the exact interchange rate is visible and the markup is disclosed and fixed.

PROOF POINTS:
  • Dental has one of the lowest chargeback rates of any vertical — low-risk profile = lower processor markup available
  • Practices with multiple locations are almost always on suboptimal pricing
  • PCI compliance fee ($20–40/month) is almost always present and frequently unjustified

HOW IT WORKS (3 STEPS):
  1. Statement upload — PDF from any processor
  2. Effective rate calculation, PCI fee audit, card type breakdown
  3. Interchange-plus proposal with exact savings projection

SAMPLE SAVINGS:
"A dental practice processing $45,000/month at 2.8% pays $1,260/month. On interchange-plus with healthcare interchange rates: $700–880/month. Annual savings: $4,560–6,720."

CTA: Dental statement review → libertybancard.com/upload-statement

*Eligibility, underwriting, card brand rules, and applicable laws apply.`,
  },

  vop_gym: {
    title: "Vertical One-Pager — Gym & Fitness",
    folder: "01",
    content: `LIBERTY BANCARD — VERTICAL ONE-PAGER: GYM & FITNESS
=====================================================
HEADLINE: Recurring Revenue Businesses Get Crushed by Hidden Fees

THE PROBLEM FOR GYM & FITNESS:
Gym memberships create recurring billing — monthly card-on-file charges that are technically card-not-present transactions. CNP transactions carry higher interchange, and under tiered pricing, the processor pockets the spread between what interchange actually costs and what they charge you.

PROOF POINTS:
  • Recurring billing on stored cards qualifies for specific CNP interchange — interchange-plus passes this through at actual cost
  • Studios with both membership and retail (apparel, supplements) have mixed transaction types — tiered pricing blurs this
  • Liberty Zero works well for studios with walk-in drop-in class purchases

HOW IT WORKS (3 STEPS):
  1. Statement review with recurring vs. in-person breakdown
  2. Analysis of CNP pricing exposure
  3. Interchange-plus recommendation with membership billing optimization

SAMPLE SAVINGS:
"A fitness studio processing $30,000/month at 2.7% pays $810/month. On interchange-plus: $480–580/month. Annual savings: $2,760–3,960."

CTA: Gym statement review → libertybancard.com/upload-statement

*Eligibility, underwriting, card brand rules, and applicable laws apply.`,
  },

  vop_ecommerce: {
    title: "Vertical One-Pager — E-Commerce",
    folder: "01",
    content: `LIBERTY BANCARD — VERTICAL ONE-PAGER: E-COMMERCE
==================================================
HEADLINE: Online Stores Pay the Highest Rates — You Don't Have To

THE PROBLEM FOR E-COMMERCE:
Card-not-present transactions are the highest interchange category. Flat-rate processors like Square (2.9% + $0.30) and Stripe (2.9% + $0.30) make this look simple — but at $100K/month in volume, that's $2,900+/month vs. $1,500–1,800/month on interchange-plus.

PROOF POINTS:
  • Square and Stripe are the most expensive options for merchants above $20K/month
  • E-commerce merchants can implement Level 2/3 data for B2B online sales — dramatically reducing interchange
  • Chargeback management and fraud tools are included — not an add-on

HOW IT WORKS (3 STEPS):
  1. Share your Stripe/Square/PayPal dashboard or statement
  2. We calculate effective rate including all transaction fees
  3. Proposal with gateway integration options and side-by-side math

SAMPLE SAVINGS:
"An online retailer processing $75,000/month on Stripe pays $2,175+ in fees. On Liberty Bancard interchange-plus with the same gateway: approximately $1,200–1,500."

CTA: E-commerce rate comparison → libertybancard.com/upload-statement

*Eligibility, underwriting, card brand rules, and applicable laws apply.`,
  },

  vop_contractors: {
    title: "Vertical One-Pager — Contractors",
    folder: "01",
    content: `LIBERTY BANCARD — VERTICAL ONE-PAGER: CONTRACTORS
===================================================
HEADLINE: Contractors Who Accept Cards Are Overpaying — The Fix Is Simple

THE PROBLEM FOR CONTRACTORS:
Contractors (HVAC, plumbing, electrical, construction) collect large payments on-site using mobile terminals or virtual terminals. These are often manually keyed or CNP transactions, which trigger the worst interchange categories. Most contractor processors charge flat-rate or tiered at 3%+.

PROOF POINTS:
  • Mobile/field service contractors frequently key-enter card numbers over the phone — this is higher interchange regardless of card type
  • Liberty Zero is a top fit: customers paying $2,000 for a new HVAC system barely notice a disclosed service fee
  • Contactless/tap payments from the Dejavoo QD4 terminal lower interchange vs. swipe or key-entry

HOW IT WORKS (3 STEPS):
  1. Statement or Square/Stripe summary upload
  2. Analysis of transaction entry method (swipe vs. key-entry vs. CNP)
  3. Terminal recommendation + Liberty Zero or interchange-plus proposal

SAMPLE SAVINGS:
"A plumbing contractor processing $40,000/month at 3.2% pays $1,280/month. With Liberty Zero: $0 in fees. With interchange-plus + proper terminal: $700–850/month."

CTA: Contractor statement review → libertybancard.com/upload-statement

*Eligibility, underwriting, card brand rules, and applicable laws apply.`,
  },

  vop_grocery: {
    title: "Vertical One-Pager — Grocery",
    folder: "01",
    content: `LIBERTY BANCARD — VERTICAL ONE-PAGER: GROCERY
===============================================
HEADLINE: Grocery Stores Run the Thinnest Margins in Retail — Every Basis Point Counts

THE PROBLEM FOR GROCERY:
Grocery operates on 1–3% net margins. Processing fees of 2%+ are not a rounding error — they're a material cost center. Most grocery merchants are on flat-rate or tiered pricing without access to the lower debit interchange rates that their card mix (typically 50–70% debit) qualifies for.

PROOF POINTS:
  • Debit card interchange is favorable for independent grocers vs. credit interchange
  • PIN debit transactions have very low interchange — tiered pricing buries this savings
  • Cash discount programs work exceptionally well in grocery — customers have normalized them

HOW IT WORKS (3 STEPS):
  1. Statement review with debit vs. credit breakdown
  2. Calculate cost of current debit treatment vs. interchange-plus
  3. Liberty Zero or interchange-plus proposal with debit optimization

SAMPLE SAVINGS:
"A grocery store processing $120,000/month at 2.2% pays $2,640/month. With interchange-plus (debit optimization): $1,680–1,920/month. Annual savings: $8,640–11,520."

CTA: Grocery statement review → libertybancard.com/upload-statement

*Eligibility, underwriting, card brand rules, and applicable laws apply.`,
  },

  vop_cstore: {
    title: "Vertical One-Pager — Convenience Store",
    folder: "01",
    content: `LIBERTY BANCARD — VERTICAL ONE-PAGER: CONVENIENCE STORE
=========================================================
HEADLINE: C-Stores Are Leaving Money on the Table With Every Card Swipe

THE PROBLEM FOR C-STORES:
Convenience stores process hundreds of small transactions per day — $10–$50 average ticket. Per-transaction fees add up fast: a $0.10 per-transaction fee on 500 daily transactions is $50/day, $1,500/month. Most c-store owners focus on the percentage rate and miss the per-transaction fee trap.

PROOF POINTS:
  • At 500 transactions/day, per-transaction fee optimization alone can save $500–1,000/month
  • Debit PIN transactions are lower cost — proper terminal setup is critical for c-stores
  • Liberty Zero / cash discount is extremely common in c-stores — customers have seen it at gas pumps for years

HOW IT WORKS (3 STEPS):
  1. Statement review — we look at per-transaction fees AND effective rate
  2. Transaction volume and debit optimization analysis
  3. Cash discount / Liberty Zero recommendation with signage kit

SAMPLE SAVINGS:
"A c-store processing $80,000/month in 15,000 transactions pays $2,240/month in fees. With optimized per-transaction fees + debit routing: $1,400–1,700/month."

CTA: C-store statement review → libertybancard.com/upload-statement

*Eligibility, underwriting, card brand rules, and applicable laws apply.`,
  },

  // ── COMPETITOR COMPARISONS — 4 individual docs ──────────────────────────

  cc_square: {
    title: "Competitor Comparison — Liberty Bancard vs. Square",
    folder: "01",
    content: `LIBERTY BANCARD vs. SQUARE — COMPETITIVE COMPARISON SHEET
=============================================================
Internal Sales Resource | Updated 2026
Lead with math, not disparagement.

SQUARE'S PRICING MODEL:
  In-person:         2.6% + $0.10 per transaction
  Keyed/manual:      3.5% + $0.15 per transaction
  Invoices/online:   3.3% + $0.30 per transaction
  Square Plus (POS): $60/month + processing fees
  Dispute fee:       $15 per dispute (refunded if you win)

SQUARE'S HIDDEN COSTS:
  1. No volume discount — rate is flat regardless of processing $20K or $500K/month
  2. Manual key-entry charges (3.5%) — any sale without a card-present tap/swipe pays more
  3. $60/month for basic POS features that should be standard
  4. Dispute/chargeback fee: $15 even if you win

LIBERTY BANCARD COMPARISON (on interchange-plus):
  A merchant processing $50,000/month through Square at 2.6% + $0.10:
    Square cost:            $1,300 + (# transactions × $0.10)
    Assuming 1,000 txns:    $1,300 + $100 = $1,400/month

    Liberty Bancard (interchange-plus wholesale at ~1.5–1.8% effective):
    Estimated cost:         $750–900/month
    Monthly savings:        $500–650
    Annual savings:         $6,000–7,800

LIBERTY BANCARD COMPARISON (Liberty Zero):
  Processor fees drop to $0. Card-paying customers see disclosed service fee.

WHY MERCHANTS SWITCH FROM SQUARE:
  ✓ Volume discount — our rate structure rewards high-volume merchants
  ✓ No per-transaction fee on in-person transactions
  ✓ Better terminal options (full POS or portable smart terminal)
  ✓ Statement-based review shows real cost vs. Square's "simple" rate
  ✓ Named support rep — not a help center ticket

KEY TALKING POINTS:
  "Square is great for a $5,000/month food truck. For a restaurant doing $80K/month, you're paying retail rates on wholesale volume. Let me show you what the same volume costs on interchange-plus."

  "Square's 2.6% sounds clean, but your statement will show what your actual effective rate is after all transaction fees."`,
  },

  cc_stripe: {
    title: "Competitor Comparison — Liberty Bancard vs. Stripe",
    folder: "01",
    content: `LIBERTY BANCARD vs. STRIPE — COMPETITIVE COMPARISON SHEET
=============================================================
Internal Sales Resource | Updated 2026

STRIPE'S PRICING MODEL:
  Online (standard):   2.9% + $0.30 per transaction
  In-person (Stripe Terminal): 2.7% + $0.05 per transaction
  Invoicing:           0.4%–0.5% on top of processing
  Disputes:            $15 per dispute (refunded if won)
  International cards: +1.5%
  Radar (fraud):       $0.05 per screened transaction

STRIPE'S HIDDEN COSTS:
  1. 2.9% online is very high for merchants above $25K/month online volume
  2. International card surcharge: $15K/month in international sales = $225/month extra
  3. $15 dispute fee is standard but adds up for high-chargeback verticals
  4. Invoicing fees stack on top of processing

LIBERTY BANCARD COMPARISON (E-commerce merchant, $75K/month):
  Stripe at 2.9% + $0.30, assuming 1,500 transactions:
    $75,000 × 2.9% + 1,500 × $0.30 = $2,175 + $450 = $2,625/month

  Liberty Bancard interchange-plus (CNP e-commerce):
    Estimated effective rate 1.8–2.1%:    $1,350–1,575/month
    Monthly savings:                       $1,050–1,275
    Annual savings:                        $12,600–15,300

WHY MERCHANTS SWITCH FROM STRIPE:
  ✓ Stripe pricing is built for developers — complex volume merchants overpay
  ✓ Interchange-plus passes actual CNP interchange through — usually 0.8–1.5% lower than Stripe
  ✓ No per-transaction flat fee overhead at scale
  ✓ Better chargeback support (named rep vs. Stripe's automated dispute system)
  ✓ Works with existing payment gateways (NMI, Authorize.net) — no full replatform required

KEY TALKING POINTS:
  "Stripe is world-class for building a payment product. For a business that just wants to accept cards online and pay as little as possible, you're massively overpaying. Let me do the math."

  "At your volume, switching from Stripe to interchange-plus typically saves $1,000–1,500/month. Here's the calculation based on your statement."`,
  },

  cc_clover: {
    title: "Competitor Comparison — Liberty Bancard vs. Clover",
    folder: "01",
    content: `LIBERTY BANCARD vs. CLOVER (FISERV) — COMPETITIVE COMPARISON SHEET
====================================================================
Internal Sales Resource | Updated 2026

CLOVER'S PRICING MODEL (Direct from Fiserv):
  Processing:   Varies (typically tiered 2.3–3.5% or interchange-plus if negotiated separately)
  Monthly fee:  $9.95–$69.95/month depending on plan
  Hardware:     $599–$1,649 (Flex, Mini, Station Duo) — purchased, not leased
  Support:      24/7 phone — but merchant services support separate from Clover device support

KEY INSIGHT: Clover hardware can work with Liberty Bancard processing. We are not competing with the hardware — only with the processing behind it.

CLOVER PROCESSOR SITUATION:
  The "Clover" a merchant sees is the hardware brand. The processing behind it is typically provided by Fiserv (First Data), Heartland, or a Clover-authorized ISO. These processors often use tiered pricing.

  Common scenario: merchant bought Clover hardware directly from Clover.com, now paying Clover's processing rates (typically 2.3%–3.5% tiered), and doesn't realize they can use the same Clover terminal with a different processor.

WHY MERCHANTS SWITCH THEIR PROCESSING (NOT THEIR HARDWARE):
  ✓ Same Clover terminal — Liberty Bancard reprograms it for interchange-plus or Liberty Zero
  ✓ No new hardware purchase required (save $600–$1,600)
  ✓ Processor markup is often 0.5–1.0% lower than Clover's direct rates
  ✓ No monthly software fee if switching to our processing plan

KEY TALKING POINT:
  "Your Clover terminal is great hardware. The problem is your processing rate behind it. We can re-point your Clover to our interchange-plus network — same device, same POS features, just a lower processing cost. No disruption."

CLOVER LEASE WARNING:
  ✗ If a merchant has a Clover lease through a third-party leasing company, they may be locked in at $60–$150/month for 4 years. This is separate from the processor relationship. Identify this during the statement review — a lease may make switching less economically viable until the lease ends.`,
  },

  cc_toast: {
    title: "Competitor Comparison — Liberty Bancard vs. Toast",
    folder: "01",
    content: `LIBERTY BANCARD vs. TOAST — COMPETITIVE COMPARISON SHEET
===========================================================
Internal Sales Resource | Updated 2026

TOAST'S PRICING MODEL:
  Starter (free):   2.99% + $0.15 per transaction (higher rate funds the free plan)
  Point of Sale:    $69/month + 2.49% + $0.15 per transaction
  Build Your Own:   Custom — usually 2.49–2.69% + monthly SaaS fee
  Hardware:         $627–$1,024+ for starter kits; proprietary — won't work with other processors

TOAST'S HIDDEN COSTS:
  1. Monthly SaaS fee ($69–$165+/month) on top of processing
  2. Add-on modules (online ordering, loyalty, payroll) each cost extra: $25–$75/month each
  3. Toast hardware is proprietary — merchant cannot switch processors without buying new hardware
  4. Early termination fee: typically $500+

TOAST LIMITATION: Toast only works with Toast's own processing. You cannot use Toast POS with a different processor.
  For restaurants below $30K/month: Toast may make sense as an all-in-one.
  For restaurants above $50K/month: processing fees alone ($1,250+/month) dwarf the value of the SaaS features.

WHY MERCHANTS CONSIDER SWITCHING FROM TOAST:
  ✓ Processing cost reduction of $500–1,500/month for higher-volume restaurants
  ✓ Liberty Bancard's Clover Station Duo offers full restaurant POS (table management, online ordering) without the Toast markup
  ✓ No proprietary hardware lock-in — future flexibility to choose the best tools

WHY MERCHANTS STAY WITH TOAST:
  ✗ The POS features (floor management, kitchen display, online ordering) are deeply integrated
  ✗ Staff is trained on Toast interface
  ✗ Switching requires hardware swap, staff retraining, menu rebuild — real switching cost

STRATEGIC APPROACH FOR TOAST MERCHANTS:
  Don't fight the POS features. Run the numbers. If savings are $800+/month ($9,600/year), the switching cost (hardware, setup, training: $3,000–6,000) pays back in 4–8 months. Present that breakeven analysis clearly.

KEY TALKING POINT:
  "Toast has genuinely excellent restaurant software. But above a certain volume, you're paying a $1,200+/month premium in processing fees to keep using it. Let me show you what the breakeven looks like on switching — you may decide it's worth it, or you may decide it isn't. Either way, you'll have the math."`,
  },

  emailTemplates: {
    title: "Email Marketing Templates",
    folder: "01",
    content: `LIBERTY BANCARD — EMAIL MARKETING TEMPLATES
============================================
Ready-to-Send Templates | Customize bold fields before sending

────────────────────────────────────
COLD OUTREACH TEMPLATES
────────────────────────────────────

COLD EMAIL #1 — RESTAURANT (Statement-First Angle)
Subject: Quick question about your processing costs, {{First Name}}

Hi {{First Name}},

I help restaurants in {{Prospect City}} reduce their credit card processing fees. Most restaurant owners I talk to don't realize their real effective rate is 2.8–3.5% when you factor in all the monthly fees and interchange downgrades.

I'm not pitching anything. I'd just like to take a look at your last statement and show you what you're actually paying — and whether there's a better option. No strings attached, takes about 10 minutes.

Would you be open to a quick call this week?

{{Agent Name}}
Liberty Bancard | 954-266-8214

P.S. If your statement shows you're already getting a great deal, I'll tell you. We'd rather earn your trust than your business.

---

COLD EMAIL #2 — MEDICAL/DENTAL (Rate Education Angle)
Subject: Most dental practices are on the wrong pricing model — here's why

Hi {{First Name}},

Quick background: I work with medical and dental practices on payment processing. One thing I see consistently: most practices are on tiered pricing, which means their processor decides which "tier" to assign each card transaction — and premium rewards cards almost always land in the most expensive bucket.

Practices on interchange-plus (the transparent alternative) typically pay 20–40% less for the same volume.

I'd love to pull apart your most recent statement and show you exactly where your money is going. Free, no obligation, takes one statement and a 10-minute call.

Does {{Preferred Day/Time}} work for you?

{{Agent Name}}
Liberty Bancard | 954-266-8214

---

COLD EMAIL #3 — RETAIL (Competitor Reference Angle)
Subject: If you're with Square or Stripe, you're paying retail rates on wholesale volume

Hi {{First Name}},

I know that's a bold subject line — let me back it up.

Square and Stripe charge 2.6–2.9% regardless of your volume. At {{Estimated Monthly Volume}} (I estimated based on your business size), that's {{Estimated Monthly Fees}}. Merchants at your volume on interchange-plus typically pay 20–40% less.

I can show you the math on your actual statement in one call. If I'm wrong, you'll have verified you're getting a good deal. If I'm right, you'll know exactly how much you're leaving on the table.

Up for a 10-minute call this week?

{{Agent Name}}
Liberty Bancard | 954-266-8214

---

COLD EMAIL #4 — AUTO REPAIR / CONTRACTOR (Liberty Zero Angle)
Subject: {{First Name}} — what if your customers paid the processing fee instead?

Hi {{First Name}},

For a shop like yours with higher average tickets, there's a program worth knowing about.

It's called Liberty Zero. Instead of you absorbing the 2–3% processing fee on every card payment, the fee is disclosed to the card-paying customer at checkout — exactly like you've seen at gas stations for years. Cash customers pay the standard price. Card customers pay a small service fee.

For shops processing $40–80K/month, this typically means $0 in monthly processing costs.

Worth a 10-minute conversation to see if you qualify?

{{Agent Name}}
Liberty Bancard | 954-266-8214

P.S. Cash discount programs are legal in all 50 states. Surcharging applicability depends on state law — we check eligibility before recommending.

---

COLD EMAIL #5 — GENERIC / UNIVERSAL (Pain-Point Angle)
Subject: Have you ever actually checked your effective rate?

Hi {{First Name}},

The "rate" your processor quotes you and the rate you actually pay are almost always different.

Effective rate = total fees ÷ total volume. Most business owners don't calculate it. When I calculate it from their statement, it's usually 0.5–1.5% higher than what they were told.

Take 30 seconds: grab last month's statement, divide total fees by total volume. If it's over 2.5%, it's worth a conversation.

I'm happy to walk through it with you — free, no pitch, just the math.

{{Agent Name}}
Liberty Bancard | 954-266-8214

────────────────────────────────────
FOLLOW-UP AFTER STATEMENT UPLOAD
────────────────────────────────────

STATEMENT FOLLOW-UP — SAME DAY
Subject: Got your statement — here's what I found

Hi {{First Name}},

Thanks for uploading your statement. I've reviewed it and have some numbers for you.

Your current effective rate: {{Merchant Effective Rate}}
Your current monthly processing cost: $(Monthly Cost)

Based on your volume and card mix, here are two options I'd recommend reviewing:

Option A — Interchange-Plus Wholesale: Estimated effective rate {{Effective Rate}}, estimated monthly cost $(Monthly Cost). Monthly savings: $(Monthly Savings).

Option B — Liberty Zero Program: $0 in processor fees (card-paying customers pay a disclosed service fee). Monthly savings: $(Monthly Cost) (pending eligibility confirmation).

Can we schedule a 15-minute call to walk through the math? I want to make sure the numbers make sense in the context of your specific business before you make any decision.

Available Tuesday at 10am, Wednesday at 2pm, or Thursday at 11am. Let me know what works.

{{Agent Name}}
Liberty Bancard | 954-266-8214

Note: Eligibility, underwriting, card brand rules, and applicable laws apply.

────────────────────────────────────
REFERRAL PARTNER WELCOME
────────────────────────────────────

REFERRAL PARTNER WELCOME EMAIL
Subject: Welcome to the Liberty Bancard Partner Program — here's how it works

Hi {{First Name}},

Welcome aboard. I'm glad we connected.

Here's how the referral program works in plain language:

What you do: Introduce us to a business owner who might be overpaying for payment processing. You don't need to pitch anything — just make the intro and we handle the rest.

What happens next: We do a free statement review and present options. If the merchant switches, you earn a monthly residual commission for as long as they're processing with us.

What you earn: Commissions are based on the merchant's monthly processing volume. On average, our referral partners earn $50–$300/month per merchant — indefinitely, not just for the first year.

Your contacts: Merchants who are most likely to benefit are those processing $10K+/month on any card processor. Verticals that tend to have the most savings opportunity: restaurants, medical, auto repair, contractors, and retail.

Your next step: Share this link with any business owner you think should take a look: libertybancard.com/upload-statement. Or just introduce me directly — email or phone works.

Your login to track referrals and commissions: libertybancard.com/agent-portal

Any questions, I'm here.

{{Agent Name}}
Liberty Bancard | 954-266-8214

────────────────────────────────────
MERCHANT RE-ENGAGEMENT
────────────────────────────────────

RE-ENGAGEMENT EMAIL — 30-60 DAYS AFTER INITIAL CONTACT
Subject: Still thinking about the statement review, {{First Name}}?

Hi {{First Name}},

I know the timing wasn't right when we last spoke. I wanted to check back in — not to push, but because the numbers I ran for you haven't changed.

Your current estimated monthly cost: $(Monthly Cost)
Estimated cost on our program: $(Monthly Cost)
Annual difference: $(Monthly Cost)

If anything has changed on your end — contract ending, rate increase from your current processor, or just more mental bandwidth — I'm ready when you are.

The statement review is still free. There's no obligation. And if you decide to stay where you are, at least you'll know your numbers.

Reply or call me directly: 954-266-8214

{{Agent Name}}
Liberty Bancard

RE-ENGAGEMENT EMAIL — RATE INCREASE TRIGGER
Subject: {{First Name}} — did your processing rate just go up?

Hi {{First Name}},

Most processors increase rates in January and April without proactively notifying merchants. If you've gotten a notice (or noticed your fees went up) since we last spoke, that's usually the moment it makes sense to revisit alternatives.

We haven't changed our rate structure, and the analysis I built for you is still valid. If now is a better time, I can have updated numbers to you within 24 hours.

Let me know — happy to get back on a call.

{{Agent Name}}
Liberty Bancard | 954-266-8214`,
  },

  socialMediaCopyBank: {
    title: "Social Media Copy Bank (30 Templates)",
    folder: "01",
    content: `LIBERTY BANCARD — SOCIAL MEDIA COPY BANK
=========================================
30 Post Templates | LinkedIn + Facebook | Internal Use

INSTRUCTIONS:
  • All posts marked (verified merchant result) include a real merchant example — do not fabricate numbers.
  • All posts about 0% processing must include the compliance footnote
  • Posts are written for a business owner / decision-maker audience

────────────────────────────────────
SAVINGS PROOF POSTS (10 posts)
────────────────────────────────────

SAVINGS POST #1
"We ran a statement review for a restaurant in {{Prospect City}} last week.

Their quoted rate: 1.9%
Their actual effective rate: 3.1%

The difference? $840/month in fees they'd never been shown line by line.

We got them to 1.6% effective on interchange-plus. That's $675 back in their pocket every month — $8,100/year.

The review took 10 minutes. The statement was already sitting in their inbox.

Free statement review → libertybancard.com/upload-statement"

---

SAVINGS POST #2
"Effective rate math every business owner should know:

Your effective rate = Total fees ÷ Total monthly volume × 100

If you've never calculated it, do it right now. Most merchants discover they're paying 0.5–1.5% more than their quoted rate when you factor in all the monthly add-ons.

Tell me your number in the comments. I'll tell you if it's high, average, or actually good."

---

SAVINGS POST #3
"A dental practice called us last month about a 'minor issue' with their processing statement.

Minor issue turned out to be: $1,200/month in avoidable fees — tiered pricing, a $45/month PCI non-compliance fee they weren't aware of, and a $25/month statement fee for a paper statement they'd never asked for.

We fixed all three. Total time from statement upload to new program: 8 business days.

If your statement has line items you don't understand, that's worth 10 minutes of someone's time to look at."

---

SAVINGS POST #4
"Square is excellent software.

It's also 2.6% + $0.10/transaction regardless of whether you process $5,000 or $500,000 per month.

For a restaurant at $80K/month:
  Square: approximately $2,080 + transaction fees
  Interchange-plus wholesale: approximately $1,200–1,400

That's $700–880/month. $8,400–10,560/year.

At some point, simplicity costs more than it saves."

---

SAVINGS POST #5
"Interchange-plus pricing in plain English:

You pay the exact cost Visa/Mastercard charges for each card type + a fixed, transparent markup.

That's it. The markup doesn't change. The interchange rate is published and visible.

Tiered pricing: the processor decides what to charge you per transaction and uses broad categories that obscure the actual cost.

One of these is transparent. One isn't. Most merchants are on the opaque one."

---

SAVINGS POST #6
"Hidden fees we find most often on processing statements:
  → Monthly statement fee ($10–25) — often for a statement you never requested
  → PCI non-compliance fee ($20–40) — charged even when the merchant IS compliant
  → Batch fee ($0.10–0.25/day) — $30–75/month for settlement
  → Minimum monthly fee — charged when volume dips in slow months
  → Annual membership fee — buried in December or January statement

Total: $100–200/month in fees that appear line by line in small type.

When's the last time someone walked through your statement with you?"

---

SAVINGS POST #7
"A contractor told me last month: 'My rate is fine, I've had the same processor for 6 years.'

His effective rate: 3.4%.

The 6 years of loyalty hadn't lowered his rate. It had just made him comfortable with an expensive arrangement.

Loyalty to a payment processor makes sense only if they've earned it with competitive pricing. Let me show you where yours stands."

---

SAVINGS POST #8
"What we've processed for Miami/South Florida businesses this year:
  ✓ $50 million in card volume
  ✓ 500+ merchants served
  ✓ Average effective rate reduction: 1.2%

Every one of these merchants started with a statement review.

If you haven't had someone look at your statement in the last 12 months, now is a reasonable time."

---

SAVINGS POST #9
"We tell merchants what they're paying before we tell them what we charge.

Radical concept, apparently.

Most processors pitch you a rate. We pull your statement apart line by line and show you your real number first. Then we show you ours. Then you decide.

Either you switch and save — or you learn your current arrangement is actually good. Both outcomes are useful."

---

SAVINGS POST #10
"The restaurants saving the most on processing this year aren't the ones with the most volume.

They're the ones who asked someone to look at their statement.

The math is simple. The barrier is usually just not knowing it's worth asking.

Free restaurant statement review: libertybancard.com/upload-statement"

────────────────────────────────────
FEE EDUCATION POSTS (10 posts)
────────────────────────────────────

EDUCATION POST #1
"Did you know: the 'rate' on your first processing agreement isn't the rate you're paying.

Every processor adds fees on top of the base rate:
  → Interchange (the card network's cost — this is real and unavoidable)
  → Processor markup (this is negotiable and usually not disclosed clearly)
  → Monthly fees (statement, PCI, batch, minimums — these are profit for the processor)

Most merchants only see the first one on their marketing materials."

---

EDUCATION POST #2
"What is interchange? (30-second explainer)

When you accept a credit card, Visa/Mastercard/Amex charges a fee to the card-accepting bank. That fee is called interchange.

Interchange rates vary by card type:
  Basic debit: ~0.05% + $0.22
  Basic Visa credit: ~1.51% + $0.10
  Visa Infinite Rewards: ~2.10% + $0.10

Your processor pays interchange. Then charges you MORE. The difference is their profit.

Under interchange-plus pricing, you see both numbers. Under tiered pricing, you just see the total — and the processor captures the spread."

---

EDUCATION POST #3
"What is a PCI compliance fee — and are you actually paying it?

PCI DSS (Payment Card Industry Data Security Standard) is a security standard all card-accepting merchants must follow.

Most processors charge a 'PCI compliance fee' of $20–40/month.

The problem: this fee is often charged whether or not you've completed your annual Self-Assessment Questionnaire (SAQ). Some processors charge a 'PCI non-compliance fee' when you haven't completed the SAQ — and don't notify you proactively.

Translation: many merchants pay $240–480/year for a compliance process they've never been properly guided through.

Check your statement. Is there a PCI fee? Do you know if you're actually compliant?"

---

EDUCATION POST #4
"Tiered pricing — the most common, least transparent pricing model in payments.

How it works:
  Qualified rate: your cheapest tier (for basic debit or simple credit transactions)
  Mid-qualified: middle tier (for rewards cards, certain card types)
  Non-qualified: most expensive tier (your processor assigns cards here at their discretion)

What merchants often don't know: premium rewards cards (Amex, Visa Infinite, Chase Sapphire) almost always land in non-qualified. That's where the highest-ticket, highest-spending customers cost you the most.

Under interchange-plus: you see the exact interchange for every card type. No surprise tiering."

---

EDUCATION POST #5
"Quick math: what does 1% difference in your effective rate cost per year?

At $30K/month volume:    $3,600/year
At $50K/month volume:    $6,000/year
At $100K/month volume:   $12,000/year
At $200K/month volume:   $24,000/year

If your effective rate is 1% higher than it should be, this is what it's costing you. Every year. Compounding.

What's your monthly volume? I'll calculate it for you."

---

EDUCATION POST #6
"Rewards card math for business owners:

Your customers love their points. You pay for those points — but you're never told clearly.

A basic Visa credit card: ~1.5% interchange.
A Visa Signature Rewards card: ~1.8–2.1% interchange.
A Visa Infinite premium card: ~2.1–2.4% interchange.

Under tiered pricing, all three might be assigned to 'qualified' or 'non-qualified' inconsistently.

Under interchange-plus, you see exactly what each card type costs — and where your volume skews."

---

EDUCATION POST #7
"What happens to your statement fees when you switch processors?

They disappear — or get replaced by cleaner ones.

Many merchants assume they'll pay similar fees regardless of which processor they use. The reality: statement fees, batch fees, and PCI fees are entirely at the processor's discretion. We don't charge a monthly statement fee. We don't charge a batch fee."

---

EDUCATION POST #8
"The 'good deal' that isn't.

Processing agreement: 1.99% (sounds great)
Monthly statement fee: $15
PCI compliance fee: $29.95
Batch fee: $0.25/day × 30 days = $7.50
Gateway fee: $25
Total added: $76.45/month on top of the 1.99%

On $30K/month volume: $76.45 / $30,000 = 0.25% in effective rate
Real effective rate: 1.99% + 0.25% = 2.24%

That's not a bad deal — but it's not the 1.99% you were sold."

---

EDUCATION POST #9
"What's a batch fee? (You're probably paying it.)

A batch is the group of transactions settled at the end of each business day. Most processors charge $0.10–0.25 per batch, every day the terminal settles.

$0.15/day × 365 = $54.75/year
$0.25/day × 365 = $91.25/year

Across hundreds of merchants, this adds up to millions in revenue for processors — while appearing as a small, forgettable line item on your statement."

---

EDUCATION POST #10
"How to read your processing statement in 5 minutes:

Step 1: Find 'Total Sales Volume' or 'Gross Sales'
Step 2: Find 'Total Fees' or 'Total Processing Charges'
Step 3: Divide fees by volume → multiply by 100 → that's your effective rate

Step 4: Compare to industry benchmark:
  Restaurants: 2.2–2.8% is typical. Below 2% is excellent. Above 3% needs review.
  Medical: 2.0–2.6% is typical.
  Retail: 2.0–2.5% is typical.

If you're above the upper benchmark for your industry — there's likely room to improve."

────────────────────────────────────
LIBERTY ZERO™ POSTS (5 posts)
────────────────────────────────────

LIBERTY ZERO POST #1
"Liberty Zero™ — how it works in one paragraph:

Instead of you paying 2–3% on every card transaction, the fee is disclosed to the card-paying customer at checkout. Cash customers pay the listed price. Card customers pay a small service fee (typically 3–3.5%). The fee covers your processing cost — so what you collect is what you keep.

This is legal in all 50 states for cash discount structures. Surcharging rules vary by state.

The result for qualifying merchants: $0 in monthly processing fees.*

*Eligibility, state law, card brand rules, and underwriting apply."

---

LIBERTY ZERO POST #2
"Cash discount vs. surcharging — what's the difference?

Cash Discount:
  • Your posted price is the 'card price'
  • Cash customers receive a discount
  • Legal in all 50 states
  • Works for any merchant type

Surcharging:
  • Your posted price is the 'cash price'
  • Card customers pay an added fee (typically 3–4%)
  • Legal in most states (some restrictions apply)
  • Requires card brand registration

Liberty Zero can use either structure depending on your state, customer base, and business model. We verify eligibility before recommending."

---

LIBERTY ZERO POST #3
"Gas stations have been doing it for 50 years.

Cash price. Card price. The difference covers the cost of accepting the card.

Nobody complains. Nobody refuses to buy gas. It's completely transparent.

That's the Liberty Zero model — applied to restaurants, retail, auto repair, and service businesses. Customers understand the concept. Most don't object when it's disclosed clearly and the price difference is reasonable."

---

LIBERTY ZERO POST #4
"Who qualifies for Liberty Zero?

✓ Brick-and-mortar businesses (restaurant, retail, auto, salon, medical)
✓ Processing $5,000+/month
✓ Customers who are not extremely price-sensitive
✓ Average ticket high enough that a 3–3.5% service fee isn't disruptive
✓ Located in an eligible state (cash discount: all 50; surcharging: most)

Who it's not for:
✗ Very price-sensitive consumer markets (budget grocery at scale)
✗ E-commerce with high cart abandonment risk
✗ Merchants in the few states with surcharging restrictions (we check this)

Not sure if you qualify? Upload your statement and we'll confirm."

---

LIBERTY ZERO POST #5
"Real Liberty Zero example:

Restaurant processing $60,000/month
Previous processing cost: $1,800/month (at 3.0% effective)
After Liberty Zero: $0/month in processor fees

Customer experience: menu prices stay the same. A disclosed 3.5% service fee appears on the receipt for card-paying guests. Cash guests pay the menu price.

Net result for the owner: $1,800/month back. $21,600/year.

Setup: compliant signage, receipt configuration, staff script (we provide all three).

*Eligibility, state law, card brand rules, and underwriting apply."

────────────────────────────────────
TESTIMONIAL / CASE STUDY FRAMEWORKS (5 posts)
────────────────────────────────────

CASE STUDY FRAMEWORK #1
"{{Business Type}} in {{Prospect City}} — before and after:

Before Liberty Bancard:
  Monthly volume: $(Value)
  Effective rate: {{Effective Rate}}
  Monthly fees: $(Monthly Cost)

After Liberty Bancard (Liberty Zero):
  Monthly volume: $(Value)
  Effective rate: {{Effective Rate}}
  Monthly fees: $(Monthly Cost)

Monthly savings: $(Monthly Savings)
Annual savings: $(Monthly Cost)

'[Short merchant quote about the experience — focus on the review process or the savings, not hype]'

— {{First Name}}, {{Business Type}}, {{Prospect City}}"

---

CASE STUDY FRAMEWORK #2
"What {{First Name}} said after seeing the statement review:

'I'd been with {{Current Processor}} for {{Years}}. I assumed my rate was fine. When {{Agent Name}} showed me my actual effective rate was {{Effective Rate}} — and what I'd be paying on interchange-plus — I couldn't think of a reason not to switch.'

{{Business Type}}, {{Prospect City}}. Now on Liberty Zero. Saving approximately $(Monthly Savings)/month.

If you've been with your current processor for 3+ years and haven't had a rate review, you might be surprised by what a statement shows."

---

CASE STUDY FRAMEWORK #3
"Statement review milestone:

This month, we reviewed statements for 22 merchants who had never had anyone break down their processing bill line by line.

Average effective rate across those merchants: 3.2%
Average effective rate on our program: 1.9%
Average monthly savings: $540

The review took less than 10 minutes per merchant.
Most of them had been overpaying for 2+ years.

Free statement review: libertybancard.com/upload-statement"

---

CASE STUDY FRAMEWORK #4
"Restaurant owner's honest review:

'I was skeptical. Every processor promises savings. What was different with Liberty Bancard was they showed me my exact statement — line by line — before asking me to do anything. The math spoke for itself.'

— {{First Name}}, {{Business Type}}

That's the standard we hold ourselves to. If the math isn't there, we tell you. If it is, we show you the exact numbers before you make any decision."

---

CASE STUDY FRAMEWORK #5
"Before you ask 'Is it worth switching?':

Here's a simple way to think about it.

If our statement review shows you can save $400/month — that's $4,800/year. Switching takes 7–10 business days and about 2 hours of your time spread over two weeks.

$4,800 ÷ 2 hours = $2,400/hour value on your time.

If the math comes back at $200/month ($2,400/year), only you know if that's worth the effort.

We show you the number. You decide."`,
  },

  // ── FOLDER 02: Sales Playbooks & Scripts ────────────────────────────────

  masterSalesPlaybook: {
    title: "Master Sales Playbook",
    folder: "02",
    content: `LIBERTY BANCARD — MASTER SALES PLAYBOOK
========================================
The Definitive Guide to Selling Liberty Bancard
Version 1.0 | Internal — Agent & Manager Use

────────────────────────────────────
PART 1: MINDSET & POSITIONING
────────────────────────────────────

THE CORE BELIEF
We are not salespeople. We are cost analysts with a product.

Every conversation starts with the merchant's numbers — not ours. This is the statement-first approach, and it's the single most powerful thing about how Liberty Bancard sells.

Most processors pitch a rate. We show a merchant their real rate first, explain what's driving it, and then — and only then — present alternatives. This approach:
  • Builds credibility instantly (we're doing something others don't)
  • Makes the conversation about their numbers, not our product
  • Eliminates most objections before they arise (the math closes deals)
  • Generates referrals because merchants feel helped, not sold

THE SELLING STANDARD
Before you pitch anything, you must know:
  1. Their current monthly processing volume
  2. Their current effective rate (total fees ÷ total volume)
  3. The main cost drivers (what's making their rate what it is)
  4. Whether they're a Liberty Zero candidate

If you don't have these four things, you're pitching blind. We don't do that.

THE DIFFERENTIATION TRUTH
Liberty Bancard is different because:
  ✓ We start with a statement review — competitors start with a pitch
  ✓ We offer interchange-plus as standard — competitors hide behind tiered pricing
  ✓ We offer Liberty Zero™ — no other local ISO offers a compliant zero-fee program this clean
  ✓ We provide named support — not a 1-800 call center
  ✓ We don't promise savings before seeing the math — we prove it

────────────────────────────────────
PART 2: THE 5-STEP SALES PROCESS
────────────────────────────────────

STEP 1 — INTRODUCTION & PERMISSION (0–3 minutes)
Goal: Get permission to have a real conversation.

What NOT to do: Launch into a pitch about your company or how great your rates are.

What TO do: Identify yourself briefly, establish credibility through specificity, and ask permission to ask one question.

Script:
  "Hi {{Contact Name}}, this is {{Agent Name}} with Liberty Bancard. We specialize in statement-based payment reviews for {{Prospect Vertical}} businesses — I'm not here to pitch you today. I just want to ask one question: when did you last have someone actually calculate your real effective rate — total fees divided by total volume — not just your quoted rate?"

Most merchants pause here. They've never been asked this. That pause is your opening.

STEP 2 — DISCOVERY (3–10 minutes)
Goal: Understand their current situation well enough to know if there's a real opportunity.

Core discovery questions:
  • "What processor are you with right now?"
  • "Roughly how much do you process per month?"
  • "What do you pay in processing fees each month — total, including all the line items?"
  • "Have you ever calculated your effective rate — total fees divided by total volume?"
  • "How long have you been with your current processor?"
  • "Has your rate changed in the last 12 months?"

Listen for:
  → Volume above $10K/month (worth reviewing)
  → Effective rate above 2.5% (opportunity exists)
  → They don't know their effective rate (common — open door)
  → They mention a specific processor — note it, you can run a comparison
  → They've been with the same processor 3+ years (loyalty doesn't equal good pricing)

STEP 3 — STATEMENT COLLECTION (the pivot)
Goal: Get the statement. This is where most opportunities either move forward or stall.

The pivot:
  "Based on what you've told me, I think a statement review would show you something real. It takes about 10 minutes for me to run the analysis and build a side-by-side. Can you share your last 1–2 months' statements? You can email, text a photo, or upload at libertybancard.com/upload-statement — redact any account numbers if you're more comfortable."

If they hesitate:
  "I know it feels like a commitment — it's really not. The worst case: we look at it together and you confirm you're getting a good deal. Best case: we find $400–800/month you didn't know you were losing."

STEP 4 — ANALYSIS & PROPOSAL DELIVERY
Goal: Present the math clearly. Let the numbers do the selling.

Analysis structure (present in this order):
  1. Their current effective rate — state it clearly: "Your real effective rate is {{Merchant Effective Rate}}."
  2. Cost breakdown — what's driving it (tiered fees, monthly add-ons, downgrades)
  3. Benchmark — how does this compare to merchants their size in their vertical?
  4. Options:
     Option A — Interchange-plus: estimated effective rate, monthly cost, monthly savings
     Option B — Liberty Zero (if eligible): $0 in processor fees, monthly savings

Close the analysis with:
  "On Option A, you'd save approximately $450/month — that's $5,400/year. On Option B, your processor fees go to zero. Which one do you want to explore further?"

STEP 5 — CLOSE
Goal: Move from interest to commitment.

Assumptive close approach (use after clear interest):
  "Great — let me get the application started. What's the legal business name on your license?"

If they stall:
  "What's the one thing that's holding you back? I want to address it right now so you can make a decision with all the information."

If they say "I need to think about it":
  "Absolutely. What specifically do you want to think through? I'd rather address it now than have you sitting on unanswered questions."

────────────────────────────────────
PART 3: KEY DIFFERENTIATORS — HOW TO USE THEM
────────────────────────────────────

STATEMENT-FIRST APPROACH (use this every call)
The single biggest differentiator. Most reps pitch rates. You analyze statements. Frame it:
  "We don't start with our rates. We start with yours. Show me your statement and I'll tell you what you're actually paying — before I ask you to consider anything."

INTERCHANGE-PLUS PRICING
Use when: merchant is on tiered pricing or doesn't know what pricing model they have.
Talking point: "Tiered pricing means your processor assigns every transaction to a tier — qualified, mid-qual, non-qual. Under interchange-plus, you see the exact interchange for every card type. Nothing hidden. Most merchants on tiered are paying 0.5–1% more than they should be."

LIBERTY ZERO™
Use when: merchant has high card volume and high average ticket; Liberty Zero eligibility confirmed.
Talking point: "There's a program where your card-paying customers cover the processing cost — legally, transparently, with proper disclosure. It works like the cash/card price at a gas station. On your volume, that's $(Monthly Savings)/month you stop paying."

NAMED SUPPORT
Use when: merchant complains about poor support from current processor.
Talking point: "You'll have my direct number. When something goes wrong with a terminal or a deposit, you call me — not a 1-800 number. That's not marketing — that's how we operate."

────────────────────────────────────
PART 4: WHEN TO ESCALATE
────────────────────────────────────

Escalate to your manager when:
  → High-risk merchant vertical (nutraceuticals, CBD, adult, firearms, online gaming)
  → Monthly volume above $500K (requires special underwriting)
  → Merchant is in a lease they want broken (involves legal/financial analysis)
  → Merchant is threatening chargeback or dispute before switching
  → Any merchant who asks you to guarantee a rate before underwriting completes
  → Compliance-sensitive situations (e.g., merchant asking about surcharging in a restricted state)

DO NOT:
  → Promise a specific rate before underwriting review
  → Commit to specific approval timelines
  → Tell a merchant they definitely qualify for Liberty Zero without checking state law and merchant category
  → Negotiate the commission or pricing structure without manager authorization

────────────────────────────────────
PART 5: PERFORMANCE STANDARDS
────────────────────────────────────

Activity targets (new agents, first 30 days):
  • 30–50 cold calls/day
  • 5–8 discovery conversations/week
  • 2–3 statement requests/week
  • 1 proposal delivered/week

Conversion benchmarks (experienced agents):
  • Statement → Proposal: 70%+ (if you get the statement, you should be able to build a compelling proposal)
  • Proposal → Application: 35–50% (math should close most qualified merchants)
  • Application → Go-Live: 85%+ (underwriting closes the rest)

Pipeline hygiene:
  • Log every contact the same day it happens in GHL
  • Follow up within 24 hours of any statement submission
  • Review your pipeline every Monday morning — identify stalls
  • Move leads to nurture after 6+ unanswered follow-ups`,
  },

  coldCallScript: {
    title: "Cold Call Script & Talk Tracks",
    folder: "02",
    content: `LIBERTY BANCARD — COLD CALL SCRIPT & TALK TRACKS
=================================================
Version 1.0 | Internal — Agent Use

────────────────────────────────────
BEFORE YOU DIAL
────────────────────────────────────
Know these before the call:
  • Business name and owner/manager name (if available)
  • Business vertical
  • Approximate size (Google Maps reviews, Yelp, business website)
  • Who their likely processor is (Square/Stripe for SMB; Clover/Heartland for POS users)

Best times to call:
  • Restaurant owners: 9:30–11:00 AM (before lunch prep), 2:30–4:30 PM (after lunch service)
  • Medical/dental: 8:30–9:30 AM (before first patients), 12:30–1:30 PM (lunch)
  • Retail: 10:00 AM–12:00 PM, 2:00–4:00 PM
  • Auto repair: 8:00–10:00 AM, 2:00–4:00 PM
  • Contractors: 7:30–8:30 AM (before job sites)

────────────────────────────────────
OPENING SCRIPTS (3 VARIANTS)
────────────────────────────────────

OPENER A — DIRECT (Best for getting past gatekeepers)
"Hi, this is {{Contact Name}} with Liberty Bancard. Can I speak with {{Owner Name}}?"

(If they ask what it's about:)
"It's about their payment processing — I have some numbers specific to {{Business Name}} I'd like to share."

(Once connected with owner:)
"Hi {{Contact Name}}, I'm {{Agent Name}} with Liberty Bancard. We specialize in statement-based cost reviews for {{Prospect Vertical}} businesses. I don't know if this is relevant to you, but I'd like to ask you one quick question: when was the last time someone actually calculated your real effective rate — not your quoted rate, but total fees divided by total volume — and showed it to you line by line?"

---

OPENER B — PATTERN INTERRUPT (Best for skeptical owners who've heard every pitch)
"Hi {{Contact Name}}, this is {{Agent Name}} with Liberty Bancard. I know you probably get these calls — so I'm going to skip the pitch and just tell you what we actually do: we pull apart your processing statement line by line, show you what you're really paying, and compare it to what's possible. No pitch, just math. Would that 10-minute conversation be worth anything to you?"

(Note: The self-awareness of the pitch opens doors. Works especially well for independent owners who are time-pressed.]

---

OPENER C — REFERRAL / VERTICAL SOCIAL PROOF (Best when you have local examples)
"Hi {{Contact Name}}, I'm {{Agent Name}} with Liberty Bancard. I work with a few other {{Prospect Vertical}} businesses in Miami/South Florida — Mario's Italian Grille, Coral Ridge Auto Service — and I just finished a statement review that showed one of them they were overpaying by $(Monthly Savings)/month. I wanted to reach out to a few other {{Prospect Vertical}} businesses in the area and see if it's worth 10 minutes to run the same analysis. Would that make sense for you?"

────────────────────────────────────
GATEKEEPER HANDLING
────────────────────────────────────

"Who can I say is calling?"
→ "It's {{Agent Name}} with Liberty Bancard — it's about their payment processing."

"Is this about a sales call?"
→ "It's about a statement review — I have numbers specific to their business type. Is {{Owner Name}} available for 2 minutes?"

"They're not available right now."
→ "No problem — what's the best time to reach them? I'd rather call back than leave a voicemail if possible."

"Can you email instead?"
→ "I'd be happy to. Can you confirm the right email for {{Owner Name}}? And what's a good time to follow up to make sure they received it?"

────────────────────────────────────
DISCOVERY QUESTIONS (IN-CALL)
────────────────────────────────────
Once you have the owner's attention, move into discovery:

1. "What credit card processor are you with right now?"
2. "Roughly how much do you process per month?"
3. "Do you know what your effective rate is — total fees divided by total volume?"
4. "Has your rate gone up in the last year?"
5. "Are you on a month-to-month contract or a long-term agreement?"
6. "If we could show you a legitimate way to cut your processing cost by $(Monthly Cost)/month, is that something you'd want to see?"

────────────────────────────────────
THE STATEMENT PIVOT
────────────────────────────────────
"Based on what you've told me, I'm confident we can find savings — but I want to show you with your own numbers, not estimates. Can I ask you to do one thing? Pull your last statement — just one month — and either email it to me or upload it at libertybancard.com/upload-statement. Redact account numbers if you want, I just need the fee totals and volume lines. I'll build you a side-by-side in 24 hours."

If they hesitate:
  "The worst case is you confirm your current deal is competitive. Best case, you learn you're paying $400–800/month more than you should be. Either outcome is useful information."

────────────────────────────────────
VOICEMAIL SCRIPT (15–20 seconds)
────────────────────────────────────
"Hi {{Contact Name}}, this is {{Agent Name}} with Liberty Bancard — 954-266-8214. I work with {{Prospect Vertical}} businesses on reducing their card processing costs. I'd like to take 10 minutes to show you your real effective rate — total fees divided by total volume. Most businesses I talk to are surprised by the number. Give me a call back at 954-266-8214 or text me — I'll respond right away. Again, {{Agent Name}}, Liberty Bancard, 954-266-8214. Talk soon."

────────────────────────────────────
HANDLING INITIAL OBJECTIONS (CALL-LEVEL)
────────────────────────────────────

"I'm happy with my current processor."
→ "I'm glad to hear that — loyalty to a good processor makes sense. Quick question though: when did you last check whether their rates are still competitive? Rates change, and processors don't always proactively notify you. Would a 5-minute check be worth your time just to verify?"

"I don't have time right now."
→ "I completely understand — when's a better time? I can call back at exactly {{Scheduled Time}} if that works, and I'll keep it to 5 minutes."

"I'm locked in a contract."
→ "Understood. When does it end? I'll put a note in my calendar to follow up before the renewal. If your savings opportunity is big enough, breaking the contract can still make financial sense — but I'd want to know the ETF before recommending anything."

"Just send me information."
→ "Happy to — and I will. But I want it to be relevant to your specific situation, not a generic brochure. Can I ask two quick questions so I send you the right thing?"

"We already reviewed our rates last year."
→ "Good — can I ask what you found? Specifically, do you know your effective rate from that review? I'm asking because one review doesn't mean the rate stays competitive indefinitely, especially after the April interchange adjustment."

────────────────────────────────────
CLOSE OF CALL
────────────────────────────────────

If they agreed to a callback:
  "Perfect — I have you down for {{Scheduled Date}} at {{Scheduled Time}}. I'll call exactly then. What's the best number?"

If they agreed to share a statement:
  "Great — my email is info@libertybancard.com, or they can upload directly at libertybancard.com/upload-statement. I'll have numbers back to you within 24 hours."

If they said not interested:
  "I appreciate your time. Can I ask — is there a specific reason it doesn't feel relevant? I want to make sure I'm not missing something that might make it worth a future conversation."

After hanging up:
  → Log the contact in GHL within 1 hour
  → Note: name, business, result, agreed-upon follow-up date
  → Set a task for follow-up if applicable`,
  },

  objectionHandlingPlaybook: {
    title: "Objection Handling Playbook (20 Objections)",
    folder: "02",
    content: `LIBERTY BANCARD — OBJECTION HANDLING PLAYBOOK
==============================================
20 Most Common Merchant Objections with Word-for-Word Responses
Internal — Agent Use

USING THIS GUIDE:
  • Never argue. Acknowledge first, reframe second, bridge to the next step.
  • Use the exact language at first — then make it yours. These phrases work.
  • The goal of handling an objection is not to "win" — it's to get back on track.

────────────────────────────────────
1. "I'm locked in a contract."
────────────────────────────────────
Acknowledge: "That's one of the most common situations — and it's reasonable to feel stuck."
Reframe: "But here's the question: is the contract actually expensive to break, or does it just feel that way? A lot of contracts have ETFs of $200–500. If we can save you $600/month, the ETF pays back in less than one month."
Bridge: "Tell me — do you know what your early termination fee is? Let's look at the math before assuming you're stuck."

────────────────────────────────────
2. "My rates are fine — I'm happy with my processor."
────────────────────────────────────
Acknowledge: "That's the best place to be — if your rates genuinely are competitive, you should stay."
Reframe: "My question is: how recently did someone actually verify that? Processors increase rates without big announcements. And 'fine' usually means 'I haven't checked lately.'"
Bridge: "If you're right that your rates are fine, the statement review will confirm it in 10 minutes. And if you're wrong — you'll know exactly how much you're leaving on the table. Either way, it's useful."

────────────────────────────────────
3. "I tried another processor before and got burned."
────────────────────────────────────
Acknowledge: "I'm sorry that happened — and I've heard this a lot. The processing industry has a well-earned reputation for bait-and-switch."
Reframe: "That's actually why we start with your statement and show you the math on your numbers before asking for anything. We're not asking for commitment — we're asking for 10 minutes to show you something real."
Bridge: "What specifically went wrong last time? If it was a rate increase after signup, or hidden fees — I want to show you how we're structured differently."

────────────────────────────────────
4. "I don't have time."
────────────────────────────────────
Acknowledge: "I get it — you're running a business."
Reframe: "This is a 10-minute conversation, not an hour of your life. And the outcome is either a savings number you can act on, or confirmation that you don't need to do anything."
Bridge: "What's a better time — even 10 minutes this week? I'll work around your schedule completely."

────────────────────────────────────
5. "Just send me something in email."
────────────────────────────────────
Acknowledge: "Happy to — I just want to make sure it's relevant to your specific situation."
Reframe: "A generic one-pager about our services won't tell you whether you're overpaying. But if you share your statement, I can send you something specific to your numbers."
Bridge: "Can I ask one question first so the email I send you is actually useful?"

────────────────────────────────────
6. "We've been with our processor for 10+ years."
────────────────────────────────────
Acknowledge: "Long relationships are valuable — and loyalty means something."
Reframe: "The question I always ask in that situation: has your processor rewarded that loyalty with better rates? Because most don't. Most set your rate at signup and don't revisit it unless you push."
Bridge: "Have they ever proactively lowered your rate? If not — 10 years of loyalty may be costing you."

────────────────────────────────────
7. "I need to talk to my partner/spouse first."
────────────────────────────────────
Acknowledge: "Of course — this is a business decision and it makes sense to loop them in."
Reframe: "I'd love to help make that conversation easier. Let me build a one-page savings summary with your exact numbers — your effective rate, what we'd offer, and the monthly savings. That way you both have the same information in front of you."
Bridge: "When will you talk to them? I can have the summary to you before that conversation."

────────────────────────────────────
8. "I'm not the decision maker."
────────────────────────────────────
Acknowledge: "Understood — who should I connect with?"
Reframe: "I'd love to get the right person on a call. But before I reach out to them — can you tell me who handles the financial side? And what's the best way to reach them?"
Bridge: "Would it help if I shared a brief summary with you first so you have context when you introduce me?"

────────────────────────────────────
9. "Your rates are probably similar to what I have."
────────────────────────────────────
Acknowledge: "Maybe — and if that's what the math shows, I'll tell you."
Reframe: "But most merchants who say this are comparing their quoted rate to what we quote — not comparing effective rates to effective rates. That's where the real comparison lives."
Bridge: "Let me show you your effective rate and ours on the same page. Then you can make an apples-to-apples decision."

────────────────────────────────────
10. "I don't want to disrupt my operations."
────────────────────────────────────
Acknowledge: "That's a completely legitimate concern — switching processors can feel risky."
Reframe: "The transition takes 7–10 business days. Your current terminal often stays — we reprogram it remotely or ship a replacement overnight. The actual disruption is minimal."
Bridge: "Would it help to hear exactly what the transition looks like step by step? I can walk you through it in 5 minutes."

────────────────────────────────────
11. "I heard surcharging is illegal in my state."
────────────────────────────────────
Acknowledge: "This is a common concern, and it's partially true — surcharging rules do vary by state."
Reframe: "But cash discount — where cash customers receive a discount, which is different from adding a surcharge — is legal in all 50 states. We verify which structure applies to your state before recommending anything."
Bridge: "Tell me your state and I'll confirm which program options are available right now."

────────────────────────────────────
12. "I don't process enough for it to matter."
────────────────────────────────────
Acknowledge: "Volume matters for how much you save — but even $10K/month can be significant."
Reframe: "At $10K/month, a 1% rate reduction saves $100/month — $1,200/year. At $30K/month, that's $3,600/year. What's your approximate monthly volume?"
Bridge: "Let me calculate whether the savings justify a conversation. If they don't, I'll tell you honestly."

────────────────────────────────────
13. "I don't want my customers to pay more."
────────────────────────────────────
Acknowledge: "That's completely understandable — customer experience is a priority."
Reframe: "With cash discount, your card price becomes the posted price and cash customers receive a discount. Most customers don't experience this as paying more — they see consistent pricing, with a cash option."
Bridge: "If the cash discount program isn't a fit because of your customer base, we can run the numbers on interchange-plus instead — that saves you money without any change to the customer experience."

────────────────────────────────────
14. "We've tried to switch before and it was a nightmare."
────────────────────────────────────
Acknowledge: "Switching processors has a bad reputation — often deserved."
Reframe: "What went wrong? Was it terminal programming, approval timing, or something with the deposit setup? Because each of those has a specific fix, and knowing what tripped you up helps me tell you honestly whether we'd avoid it."
Bridge: "Let me walk you through exactly how our onboarding works so you can decide if it's different enough from your last experience."

────────────────────────────────────
15. "I want to compare more options first."
────────────────────────────────────
Acknowledge: "That makes sense — this is a business decision."
Reframe: "Here's what I'd suggest: let me build your side-by-side before you compare. You'll need a baseline with your real effective rate and our specific quote to make any comparison meaningful. Without that, you're comparing marketing language."
Bridge: "I can have your analysis ready in 24 hours. At that point, you'll have everything you need to compare us to anyone else."

────────────────────────────────────
16. "I'll think about it."
────────────────────────────────────
Acknowledge: "Of course — this deserves thought."
Reframe: "I want to respect your process. Can I ask: what's the main thing you want to think through? I'd rather address it now than have you sit on an unanswered question."
Bridge: "Is it the savings number, the transition process, or something about the program structure? Let me make sure you have all the information you need before we part ways."

────────────────────────────────────
17. "I had a bad experience with a salesperson from your industry."
────────────────────────────────────
Acknowledge: "I completely understand — the payments industry has bad actors and I don't defend the ones who gave you that experience."
Reframe: "What I can tell you is this: we start with your numbers, not ours. If the math doesn't work in your favor, we tell you. You're under no obligation until you choose to sign an application."
Bridge: "Give me 10 minutes to show you something real. If it feels like the same experience, you can end the call."

────────────────────────────────────
18. "My accountant handles this."
────────────────────────────────────
Acknowledge: "Smart to have an accountant involved in business decisions."
Reframe: "Accountants are excellent at tracking what you spend on processing. They're less often involved in optimizing it — that's not typically part of their scope."
Bridge: "I'd actually love to be introduced to your accountant — we can run the analysis together. A savings of $5,000+/year shows up on their P&L review too."

────────────────────────────────────
19. "My processor has great customer service."
────────────────────────────────────
Acknowledge: "Good support is worth paying for — and it's rare in this industry."
Reframe: "That's one of our actual differentiators too — you'll have a named contact with a direct line. But more importantly: great service at a high rate is still a high rate. Can both be true?"
Bridge: "Tell me what good service looks like for you — I want to confirm we can match or exceed that before we get to pricing."

────────────────────────────────────
20. "Can you just tell me your rates?"
────────────────────────────────────
Acknowledge: "I would, and I will — I just want to make sure the quote is meaningful."
Reframe: "Rates without context don't tell you whether you'd save money. Our markup is disclosed in the proposal (basis points over interchange) — but what that means for your monthly bill depends entirely on your card mix, volume, and current cost structure."
Bridge: "Tell me your approximate monthly volume and current effective rate — or better yet, share a statement — and I'll give you a number that means something."`,
  },

  statementReviewGuide: {
    title: "Statement Review Guide",
    folder: "02",
    content: `LIBERTY BANCARD — STATEMENT REVIEW GUIDE
=========================================
Step-by-Step Guide to Reading a Merchant Processing Statement
Internal — Agent & Manager Use

────────────────────────────────────
OVERVIEW
────────────────────────────────────
The statement review is the foundation of every Liberty Bancard sale. A great review:
  1. Makes the merchant feel seen and understood
  2. Builds trust through transparency
  3. Does the selling for you — the math closes deals

A statement review is NOT a pitch. It's a diagnostic. Your job during a review is to be the expert who interprets what they're looking at — not to steer toward a predetermined conclusion.

────────────────────────────────────
STEP 1: CALCULATE THE EFFECTIVE RATE
────────────────────────────────────
The effective rate is the single most important number on any statement.

Formula: Effective Rate = Total Fees Paid ÷ Total Volume Processed × 100

Where to find these numbers:
  → "Total Sales Volume," "Gross Sales," or "Monthly Processing Volume" — the total card volume
  → "Total Fees," "Total Processing Charges," or "Amount Due" — all fees combined

Example:
  Total volume: $48,500
  Total fees: $1,358
  Effective rate: $1,358 ÷ $48,500 × 100 = 2.80%

Why this matters: Most merchants were quoted a rate (e.g., 1.9% or 2.4%) that is lower than their effective rate. The difference is the story — and the savings opportunity.

────────────────────────────────────
STEP 2: IDENTIFY THE FEE STRUCTURE
────────────────────────────────────
Determine whether the merchant is on tiered or interchange-plus pricing.

TIERED PRICING (most common, least transparent):
  Signs: Look for sections labeled "Qualified," "Mid-Qualified," or "Non-Qualified" (abbreviated as Qual, Mid-Qual, NQ)
  What it means: The processor groups transactions into tiers and charges a per-tier rate. The margin between their cost (interchange) and what they charge you is hidden.
  Typical rates: Qualified ~1.5–2.0%, Mid-Qual ~2.3–2.8%, Non-Qual ~2.9–4.0%

INTERCHANGE-PLUS PRICING (transparent):
  Signs: Look for individual interchange category listings (e.g., "CPS Retail," "Visa Traditional," "MC World Elite") with their specific rates, plus a separate line showing the processor markup.
  What it means: You see the exact cost for every card type and the exact markup.

Most merchants are on tiered. Tiered pricing is almost always more expensive for merchants with significant rewards card volume — which is most merchants.

────────────────────────────────────
STEP 3: FIND THE HIDDEN FEES
────────────────────────────────────
Check for each of these fee types — note the amount if present:

1. MONTHLY STATEMENT FEE ($10–25/month)
   Often charged for a paper or PDF statement. Frequently unnecessary.

2. PCI COMPLIANCE / NON-COMPLIANCE FEE ($20–40/month)
   PCI compliance fee: charged annually or monthly, supposedly for compliance support
   PCI non-compliance fee: charged when the merchant hasn't completed their SAQ — often without notifying the merchant they need to
   Action: Ask if merchant has completed their annual Self-Assessment Questionnaire

3. BATCH FEE ($0.10–0.25/day)
   Charged each time the terminal settles its batch. $0.15 × 365 = $54.75/year in pure overhead.

4. MINIMUM MONTHLY FEE ($25–50/month)
   Charged when processing volume falls below a threshold. Hit hardest in slow months.

5. GATEWAY FEES ($10–35/month)
   For merchants using a separate payment gateway (Authorize.net, NMI, etc.). Check if they're also paying interchange through the gateway.

6. ANNUAL FEE ($50–150/year)
   Often buried in January or December statement. Easy to miss.

7. IRS REPORTING FEE ($2–5/year)
   Required 1099-K filing — legitimate but often marked up.

────────────────────────────────────
STEP 4: IDENTIFY INTERCHANGE DOWNGRADE EXPOSURE
────────────────────────────────────
Downgrades occur when a transaction qualifies for a more expensive interchange category than expected. This is the biggest source of hidden cost under tiered pricing.

Common downgrade triggers:
  • Rewards/premium credit cards (Visa Infinite, Chase Sapphire, Amex) — always higher interchange
  • Non-EMV transactions (swiped instead of chip) — triggers non-qual downgrade
  • Keyed card numbers — always higher interchange than card-present
  • Late batch settlement (not settling same business day)
  • Missing transaction data (AVS, card verification)
  • Corporate/purchasing cards — typically B2B interchange category

On a tiered statement: Look for the Non-Qualified volume percentage. If NQ volume is >20% of total, downgrades are a major cost driver.

On an interchange-plus statement: Look for "Visa Infinite," "MC World Elite," "Corporate Card" categories — these are the premium interchange rates.

────────────────────────────────────
STEP 5: BUILD THE SAVINGS CASE
────────────────────────────────────
Once you have the merchant's current effective rate, build a projection:

LIBERTY BANCARD INTERCHANGE-PLUS ESTIMATE:
  Typical wholesale markup: 0.10% + $0.08 per transaction
  Estimate effective interchange cost for their vertical:
    Restaurant (high rewards card usage): ~1.55–1.75%
    Medical/dental: ~1.45–1.65%
    Retail: ~1.50–1.70%
    Auto repair: ~1.60–1.80%
    E-commerce: ~1.70–2.00%

  Add markup to estimated interchange = estimated effective rate

Example savings calculation:
  Current:      $48,500 × 2.80% = $1,358/month in fees
  Liberty IP:   $48,500 × 1.70% = $824/month
  Monthly savings: $534
  Annual savings: $6,408

LIBERTY ZERO ESTIMATE (if eligible):
  Processor fees drop to $0
  Monthly savings = their entire current monthly fee
  Note: must confirm state law, merchant category, and underwriting eligibility

────────────────────────────────────
STEP 6: DELIVER THE REVIEW
────────────────────────────────────

Structure of a great statement review delivery:

1. START WITH THEIR CURRENT STATE
   "Your real effective rate is {{Merchant Effective Rate}}. That's total fees divided by total volume. Your quoted rate was {{Quoted Rate}} — the difference is the specific fees outlined above."

2. EXPLAIN THE COST DRIVERS
   "The biggest cost drivers I see are: [1], [2], [3]."

3. SHOW THE BENCHMARK
   "For {{Prospect Vertical}} businesses at your volume, typical effective rates on interchange-plus are 1.6–2.2%. You're at {{Merchant Current Rate}}."

4. PRESENT OPTIONS
   "Here are two paths I'd recommend considering:
    Option A — Interchange-Plus: You'd pay approximately {{New Effective Rate}}, saving about $(Monthly Savings)/month.
    Option B — Liberty Zero: If you qualify, processor fees go to $0, saving $(Monthly Savings)/month."

5. INVITE QUESTIONS
   "What questions do you have about the numbers before we talk about next steps?"

────────────────────────────────────
COMMON STATEMENT FORMATS — QUICK REFERENCE
────────────────────────────────────

Square / Stripe: Simple flat-rate. Look at total sales and total processing fees on dashboard summary. Usually 2.6–2.9% + per-transaction fee. Easy to convert — the math is transparent.

Heartland / Global Payments: Often interchange-plus but with high markup. Look for "Margin" or "Markup" line. Effective rate is usually 2.2–2.8%.

Fiserv / First Data: Tiered pricing most common. Look for "Interchange Summary" and "Non-Qual Surcharge" sections. Effective rates often 2.6–3.4%.

Clover (Fiserv backend): Same as Fiserv above. Note the monthly software fee separately ($9.95–69.95) — not part of processing cost but part of total cost of ownership.

TSYS / Worldpay: Tiered pricing common. Look for rate tiers on page 2–3. Effective rates often 2.5–3.2%.

Toast: Usually stated as their published rate (2.49–2.99% + monthly SaaS fee). Calculate effective rate including the SaaS fee for an accurate total cost of ownership comparison.`,
  },

  closingScripts: {
    title: "Closing Scripts & Urgency Framework",
    folder: "02",
    content: `LIBERTY BANCARD — CLOSING SCRIPTS & URGENCY FRAMEWORK
======================================================
Internal — Agent Use

────────────────────────────────────
THE CLOSING MINDSET
────────────────────────────────────
The close is not a separate event. It's the natural conclusion of a well-run review.

If you've run a great discovery, collected a real statement, built an honest analysis, and presented clear savings — the merchant is already 70% of the way to a decision. The closing scripts here are for the final 30%: addressing stalls, moving from verbal to written commitment, and handling last-minute hesitation.

The word "close" means "move to the next step" — not "apply pressure."

────────────────────────────────────
TRIAL CLOSES (USE THROUGHOUT)
────────────────────────────────────
Trial closes test commitment at each stage. Use them liberally throughout the conversation:

"If the numbers make sense, is there any reason you wouldn't want to move forward?"

"Based on everything we've talked about, does this sound like something that could work for your business?"

"If I can show you saving $600/month with no disruption to your operations, what would you need to make a decision?"

"On a scale of 1–10, how interested are you in exploring this further? What would move it to a 10?"

────────────────────────────────────
THE SAVINGS REVEAL MOMENT
────────────────────────────────────
The most important moment in any sales call is when you reveal the savings number. How you deliver it sets the tone for the close.

Structure:
1. State their current cost clearly: "Right now, you're paying $1,200/month in processing fees."
2. Pause. Let it land.
3. State the alternative: "On our interchange-plus program, that same volume costs approximately $680–750/month."
4. Calculate the savings out loud: "That's $450–520 back in your pocket every month. Or $5,400–6,240/year."
5. Ask the trial close: "Does the math make sense to you?"

DO NOT rush past the savings number. Let the merchant sit with it.

────────────────────────────────────
MAIN CLOSING SCRIPTS
────────────────────────────────────

THE DIRECT CLOSE
After revealing a clear savings number with agreement from the merchant:

"You're currently paying $(Current Monthly Cost) and we'd get you to $(New Monthly Cost). That's $(Monthly Savings) back every month. I can get your application started today — it takes about 10 minutes. What's the legal business name on your license?"

(Note: The assumptive transition ("What's the legal business name") signals you're moving to the next step without asking 'do you want to sign?' — which invites hesitation.]

---

THE SUMMARIZE AND ASK CLOSE
After a full review when the merchant seems warm but hasn't committed:

"Let me summarize what we've covered. Your current effective rate is {{Merchant Effective Rate}} — you're paying $(Current Monthly Cost) in processing fees each month. On our interchange-plus program, we'd project your rate at {{Interchange-Plus Rate}}, saving you approximately $(Monthly Savings)/month. The transition takes 7–10 business days. Is there anything standing between you and getting started today?"

---

THE COMPARISON CLOSE
When merchant says they want to compare other options:

"That's completely reasonable — and I'd encourage it. Here's what I'd suggest: let me send you our exact proposal in writing. That gives you a specific, documented offer with real numbers to compare against. Any other proposal that doesn't show your actual effective rate and a line-item savings breakdown isn't a real comparison. When you have that document in hand, I'd love 10 minutes to answer questions."

────────────────────────────────────
HANDLING "I NEED TO THINK ABOUT IT"
────────────────────────────────────
"Absolutely. Can I ask — what's the main thing you want to think through? I want to make sure you have all the information you need."

(Listen to their answer. Address the specific concern.)

"I understand. Here's what I'll do: let me send you the written summary with all the numbers we discussed — your current rate, our projected rate, and the savings breakdown. That way you have the full picture in writing. Can we set a specific time to reconnect — even just 15 minutes?"

[Set a specific callback time. Vague "I'll call you next week" stalls go nowhere.]

────────────────────────────────────
URGENCY TRIGGERS (USE SPARINGLY AND HONESTLY)
────────────────────────────────────

Legitimate urgency triggers — only use if true:

INTERCHANGE ADJUSTMENT URGENCY:
"Interchange rates typically adjust in April and October. If we can get your program in place before next month, you lock in the new structure without paying a higher rate in the interim."

PROMOTION / RATE-LOCK URGENCY:
"We have a rate-lock promotion through April 30th — once it expires, the markup may adjust. If we can get your application in this week, you'd secure today's terms."

CONTRACT EXPIRATION:
"You mentioned your contract ends in the end of the quarter. To avoid an auto-renewal, we'd need to start the application process at least 30 days before expiration. We're 2 weeks from that now."

Month-End:
"Processing is slower at end of month — if we start the application today, we can aim for a April 30th go-live rather than mid-next month."

────────────────────────────────────
VERBAL AGREEMENT → WRITTEN CONFIRMATION BRIDGE
────────────────────────────────────
Once the merchant verbally agrees to move forward:

"Great — I'm really glad we were able to put the numbers together. Here's what happens next:

1. I'll send you a short application — it's an online form and takes about 10 minutes. You'll need your business name, EIN, voided check (or bank routing info), and driver's license.

2. I'll also need 3 months of processing statements for underwriting. You may have already shared one — just the additional two.

3. Underwriting typically takes 2–5 business days. I'll keep you posted at each step.

4. Once approved, we'll program your terminal (or ship a new one) and get you live.

Does that process work for you? I'll send the application link right now — can you look for it in the next 15 minutes and get it started while we're on the phone?"

────────────────────────────────────
AFTER THE CALL — SAME DAY FOLLOW-UP
────────────────────────────────────
Within 1 hour of a committed close:
  → Send email with application link, your direct number, and next steps
  → Send text: "Hi {{Contact Name}}, great talking! Application link just sent to {{Merchant Email}}. Reply here if you have any questions. — {{Contact Name}}, Liberty Bancard"

Day 1 (if application not started):
  "Hi {{Contact Name}}, just checking in on the application — did you get the link okay? Takes about 10 minutes if you want to knock it out this afternoon."

Day 3 (if still not started):
  Call. "Hi {{Contact Name}}, I wanted to follow up on the application. Did anything come up? Happy to walk you through it on the phone if that's easier — it only takes 10 minutes."`,
  },

  // ── VERTICAL TALK TRACKS — 13 individual docs ──────────────────────────

  tt_restaurant: {
    title: "Talk Tracks — Restaurant",
    folder: "02",
    content: `LIBERTY BANCARD — TALK TRACKS: RESTAURANT
==========================================
Internal Agent Use

PAIN POINTS UNIQUE TO RESTAURANTS:
  • Thin margins (4–8% net) — processing fees are a material cost
  • High card volume — 80–90% of sales are card
  • High rewards card usage — diners use Amex Platinum, Chase Sapphire
  • Tip-adjust settlement exposure — late tip submission creates downgrades
  • Toast/Square dependency — merchants feel locked into the POS ecosystem

KEY SAVINGS ANGLES:
  • Non-qualified downgrade from rewards cards — often 0.5–1% higher than they realize
  • Liberty Zero is extremely natural for restaurants — "like a gas station, cash vs. card pricing"
  • Tip adjustment optimization — proper settlement timing alone saves 0.2–0.5%

COMMON OBJECTIONS UNIQUE TO RESTAURANTS:
  "We use Toast and can't switch our POS." → "We can review your processing cost vs. what you'd pay elsewhere. If the savings are big enough, the switch to Clover Station Duo has a clear payback timeline."
  "Customers won't like the surcharge." → "Cash discount works differently — you post the card price, cash customers receive a discount. Most of our restaurant clients see minimal friction."

OPENING HOOKS (restaurant-specific):
  • "I work with restaurants in {{Prospect City}}. Most are overpaying on rewards cards — can I show you your card-type breakdown?"
  • "We just finished a review for a Italian restaurant in South Florida — they were paying 3.1% effective. Dropped to 1.7%. 10 minutes if I can show you the same?"`,
  },

  tt_medical: {
    title: "Talk Tracks — Medical & Healthcare",
    folder: "02",
    content: `LIBERTY BANCARD — TALK TRACKS: MEDICAL & HEALTHCARE
=====================================================
Internal Agent Use

PAIN POINTS UNIQUE TO MEDICAL:
  • High average ticket ($300–$2,000+) → more premium cards = more downgrade exposure
  • Low chargeback rate (patients don't dispute doctor charges often) → favorable risk profile
  • PCI non-compliance fee often charged without merchant knowing they're non-compliant
  • Statement fees charged for statements they never review

KEY SAVINGS ANGLES:
  • Healthcare interchange categories are actually favorable — tiered pricing hides this
  • PCI compliance audit — eliminating non-compliance fee alone saves $240–480/year
  • Statement fee elimination — $120–300/year recovered immediately

OPENING HOOKS (medical-specific):
  • "I work with medical practices in South Florida. Most are on tiered pricing, which hides the favorable interchange rates healthcare transactions actually qualify for."
  • "Do you know whether you're paying a PCI compliance fee or a PCI non-compliance fee? They look identical on the statement — the difference is whether it's being charged fairly."`,
  },

  tt_retail: {
    title: "Talk Tracks — Retail",
    folder: "02",
    content: `LIBERTY BANCARD — TALK TRACKS: RETAIL
======================================
Internal Agent Use

PAIN POINTS UNIQUE TO RETAIL:
  • Thin margins (20–40% gross) — processing fees consume a large % of net profit
  • Card mix skews toward premium rewards cards (boutique shoppers especially)
  • Often comparing themselves to "the Square rate" — don't know their interchange-plus options
  • Inventory systems may be tied to a specific POS processor

KEY SAVINGS ANGLES:
  • Debit card transactions — huge volume at favorable interchange rates, often buried in tiered
  • Premium rewards card downgrade exposure — identify NQ volume %
  • Cash discount for retail: customers accustomed to it from gas stations, online checkout fees

OPENING HOOKS (retail-specific):
  • "What processor are you using for your POS? I want to show you what the same volume costs under interchange-plus — the transparent pricing model."
  • "Your premium shoppers — the ones using Amex, Chase Sapphire, Visa Infinite — are actually your most expensive customers to swipe. Can I show you why?"`,
  },

  tt_auto: {
    title: "Talk Tracks — Auto Repair",
    folder: "02",
    content: `LIBERTY BANCARD — TALK TRACKS: AUTO REPAIR
===========================================
Internal Agent Use

PAIN POINTS UNIQUE TO AUTO:
  • High average ticket ($400–$2,000) → top rewards card territory
  • Fleet accounts and corporate cards → B2B interchange categories under tiered pricing
  • Manual keyed transactions (over-the-phone deposits) → always higher interchange
  • Strong Liberty Zero candidate — high ticket = small % fee that customers accept

KEY SAVINGS ANGLES:
  • Fleet/corporate card exposure — often 30–40% of auto repair volume is corporate cards
  • Liberty Zero at high average ticket — $800 repair, disclosed $28 service fee — very little pushback
  • Keyed transaction optimization — proper terminal setup reduces manual entry

OPENING HOOKS (auto-specific):
  • "Do you have fleet accounts or customers paying with corporate cards? Those are almost always the most expensive transactions under tiered pricing."
  • "Liberty Zero — the zero-fee program — tends to work really well for auto shops. At $800 average repair, a disclosed service fee is usually accepted without issue. Want to see the math?"`,
  },

  tt_hotel: {
    title: "Talk Tracks — Hotel & Hospitality",
    folder: "02",
    content: `LIBERTY BANCARD — TALK TRACKS: HOTEL & HOSPITALITY
====================================================
Internal Agent Use

PAIN POINTS UNIQUE TO HOSPITALITY:
  • Card-not-present authorization holds → higher interchange exposure
  • Manual key-entry for phone reservations → downgrade trigger
  • Guests use premium travel rewards cards → expensive interchange categories
  • Multiple revenue streams (rooms, restaurant, spa) → mixed card types

KEY SAVINGS ANGLES:
  • CNP vs. card-present breakdown — are authorization-to-settle patterns creating downgrades?
  • Proper data submission for hotel industry interchange categories
  • Volume-based markup reduction opportunities

OPENING HOOKS:
  • "Hotels have some of the most complex interchange patterns of any vertical — and most are on tiered pricing that hides the complexity behind a single rate."
  • "Are you running authorization holds and settling at checkout? The timing and data submission on those transactions directly affects your interchange cost."`,
  },

  tt_lawfirm: {
    title: "Talk Tracks — Law Firms",
    folder: "02",
    content: `LIBERTY BANCARD — TALK TRACKS: LAW FIRMS
==========================================
Internal Agent Use

PAIN POINTS UNIQUE TO LAW:
  • Large retainers → premium credit cards → worst non-qual downgrade
  • Corporate/business credit cards → B2B interchange available with proper data
  • Billing software may not submit Level 2/3 data → leaves interchange savings on table
  • Trust account payment complications

KEY SAVINGS ANGLES:
  • Level 2/3 data submission on corporate card retainers — can reduce interchange by 0.5–1.0%
  • Current processor likely using tiered and capturing the B2B spread
  • Trust account-compliant processing options

OPENING HOOKS:
  • "Do many of your clients pay retainers with corporate or business credit cards? If your billing software isn't submitting Level 2/3 data, you're paying consumer rates on B2B transactions."`,
  },

  tt_salon: {
    title: "Talk Tracks — Salon & Spa",
    folder: "02",
    content: `LIBERTY BANCARD — TALK TRACKS: SALON & SPA
===========================================
Internal Agent Use

PAIN POINTS UNIQUE TO SALON & SPA:
  • Tip-adjust settlement — must settle within 24 hours to avoid downgrade
  • Mixed payment types — service + retail (product sales) at different margins
  • Stylists using their own square accounts — fragmented processing
  • Loyal clientele → regular customers who'll accept disclosed service fee with minimal friction

KEY SAVINGS ANGLES:
  • Tip-adjust optimization alone saves 0.2–0.5% for many salons
  • Consolidating stylist processing under one account — better volume = better rate
  • Liberty Zero well-accepted by loyal repeat clientele

OPENING HOOKS:
  • "For salons with tip adjustments, the settlement timing directly affects your interchange rate. When does your terminal batch?"
  • "Do your stylists run their own Square accounts, or is everything centralized? There's a volume advantage to centralization."`,
  },

  tt_dental: {
    title: "Talk Tracks — Dental",
    folder: "02",
    content: `LIBERTY BANCARD — TALK TRACKS: DENTAL
======================================
Internal Agent Use

PAIN POINTS UNIQUE TO DENTAL:
  • Patients use their best rewards cards for out-of-pocket dental work
  • Multi-location practices paying inconsistent rates at each location
  • Insurance payment timing creates complex reconciliation
  • PCI fee almost always present; compliance often not completed

KEY SAVINGS ANGLES:
  • Rewards card heavy volume → interchange-plus captures actual rate for each card type
  • Multi-location rate consolidation — better blended terms across locations
  • PCI compliance completion → eliminate non-compliance fee

OPENING HOOKS:
  • "Patients spending $2,000 on implants are using their Amex Platinum or Chase Sapphire. Under your current pricing, those are probably your most expensive transactions. Can I show you your card type breakdown?"`,
  },

  tt_gym: {
    title: "Talk Tracks — Gym & Fitness",
    folder: "02",
    content: `LIBERTY BANCARD — TALK TRACKS: GYM & FITNESS
=============================================
Internal Agent Use

PAIN POINTS UNIQUE TO GYM & FITNESS:
  • Recurring monthly billing → stored card CNP transactions → higher interchange
  • Mixed revenue: memberships + drop-in + retail → multiple transaction types
  • Chargebacks from cancelled memberships — this is a real risk area
  • Drop-in class consumers: Liberty Zero natural fit

KEY SAVINGS ANGLES:
  • CNP recurring billing optimization — proper submission codes reduce downgrade
  • Liberty Zero for walk-in/drop-in traffic — low-ticket purchases well-suited
  • Chargeback management and prevention included in program

OPENING HOOKS:
  • "Recurring membership billing on stored cards is technically a card-not-present transaction — which carries higher interchange. Are you being charged accordingly on tiered pricing?"`,
  },

  tt_ecommerce: {
    title: "Talk Tracks — E-Commerce",
    folder: "02",
    content: `LIBERTY BANCARD — TALK TRACKS: E-COMMERCE
==========================================
Internal Agent Use

PAIN POINTS UNIQUE TO E-COMMERCE:
  • Everything is CNP → highest interchange category
  • Usually on Stripe, Square, or PayPal → paying 2.9%+ flat rate
  • High transaction volume → per-transaction fees add up significantly
  • International card surcharge on Stripe can be hidden

KEY SAVINGS ANGLES:
  • Moving from Stripe/Square flat rate to interchange-plus: significant savings at $25K+/month
  • B2B e-commerce: Level 2/3 data → major interchange reduction on corporate card sales
  • Gateway compatibility — most existing gateways (NMI, Authorize.net) work with our program

OPENING HOOKS:
  • "What platform are you on — Stripe or Square? At your volume, you're almost certainly paying 2–4× more than you'd pay on interchange-plus. The math is straightforward."`,
  },

  tt_contractors: {
    title: "Talk Tracks — Contractors",
    folder: "02",
    content: `LIBERTY BANCARD — TALK TRACKS: CONTRACTORS
===========================================
Internal Agent Use

PAIN POINTS UNIQUE TO CONTRACTORS:
  • Field service model → mostly mobile/keyed transactions → higher interchange
  • Large ticket sizes → premium cards → expensive interchange categories
  • Sometimes no terminal — using Square Reader or invoices
  • Liberty Zero extremely natural — customers understand service fee on large jobs

KEY SAVINGS ANGLES:
  • Proper EMV terminal eliminates keyed-entry downgrade exposure
  • Liberty Zero at high ticket — $2,000 HVAC job with disclosed $70 fee → accepted
  • Move from Square to professional processing + terminal

OPENING HOOKS:
  • "Are you using a card reader or keying card numbers over the phone? Keyed-entry transactions always cost more in processing. A proper terminal setup would change that."`,
  },

  tt_grocery: {
    title: "Talk Tracks — Grocery",
    folder: "02",
    content: `LIBERTY BANCARD — TALK TRACKS: GROCERY
=======================================
Internal Agent Use

PAIN POINTS UNIQUE TO GROCERY:
  • Very high transaction volume → per-transaction fee optimization critical
  • Card mix is 50–70% debit → debit interchange optimization is major opportunity
  • Thin margins (1–3% net) → any fee reduction is significant
  • Cash discount / Liberty Zero is extremely normalized in grocery

KEY SAVINGS ANGLES:
  • Debit card routing and interchange optimization
  • Per-transaction fee reduction at high transaction volumes
  • Cash discount program — already standard in many markets

OPENING HOOKS:
  • "At your transaction volume, your per-transaction fee adds up more than your percentage rate. What are you paying per transaction right now?"`,
  },

  tt_cstore: {
    title: "Talk Tracks — Convenience Store",
    folder: "02",
    content: `LIBERTY BANCARD — TALK TRACKS: CONVENIENCE STORE
==================================================
Internal Agent Use

PAIN POINTS UNIQUE TO C-STORES:
  • Very high transaction count, low average ticket ($10–30) → per-transaction costs dominate
  • Mix of fuel + in-store → fuel transactions have special interchange rules
  • Cash-heavy historically, but card usage growing → optimization timing is now
  • Gas station cash/card pricing already normalized with customers

KEY SAVINGS ANGLES:
  • Per-transaction fee optimization — most important cost driver at c-store transaction volume
  • Debit PIN routing — significant cost reduction for debit-heavy volume
  • Liberty Zero: cash discount already visible at the pump for in-store as well

OPENING HOOKS:
  • "How many card transactions do you run per day? For c-stores, the per-transaction fee is often a bigger driver than the percentage rate — especially with high debit volume."`,
  },

  // ── FOLDER 03: Outreach Sequences & Templates ────────────────────────────

  emailSequenceMap: {
    title: "Email Sequence Map — All Sequences",
    folder: "03",
    content: `LIBERTY BANCARD — EMAIL SEQUENCE MAP
=====================================
All Outreach Sequences | Audience | Trigger | Steps | Timing
Internal Use | Synced with GHL Workflows

────────────────────────────────────────────────────────────────
SEQUENCE 1: COLD MERCHANT OUTREACH — RESTAURANT
────────────────────────────────────────────────────────────────
Audience:     Restaurant owners with no prior contact
Trigger:      Lead added to "Restaurant Cold" campaign in GHL
Steps:        5
Channel:      Email (primary), SMS (steps 3 & 5)

Step 1 (Day 0):    Email — Savings hook: "Stop losing 3% of every table to your processor"
Step 2 (Day 3):    Email — Social proof: local restaurant savings example
Step 3 (Day 5):    SMS — "Hi {{Contact Name}}, {{Agent Name}} from Liberty Bancard. Worth 10 min to check your rate?"
Step 4 (Day 8):    Email — Pain point: "Have you ever calculated your real effective rate?"
Step 5 (Day 14):   Email + SMS — Breakup: "If now isn't the right time, no problem — happy to revisit later."

Exit Conditions:   Reply received (any step), Appointment booked, Unsubscribe/DNC
Stop Rule:        ANY reply stops the sequence — rep handles manually from there

────────────────────────────────────────────────────────────────
SEQUENCE 2: COLD MERCHANT OUTREACH — MEDICAL / DENTAL
────────────────────────────────────────────────────────────────
Audience:     Medical/dental practice owners, office managers
Trigger:      Lead added to "Medical Cold" campaign
Steps:        5
Channel:      Email (primary), SMS (step 3)

Step 1 (Day 0):    Email — Rate education: "Healthcare practices on tiered pricing are overpaying"
Step 2 (Day 4):    Email — PCI angle: "Is there a PCI fee on your statement you didn't know about?"
Step 3 (Day 7):    SMS — Brief intro + link to statement upload
Step 4 (Day 11):   Email — Volume-specific math (estimate savings for their practice type)
Step 5 (Day 16):   Email — Breakup

Exit Conditions:   Reply, appointment, statement upload, unsubscribe

────────────────────────────────────────────────────────────────
SEQUENCE 3: COLD MERCHANT OUTREACH — RETAIL
────────────────────────────────────────────────────────────────
Audience:     Retail business owners (boutique, hardware, specialty)
Steps:        5
Channel:      Email + SMS (step 3)

Step 1 (Day 0):    Email — Margin angle: "Your margins are too thin to pay tiered pricing"
Step 2 (Day 3):    Email — Competitor angle (if Square/Stripe user): "Square vs. interchange-plus math"
Step 3 (Day 6):    SMS — Check-in
Step 4 (Day 10):   Email — Rewards card education
Step 5 (Day 15):   Email — Breakup

────────────────────────────────────────────────────────────────
SEQUENCE 4: COLD MERCHANT OUTREACH — AUTO REPAIR
────────────────────────────────────────────────────────────────
Audience:     Auto repair shop owners, service managers
Steps:        5

Step 1 (Day 0):    Email — Fleet/corporate card angle
Step 2 (Day 3):    Email — Liberty Zero math for high-ticket repairs
Step 3 (Day 6):    SMS
Step 4 (Day 10):   Email — Statement review offer
Step 5 (Day 14):   Email — Breakup

────────────────────────────────────────────────────────────────
SEQUENCE 5: COLD MERCHANT OUTREACH — CONTRACTOR
────────────────────────────────────────────────────────────────
Audience:     Contractors (HVAC, plumbing, electrical, construction)
Steps:        4

Step 1 (Day 0):    Email — Mobile payment / keyed transaction cost angle
Step 2 (Day 4):    Email — Liberty Zero for large-ticket jobs
Step 3 (Day 8):    SMS + Email — Terminal upgrade offer
Step 4 (Day 13):   Email — Breakup

────────────────────────────────────────────────────────────────
SEQUENCE 6: POST-STATEMENT-UPLOAD FOLLOW-UP
────────────────────────────────────────────────────────────────
Audience:     Merchants who uploaded a statement but haven't booked a call
Trigger:      Statement received, no appointment in CRM after 4 hours
Steps:        6
Channel:      Email (primary), SMS (steps 2 & 5)

Step 1 (Day 0, 1hr after upload): Email — "Got your statement — here's your effective rate"
Step 2 (Day 0, 3hrs after):       SMS — "Hi {{Contact Name}}, statement received. Can we connect today at {{Scheduled Time}}?"
Step 3 (Day 1):    Email — Full proposal: current rate vs. Liberty Bancard options
Step 4 (Day 3):    Email — Follow-up on proposal: any questions?
Step 5 (Day 5):    SMS — "Did you get a chance to look at the proposal? Happy to walk through it."
Step 6 (Day 10):   Email — Breakup with open invitation

Exit: Appointment booked, application started, unsubscribe

────────────────────────────────────────────────────────────────
SEQUENCE 7: RE-ENGAGEMENT — 30-DAY STALL
────────────────────────────────────────────────────────────────
Audience:     Leads who showed interest but went quiet for 30+ days
Trigger:      No contact in 30 days after last engagement; lead still in pipeline
Steps:        3

Step 1 (Day 0):    Email — "Still thinking about the statement review?"
Step 2 (Day 5):    Email — New angle (rate increase news, interchange adjustment)
Step 3 (Day 10):   Email — Final: "If now isn't the right time, happy to reconnect later"

────────────────────────────────────────────────────────────────
SEQUENCE 8: REFERRAL PARTNER NURTURE
────────────────────────────────────────────────────────────────
Audience:     CPAs, bookkeepers, insurance agents, chamber contacts enrolled as referral partners
Trigger:      Partner agreement signed or referral partner intro call completed
Steps:        5 (ongoing — quarterly after initial sequence)

Step 1 (Day 0):    Email — Welcome: how the program works, portal link, referral guide
Step 2 (Day 7):    Email — Introduce case study or savings example to share with clients
Step 3 (Day 21):   Email — Commission update or "here's how to make a warm intro"
Step 4 (Day 45):   Email — Check-in: "Any clients you've been thinking of introducing?"
Step 5 (Quarterly): Email — Partnership update: new programs, new case studies, earnings summary

────────────────────────────────────────────────────────────────
SEQUENCE 9: WIN-BACK — LOST DEAL
────────────────────────────────────────────────────────────────
Audience:     Merchants who went through the review but chose a competitor or chose to stay
Trigger:      Deal marked "Lost" or "Stayed with current processor" in pipeline
Steps:        3
Timing:       Start 90 days after deal close date

Step 1 (Day 90):   Email — "Checking back in — has anything changed?"
Step 2 (Day 120):  Email — Rate increase trigger: "Interchange adjusted last month — did your rate go up?"
Step 3 (Day 180):  Email — Final outreach with updated comparison

────────────────────────────────────────────────────────────────
CAMPAIGN ARCHITECTURE OVERVIEW
────────────────────────────────────
Sequence                           Audience              Trigger              Steps  Channel
─────────────────────────────────  ────────────────────  ───────────────────  ─────  ──────────────
1. Cold — Restaurant               Restaurant owners     Added to campaign    5      Email + SMS
2. Cold — Medical/Dental           Practice owners       Added to campaign    5      Email + SMS
3. Cold — Retail                   Retail owners         Added to campaign    5      Email + SMS
4. Cold — Auto Repair              Auto shop owners      Added to campaign    5      Email + SMS
5. Cold — Contractor               Contractors           Added to campaign    4      Email + SMS
6. Post-Statement Upload           Statement uploaders   Statement received   6      Email + SMS
7. Re-engagement (30-day stall)    Stalled leads         30 days no contact   3      Email
8. Referral Partner Nurture        Partner network       Partner enrolled     5      Email
9. Win-Back                        Lost deals            90 days post-loss    3      Email`,
  },

  smsTemplatesLibrary: {
    title: "SMS Templates Library (20+ Templates)",
    folder: "03",
    content: `LIBERTY BANCARD — SMS TEMPLATES LIBRARY
========================================
20+ Compliant SMS Templates | Internal Agent Use

COMPLIANCE NOTES:
  • All SMS must include opt-out language on first contact: "Reply STOP to opt out"
  • Collect TCPA consent before any SMS to new contacts (via web form, verbal, or checkbox)
  • Do not send SMS before 8 AM or after 9 PM in the recipient's timezone
  • Maximum recommended length: 160 characters (1 SMS segment) — go to 320 if needed
  • Variable fields in {{double curly braces}} are merge fields — personalize before sending
  • Do not include savings claims in cold SMS — use curiosity/question angle instead

────────────────────────────────────
INITIAL OUTREACH SMS
────────────────────────────────────

COLD SMS #1 — GENERAL
"Hi {{Contact Name}}, {{Agent Name}} from Liberty Bancard. Quick Q: when did you last check your real processing rate (not the quoted one)? Worth 10 min? Reply YES or call 954-266-8214. STOP to opt out."
(approx. 155 characters)

COLD SMS #2 — RESTAURANT
"Hi {{Contact Name}}, {{Agent Name}} here. We help {{Prospect City}} restaurants cut processing costs. Can I show you your real effective rate? Takes 10 min. Reply YES or call 954-266-8214. STOP to opt out."
(approx. 155 characters)

COLD SMS #3 — MEDICAL
"Hi {{Contact Name}}, {{Agent Name}} from Liberty Bancard. We work with medical practices on processing costs. Worth a quick statement review? No obligation. Reply or call 954-266-8214. STOP to opt out."

COLD SMS #4 — LIBERTY ZERO HOOK
"Hi {{Contact Name}}, {{Agent Name}} from Liberty Bancard. Some {{Prospect Vertical}} businesses are now paying $0 to process cards (legally, with disclosed fees). Curious if you qualify? Reply or call 954-266-8214. STOP to opt out."

────────────────────────────────────
APPOINTMENT REMINDER SMS
────────────────────────────────────

REMINDER #1 — DAY BEFORE
"Hi {{Contact Name}}, just a reminder — we have a call tomorrow at {{Scheduled Time}} to review your processing statement. Looking forward to it. Any questions beforehand? — {{Agent Name}}, Liberty Bancard"

REMINDER #2 — 1 HOUR BEFORE
"Hi {{Contact Name}}, our call is in 1 hour at {{Scheduled Time}}. Here's the dial-in if you need it: 954-266-8214. — {{Agent Name}}, Liberty Bancard"

REMINDER #3 — RESCHEDULED CALL
"Hi {{Contact Name}}, confirming our rescheduled call for {{Scheduled Date}} at {{Scheduled Time}}. If anything changes, just text me here. — {{Agent Name}}, Liberty Bancard"

────────────────────────────────────
FOLLOW-UP AFTER NO-SHOW SMS
────────────────────────────────────

NO-SHOW #1 — IMMEDIATE
"Hi {{Contact Name}}, missed you on our {{Scheduled Time}} call — no worries. When's a good time to reschedule? Takes 10 min. — {{Agent Name}}, Liberty Bancard"

NO-SHOW #2 — NEXT DAY
"Hi {{Contact Name}}, {{Agent Name}} here. Still happy to run the statement review we had scheduled — just need 10 minutes. What works this week?"

NO-SHOW #3 — 3 DAYS LATER
"Hi {{Contact Name}}, last follow-up on the statement review. If now isn't the right time, no problem — just reply PAUSE and I'll check in next quarter. — {{Agent Name}}, Liberty Bancard"

────────────────────────────────────
STATEMENT REQUEST SMS
────────────────────────────────────

STATEMENT REQUEST #1 — FIRST ASK
"Hi {{Contact Name}}, to put together your savings comparison, can you share last month's processing statement? Email to info@libertybancard.com or upload at libertybancard.com/upload-statement. — {{Agent Name}}"

STATEMENT REQUEST #2 — FOLLOW-UP (24hrs later)
"Hi {{Contact Name}}, following up on the statement — did you get a chance to find it? You can redact account numbers, just need fee totals and volume. — {{Agent Name}}, Liberty Bancard"

STATEMENT REQUEST #3 — SIMPLIFIED ASK
"Hi {{Contact Name}}, even a photo of your statement works — I just need the total fees and total volume lines. Texting it to me is fine too. — {{Agent Name}}"

────────────────────────────────────
PROPOSAL DELIVERY SMS
────────────────────────────────────

PROPOSAL #1 — DELIVERY NOTIFICATION
"Hi {{Contact Name}}, your statement analysis is ready. I just sent a full breakdown to info@libertybancard.com — current rate vs. our program, with exact savings. Worth 10 min to review. — {{Agent Name}}"

PROPOSAL #2 — SAME DAY FOLLOW-UP
"Hi {{Contact Name}}, wanted to make sure you got the analysis email. Any questions on the numbers? Happy to walk through it now or schedule a quick call. — {{Agent Name}}"

PROPOSAL #3 — NEXT DAY
"Hi {{Contact Name}}, checking in on the proposal from yesterday. Was there anything in the breakdown you wanted to discuss? — {{Agent Name}}, Liberty Bancard"

────────────────────────────────────
POST-CLOSE / ONBOARDING SMS
────────────────────────────────────

APPLICATION SUBMITTED
"Hi {{Contact Name}}, got your application — thank you! Underwriting typically takes 2–5 business days. I'll keep you posted. Call or text me anytime. — {{Agent Name}}, Liberty Bancard"

APPROVAL NOTIFICATION
"Great news, {{Contact Name}} — you've been approved! I'll get your terminal programmed (or shipped). Expect setup within 5–7 business days. Any questions? — {{Agent Name}}"

GO-LIVE CHECK-IN
"Hi {{Contact Name}}, your new processing should be live today. Did your first transactions process okay? Let me know if anything looks off. — {{Agent Name}}, Liberty Bancard"

DAY 7 CHECK-IN
"Hi {{Contact Name}}, checking in on your first week. Everything processing smoothly? First deposit come through okay? — {{Agent Name}}, Liberty Bancard"

DAY 30 CHECK-IN
"Hi {{Contact Name}}, it's been about a month — how's the new setup working for you? Would love to hear how the transition went. — {{Agent Name}}"

────────────────────────────────────
REFERRAL REQUEST SMS
────────────────────────────────────

REFERRAL ASK — 30 DAYS POST GO-LIVE
"Hi {{Contact Name}}, glad things are working well! If you know another {{Prospect Vertical}} owner who might benefit from a free statement review, I'd love an intro. — {{Agent Name}}, Liberty Bancard"`,
  },

  linkedInPlaybook: {
    title: "LinkedIn Outreach Playbook",
    folder: "03",
    content: `LIBERTY BANCARD — LINKEDIN OUTREACH PLAYBOOK
=============================================
Connection Requests | InMail Scripts | Follow-Up Sequences
Internal Agent Use

────────────────────────────────────
LINKEDIN TARGETING GUIDELINES
────────────────────────────────────
Best prospect filters on LinkedIn:
  • Title: Owner, CEO, Founder, Managing Partner, Practice Manager, Office Manager
  • Industry: Food & Beverages, Medical Practice, Retail, Automotive, Legal Services, Health, Wellness & Fitness
  • Company size: 1–50 employees (owner-operated, decision maker accessible)
  • Location: Your territory or target geography
  • Connection degree: 2nd preferred (credibility through mutual connection)

Who to reach out to for referral partnerships:
  • Certified Public Accountants (CPA)
  • Bookkeepers / Controllers
  • Business insurance agents and brokers
  • Chamber of Commerce officers/directors
  • Business attorneys

────────────────────────────────────
CONNECTION REQUEST MESSAGES
────────────────────────────────────
(300 character limit — be concise)

CONNECTION #1 — BUSINESS OWNER (PAIN-POINT ANGLE)
"Hi {{Contact Name}}, I help {{Prospect Vertical}} business owners reduce their credit card processing costs — starting with a free statement review. Not sure if it's relevant, but worth connecting. — {{Agent Name}}"
(approx. 165 characters)

CONNECTION #2 — MUTUAL CONNECTION ANGLE
"Hi {{Contact Name}}, {{Mutual Connection}} suggested I reach out — I work with business owners on payment processing. Happy to connect and share resources whether or not there's a fit. — {{Agent Name}}"

CONNECTION #3 — VERTICAL-SPECIFIC
"Hi {{Contact Name}}, I work specifically with {{Prospect Vertical}} businesses on processing costs. A lot of owners in your space are on outdated pricing structures. Thought it was worth connecting. — {{Agent Name}}"

CONNECTION #4 — REFERRAL PARTNER (CPA/BOOKKEEPER)
"Hi {{Contact Name}}, I work with CPAs in South Florida on referral partnerships — when their clients are overpaying on processing, we can help and share a commission. Worth connecting? — {{Agent Name}}"

────────────────────────────────────
INMAIL SCRIPTS (FOR PREMIUM USERS)
────────────────────────────────────
(Limit: 300 characters for connection requests; InMail allows 1,900 characters — keep under 400 for response rates)

INMAIL #1 — BUSINESS OWNER (STATEMENT REVIEW PITCH)
Subject: Quick question about your processing costs

"Hi {{Contact Name}},

I specialize in statement-based cost reviews for {{Prospect Vertical}} businesses in South Florida.

Short version: most business owners I talk to have never seen their real effective rate — total fees divided by total volume. When I show them that number vs. what's possible on interchange-plus pricing, there's almost always a meaningful gap.

I'm not asking you to switch anything. I'd like to pull apart your last statement and show you exactly what you're paying and why — takes about 10 minutes.

Worth a quick call this week?

{{Agent Name}}
Liberty Bancard | 954-266-8214"

---

INMAIL #2 — REFERRAL PARTNER PITCH
Subject: Commission opportunity for your clients' processing costs

"Hi {{Contact Name}},

I work with CPAs and financial professionals in South Florida on a referral program that may be useful for your clients.

If you have clients who accept credit cards for their business, there's a good chance they're overpaying — particularly if they're on tiered pricing or flat-rate processors like Square/Stripe.

When we work with a referred client, you earn a monthly commission for as long as they process with us. Average referral partner earns $50–$300/month per merchant referred.

Would 15 minutes to discuss make sense?

{{Agent Name}}
Liberty Bancard | 954-266-8214"

────────────────────────────────────
FOLLOW-UP SEQUENCES (POST-CONNECTION)
────────────────────────────────────

For Business Owner Prospects:
  Day 3 after connection: Send connection thank-you + brief value proposition
  Day 7: Share educational content (savings post, fee education)
  Day 14: Direct ask for statement review or call
  Day 30: Final check-in or offer to revisit later

Template — Day 3 Message (after accepted connection):
"Hi {{Contact Name}}, thanks for connecting. I work with {{Prospect Vertical}} businesses specifically on identifying where processing costs can be reduced — starting with a statement review. No pitch on the first call — just math. If that's ever useful to you, I'm here. — {{Agent Name}}"

Template — Day 7 Message (educational touch):
"Hi {{Contact Name}}, sharing something that's come up a lot lately: most {{Prospect Vertical}} owners don't know their real effective rate — total fees divided by total volume. If you've never calculated it, your quoted rate may be 0.5–1% lower than what you're actually paying. Happy to show you how to find it on your statement."

Template — Day 14 Message (direct ask):
"Hi {{Contact Name}}, last thing I'll send for a while — would you be open to a 10-minute call to review your processing statement? I'll show you your real rate and whether there's a legitimate savings opportunity. No strings. If there isn't, I'll tell you that too. — {{Agent Name}}"

For Referral Partners:
  Day 3: Thank you + brief program overview
  Day 7: Share a case study (anonymized merchant example)
  Day 14: Ask for a 15-min call to discuss the partnership
  Monthly: Share commission updates, new case studies, vertical insights

────────────────────────────────────
PERSONALIZATION FIELD GUIDE
────────────────────────────────────
For every LinkedIn message, personalize at least one element:
  • Reference their specific business name or location
  • Reference a mutual connection if applicable
  • Reference their specific vertical or title
  • Reference recent activity on their profile (a post, a comment, a job change)

What to check before sending:
  ✓ Is this person the actual decision maker for processing?
  ✓ Is there mutual connection content worth referencing?
  ✓ Can you estimate their approximate processing volume from their business profile?
  ✓ Is the message under 300 characters for connection requests?`,
  },

  referralPartnerOutreachKit: {
    title: "Referral Partner Outreach Kit",
    folder: "03",
    content: `LIBERTY BANCARD — REFERRAL PARTNER OUTREACH KIT
================================================
Email + Phone Scripts for Recruiting Referral Partners
Internal Agent Use

────────────────────────────────────
TARGET REFERRAL PARTNER TYPES
────────────────────────────────────
Priority 1: CPAs and tax preparers — see all their clients' processing costs on P&L
Priority 2: Bookkeepers and controllers — handle the statements monthly
Priority 3: Business insurance agents — existing trusted advisors to business owners
Priority 4: Chamber of Commerce officers — access to member directories
Priority 5: Commercial real estate brokers — new tenants need processing

────────────────────────────────────
REFERRAL PARTNER EMAIL TEMPLATES
────────────────────────────────────

EMAIL #1 — CPA / BOOKKEEPER
Subject: Partnership opportunity — your clients' processing costs

"Hi {{Contact Name}},

As a CPA or bookkeeper, you're in a unique position: you see your clients' P&L every month, which means you see exactly how much they're paying to accept credit cards.

I work with Liberty Bancard, and we've built a referral program specifically for financial professionals like you. Here's how it works:

When you introduce us to a client who might be overpaying, we:
  1. Do a free statement review (no pitch, just math)
  2. Show them their real effective rate and whether we can improve it
  3. If they switch, you earn a monthly commission — typically $50–300/month per client, indefinitely

We currently pay {{Value}}% of the gross processing margin as a recurring referral commission. There's no work on your end after the intro — just an introduction email or phone call.

The clients best suited for a referral: any business processing $10K+/month in cards — restaurants, medical practices, retail, contractors, auto repair.

Would 15 minutes this week make sense to walk through the details?

{{Agent Name}}
Liberty Bancard | 954-266-8214"

---

EMAIL #2 — INSURANCE AGENT
Subject: Your business owner clients may be overpaying on processing — partner opportunity

"Hi {{Contact Name}},

I want to bring you a referral opportunity that's genuinely useful for your clients.

I work with Liberty Bancard — we do payment processing cost reviews for business owners. Most business owners are overpaying between $200–$1,000/month in processing fees without realizing it.

For your clients who accept credit cards, a free 10-minute statement review can confirm whether they're getting a fair deal. If they're not, they save money. If they are, they get confirmation.

When clients switch through your referral, you earn a monthly commission for as long as they process with us. No limit on how long it continues.

This tends to be a natural conversation with clients who mention cash flow concerns or are looking for ways to reduce overhead.

Interested in a 15-minute call to discuss?

{{Agent Name}}
Liberty Bancard | 954-266-8214"

---

EMAIL #3 — CHAMBER OF COMMERCE
Subject: Merchant savings program — Liberty Bancard partnership for {{Chamber Name}} members

"Hi {{Contact Name}},

I'm reaching out because I believe there's a genuine value-add we can offer to {{Chamber Name}} members.

Liberty Bancard offers a free processing cost review to any business that accepts credit cards. For most members, this identifies $300–$1,500/month in savings they didn't know they had.

We're interested in:
  • A member spotlight or newsletter mention
  • An educational presentation at a Chamber event (15 minutes: how to read your processing statement)
  • A dedicated referral arrangement if members who switch generate a partnership commission

This is not a pitch session — it's genuinely educational. Most attendees learn something useful about their statement regardless of whether they switch.

Would this be worth a conversation?

{{Agent Name}}
Liberty Bancard | 954-266-8214"

────────────────────────────────────
PHONE SCRIPTS — REFERRAL PARTNER
────────────────────────────────────

OPENING (CPA or bookkeeper)
"Hi {{Contact Name}}, this is {{Agent Name}} with Liberty Bancard. We do statement-based processing cost reviews for business owners. I'm calling because I work with a lot of CPAs in South Florida, and I think there's a referral arrangement that would be genuinely useful for your clients — and worth your time financially. Do you have 2 minutes?"

(If yes:)
"We pay a recurring monthly commission — typically $50–300/month per client — to CPAs and bookkeepers who introduce us to their business owner clients. The intro is just a warm email or call. We handle everything from there. Would that be worth a 15-minute conversation this week?"

PITCH FOR THE PROGRAM (after interest established)
"Here's how it works in plain language:

You have clients who accept credit cards. Some of them are overpaying — often by a lot — and they don't know it because processing statements are deliberately confusing.

When you introduce us, we do a free statement review. No pitch on the first call — we just show them their real effective rate and explain what's driving their cost. If we can save them money, they switch. If not, you've done them a favor by getting a second opinion.

For every merchant who switches through you, we pay you a monthly residual commission based on their processing volume. You earn it every month for as long as they're with us — not just the first year.

Does that model make sense for your practice?"

HANDLING HESITATION
"I'm not interested in a referral arrangement."
→ "Understood — and there's no pressure. Can I ask what your hesitation is? Sometimes the issue is a conflict of interest with another vendor relationship, sometimes it's just bandwidth. I want to make sure I'm not misreading the situation."

"I don't want to recommend financial products."
→ "That makes sense. This isn't really a financial product — it's more like introducing a client to someone who can audit a specific line item on their P&L. You're not recommending a product; you're saying 'I found someone who can look at your processing bill and tell you if it's competitive.' That's a service, not a product sale."

────────────────────────────────────
REFERRAL PARTNER ONBOARDING STEPS
────────────────────────────────────
Once a referral partner agrees:
  1. Send referral partner agreement (from Legal/Compliance folder)
  2. Set up their portal access at libertybancard.com/agent-portal
  3. Brief them on how to make an intro (email template provided)
  4. Share the "Quick Reference Card" they can show clients
  5. Add them to the "Referral Partner Nurture" sequence in GHL
  6. Schedule 30-day check-in call

Commission details:
  • Paid monthly, typically on the 15th
  • Accessible via partner portal — shows client list, volume, and commission earned
  • No cap on number of referrals or earnings`,
  },

  // ── FOLDER 04: SOPs & Operating Procedures ─────────────────────────────

  dailyOperationsSOP: {
    title: "Daily Operations SOP — Sales Rep Workflow",
    folder: "04",
    content: `LIBERTY BANCARD — DAILY OPERATIONS SOP
=======================================
Full Daily Workflow for Sales Representatives
Internal Use

────────────────────────────────────
MORNING ROUTINE (8:30–9:30 AM)
────────────────────────────────────
Duration: 45–60 minutes

8:30 AM — Pipeline Review (15 min)
  □ Open GHL — review all contacts with scheduled callbacks for today
  □ Identify any deals that moved (applications submitted, approvals received)
  □ Flag any statement uploads received overnight → prioritize for same-day analysis
  □ Review any new inbound leads assigned to you

8:45 AM — Email & SMS Check (15 min)
  □ Read and respond to all emails received since yesterday 5PM
  □ Review SMS replies — any sequences that need manual handling?
  □ Check sequence stop notifications — any contacts who replied and need manual follow-up?

9:00 AM — Daily Task Review (15 min)
  □ Open task list — sort by due date
  □ Identify top 3 most important tasks for the day
  □ Defer or reschedule tasks that aren't happening today (don't let them pile up)
  □ Block your outreach window on your calendar (9:30 AM – 12:00 PM)

────────────────────────────────────
OUTREACH BLOCK #1 (9:30 AM – 12:00 PM)
────────────────────────────────────
Duration: 2.5 hours | Goal: 25–40 dials (new agents), 15–25 dials (experienced agents with callbacks)

Outreach order (prioritize highest value):
  1. Callbacks and follow-ups with pre-booked times
  2. Statement upload follow-ups (within 24 hours of upload)
  3. Hot leads (spoke in last 7 days, showed interest)
  4. Warm leads (interacted but no statement yet)
  5. Cold outreach (new prospects)

For each call, log immediately:
  □ Contact status updated in GHL
  □ Notes added: what was said, what they agreed to, follow-up date
  □ Next task created with due date and reminder

────────────────────────────────────
MID-DAY (12:00 – 1:00 PM)
────────────────────────────────────
  □ Lunch break — disconnect fully if possible
  □ Optional: Review any statement received during the morning — run analysis if urgent

────────────────────────────────────
OUTREACH BLOCK #2 (1:00 – 4:00 PM)
────────────────────────────────────
Duration: 3 hours | Mix of calls and admin

1:00 – 1:30 PM — Statement Analysis
  □ Process any statements received since morning
  □ Build comparison proposals in the savings calculator tool
  □ Email proposals to merchants with analysis completed

1:30 – 3:30 PM — Continued Outreach
  □ Continue calling through your daily list
  □ Medical/dental vertical: 1:30–2:30 PM is good window (after lunch)
  □ Retail: 2:00–4:00 PM is good window

3:30 – 4:00 PM — Email Batch
  □ Send any follow-up emails from today's calls
  □ Add contacts from today's calls to appropriate GHL sequences
  □ Respond to any emails received during outreach blocks

────────────────────────────────────
END-OF-DAY REVIEW (4:00 – 5:00 PM)
────────────────────────────────────

4:00 PM — Pipeline Hygiene (20 min)
  □ Update stage for all deals touched today
  □ Remove stale tasks; create fresh follow-up tasks
  □ Identify any deals stalled >5 days — review strategy or escalate
  □ Check pipeline health: how many in each stage?

4:20 PM — Tomorrow's Prep (15 min)
  □ Review calendar for tomorrow — any calls already scheduled?
  □ Build tomorrow's callback list (sorted by priority)
  □ Identify merchants who need same-day statement follow-up tomorrow morning

4:35 PM — Reporting (15 min)
  □ Log your daily activity metrics:
     - Dials made: ___
     - Conversations (live connects): ___
     - Statement requests made: ___
     - Statements received: ___
     - Proposals sent: ___
     - Applications started: ___
  □ Note any issues, blockers, or wins for weekly standup

────────────────────────────────────
TIME-BLOCKED SCHEDULE TEMPLATE
────────────────────────────────────
8:30–9:30       Morning routine (pipeline, email, task review)
9:30–12:00      Outreach Block #1 (calls — highest value first)
12:00–1:00      Lunch
1:00–1:30       Statement analysis / proposal building
1:30–3:30       Outreach Block #2
3:30–4:00       Email batch + sequence management
4:00–4:20       Pipeline hygiene
4:20–4:35       Tomorrow's prep
4:35–5:00       Daily metrics log + wrap

────────────────────────────────────
WEEKLY RHYTHMS
────────────────────────────────────
Monday:         Pipeline audit + weekly goal setting + team standup
Tuesday–Thursday: Peak outreach days — full blocks, no admin overload
Friday:         Wrap up open proposals, plan next week, complete training or coaching

────────────────────────────────────
GHL PIPELINE HYGIENE STANDARDS
────────────────────────────────────
Every contact in the pipeline must have:
  ✓ Most recent conversation note (within 48 hours)
  ✓ A next-action task with a due date
  ✓ The correct stage in the pipeline
  ✓ Tags indicating lead source and vertical

Contacts that do not meet these standards should be:
  → Updated immediately when you notice
  → Flagged to your manager if there's a reason you can't update them
  → Not left in a vague "In Progress" state indefinitely`,
  },

  statementCollectionSOP: {
    title: "Statement Collection & Analysis SOP",
    folder: "04",
    content: `LIBERTY BANCARD — STATEMENT COLLECTION & ANALYSIS SOP
======================================================
Step-by-Step Process for Requesting, Receiving, and Analyzing Merchant Statements
Internal Use

────────────────────────────────────
PART 1: STATEMENT REQUEST
────────────────────────────────────

STEP 1: MAKE THE REQUEST (DURING CALL)
  During your discovery call, once you've confirmed the merchant is a good candidate (processes $10K+/month, shows interest in reviewing their costs), ask for the statement:

  "To build you an accurate comparison, I need to work from your actual statement — not estimates. Can you share your most recent month's processing statement? The easiest ways:
    • Email a PDF or photo to info@libertybancard.com
    • Upload at libertybancard.com/upload-statement (secure, encrypted)
    • Text a photo to 954-266-8214

  You can redact any account numbers — I just need the total volume and fee line items."

STEP 2: SET THE TIMELINE
  "I'll have a full comparison back to you within 24 hours of receiving it. Can we schedule a 15-minute call for {{Specific Day/Time}} to walk through it together?"

STEP 3: CONFIRM WHAT YOU NEED
  If they're unsure which document to send, help them find it:
  • "It's usually called your 'Monthly Processing Statement' or 'Merchant Statement'"
  • "Your processor emails it monthly — check your inbox from your processor"
  • "It should show your total sales volume and a list of fees for the month"
  • "If you have multiple months, the most recent one is fine — we can request more if needed"

────────────────────────────────────
PART 2: ACCEPTABLE FILE FORMATS
────────────────────────────────────
Accepted:
  ✓ PDF (any quality)
  ✓ Photo or scan (JPG, PNG) — needs to be readable
  ✓ Screenshot of online dashboard (Square, Stripe, PayPal)
  ✓ Emailed directly from the processor to you (forward)

What to do if format is unclear:
  → If image is blurry or cropped, ask for a clearer photo or a PDF
  → If they send a dashboard screenshot, confirm it shows monthly totals (not daily)
  → If they send multiple months, use the most recent completed month

What you need at minimum:
  1. Total monthly processing volume (gross sales)
  2. Total fees for that month (all-in)
  3. Any monthly fees listed separately (PCI, statement, gateway, etc.)
  4. Transaction count (if visible) — for per-transaction fee analysis

────────────────────────────────────
PART 3: STATEMENT UPLOAD PORTAL
────────────────────────────────────
  • Portal URL: libertybancard.com/upload-statement
  • Files are encrypted in transit and at rest
  • Access is restricted to admin and authorized agents only
  • Merchants are notified when upload is received (automated)

When a statement is uploaded:
  → System creates a notification in GHL under the merchant's contact record
  → Assigned rep receives email notification
  → Rep should begin analysis within 2 hours during business hours

────────────────────────────────────
PART 4: RUNNING THE ANALYSIS
────────────────────────────────────

STEP 1: CALCULATE EFFECTIVE RATE
  Effective Rate = Total Fees ÷ Total Volume × 100

STEP 2: IDENTIFY FEE STRUCTURE
  • Look for tiered or interchange-plus structure (see Statement Review Guide for details)
  • Note the % of non-qualified transactions if tiered

STEP 3: LIST ALL MONTHLY FEES
  Go through every line item and categorize:
  • Processing fees (interchange, assessments, markup) — unavoidable but can be reduced
  • Monthly add-on fees (statement, PCI, batch, gateway) — often eliminable
  • Annual or quarterly fees (note if amortized monthly)

STEP 4: CALCULATE SAVINGS
  Build comparison in the savings calculator:
  • Their current effective rate → their current monthly cost
  • Liberty Bancard interchange-plus estimate → projected monthly cost
  • Liberty Zero (if applicable) → $0 processor fees

STEP 5: BUILD THE PROPOSAL
  Proposal format (2-page max):
  Page 1 — Summary: current rate, projected rate, monthly savings, annual savings
  Page 2 — Detail: fee-by-fee breakdown with notes on what's driving cost

────────────────────────────────────
PART 5: PROPOSAL DELIVERY
────────────────────────────────────

Delivery standards:
  • Deliver within 24 hours of statement receipt (same business day preferred)
  • Always deliver on a scheduled call — walk through the numbers, don't just email
  • Email the written proposal the same day for them to reference

Call script for proposal delivery:
  "Before I share the numbers, I want to walk you through how I read the statement — just so you can see the math yourself. (Walk through effective rate calculation.) Here's what I found: (present findings). Here are your options: (present options A and B). Which one makes more sense for your business?"

DATA HANDLING:
  • Merchant statements contain sensitive financial information
  • Do not store statements on personal devices or personal cloud storage
  • Upload to the secure portal or the designated secure folder only
  • Do not share statement data with anyone outside Liberty Bancard
  • Delete email attachments after uploading to the secure portal
  • Merchants can request deletion of their statement at any time`,
  },

  merchantOnboardingSOP: {
    title: "Merchant Onboarding SOP",
    folder: "04",
    content: `LIBERTY BANCARD — MERCHANT ONBOARDING SOP
==========================================
Everything After the Merchant Signs
Internal Use

────────────────────────────────────
ONBOARDING CHECKLIST OVERVIEW
────────────────────────────────────
Target timeline: 5–10 business days from application to processing live
Your job: keep the merchant informed at every step and remove blockers immediately

────────────────────────────────────
STAGE 1: DOCUMENT COLLECTION (Day 1–2)
────────────────────────────────────
Required documents for standard merchant application:

□ Signed merchant application (completed online or PDF)
□ Voided check (for ACH/bank deposit setup — must match business account)
□ Copy of government-issued photo ID (owner/signer — driver's license or passport)
□ 3 months of processing statements (if switching from another processor)
□ Business license (required for certain verticals or high-volume merchants)

High-risk documentation requirements (vertical-specific):
□ CBD/nutraceuticals: product COAs, FDA registration
□ Firearms: FFL copy
□ Medical: state medical license for prescribers
□ Legal: bar membership confirmation
→ Always confirm with underwriting what's needed before requesting from merchant

Document delivery methods:
  • Merchant portal upload (preferred — secure, tracked)
  • Email to underwriting@libertybancard.com (second option — note in CRM)
  • Fax: 954-266-0000 (last resort — confirm receipt)

────────────────────────────────────
STAGE 2: UNDERWRITING SUBMISSION (Day 2–3)
────────────────────────────────────
□ Confirm all required documents received
□ Submit application to underwriting via the Liberty Bancard underwriting portal
□ Update GHL deal stage to "Underwriting Submitted"
□ Set a task to follow up with underwriting if no response in 3 business days

Underwriting review covers:
  • Credit check on business owner (soft pull usually)
  • Business verification (name, address, EIN, legal status)
  • Processing history review (3 months statements)
  • Chargeback history (if any)
  • Vertical and business model review

Common underwriting delays:
  → Missing documents — check the list; request immediately
  → High-risk vertical flag — may need additional documentation
  → Credit threshold issues — escalate to manager
  → Unusual business model — get a merchant description in writing from the merchant

Merchant communication during underwriting:
  "Your application is in underwriting — typical turnaround is 2–5 business days. I'll email you as soon as we have an update. Do you have any questions in the meantime?"

────────────────────────────────────
STAGE 3: APPROVAL & SETUP (Day 3–7)
────────────────────────────────────
□ Receive approval notification from underwriting
□ Confirm merchant's MID (Merchant ID) is assigned
□ Determine terminal approach:
  Option A: Reprogram existing terminal (Clover, Dejavoo, PAX)
  Option B: Ship new terminal — confirm shipping address with merchant
□ Terminal programmed and tested
□ Batch settlement time confirmed with merchant
□ Liberty Zero signage kit ordered/shipped (if applicable)

Test transaction:
  □ Run a $1 test transaction on the new terminal
  □ Confirm batch settles correctly
  □ Confirm deposit posts to correct bank account (check after Day 1)
  □ Confirm receipt format shows correct business name and contact info

────────────────────────────────────
STAGE 4: GO-LIVE (Day 7–14)
────────────────────────────────────
□ Terminal delivered to merchant location (if shipped)
□ Agent or support calls merchant for activation walkthrough
□ Merchant's first live transaction processed
□ Batch settled and deposit confirmed within 2 business days
□ GHL deal stage updated to "Live — Processing"

Liberty Zero setup (if applicable):
  □ Signage posted at point-of-sale and entry (required before first transaction)
  □ Receipt format verified (shows cash price and service fee separately)
  □ Staff script confirmed: "Cash price is X, card price is Y. How would you like to pay?"
  □ Card brand registration completed (for surcharging program — done by Liberty Bancard)

────────────────────────────────────
POST GO-LIVE CHECK-IN SCHEDULE
────────────────────────────────────
Day 2 after go-live:
  □ Text or call: "Did your first deposit come through okay?"
  □ Any terminal or software issues?

Day 7:
  □ Call: "How's the first week going? Any questions from your staff about the process?"
  □ Review first batch and deposit timing
  □ Ask for referrals if satisfaction is high

Day 30:
  □ Call or email: "First full month — how is the new setup working?"
  □ Ask for Google review or testimonial if very satisfied
  □ Confirm statement format is understandable
  □ Offer statement review at 30 days to confirm actual effective rate

Day 90:
  □ Schedule quarterly check-in
  □ Review effective rate — confirm no unexpected changes
  □ Ask about referrals or additional locations

────────────────────────────────────
WHAT TO SET AS MERCHANT EXPECTATIONS (UPFRONT)
────────────────────────────────────
Set these expectations during the close call to prevent surprises:
  • Timing: "Expect 5–10 business days from signed application to live processing"
  • Deposits: "Funds typically settle within 1–2 business days after batch"
  • Statements: "You'll receive a monthly statement via email — we'll walk through your first one together"
  • Support: "My direct number is 954-266-8214. For urgent issues, you can also call our support line at 954-266-8214"
  • Rate changes: "Your rate is locked per our agreement — it won't change without written notice and your consent"`,
  },

  leadManagementSOP: {
    title: "Lead Management & Follow-Up SOP",
    folder: "04",
    content: `LIBERTY BANCARD — LEAD MANAGEMENT & FOLLOW-UP SOP
===================================================
How to Work a Lead from First Contact to Close
Internal Use

────────────────────────────────────
PIPELINE STAGES
────────────────────────────────────
GHL Pipeline stages in order:

1. NEW LEAD — just entered the system; not yet contacted
2. CONTACTED — reached by phone, email, or SMS; no commitment yet
3. STATEMENT REQUESTED — asked for statement; waiting
4. STATEMENT RECEIVED — statement in hand; analysis underway
5. PROPOSAL SENT — analysis delivered; merchant reviewing
6. FOLLOW-UP / NEGOTIATING — proposal delivered; in discussion
7. APPLICATION STARTED — merchant submitted application
8. UNDERWRITING — in underwriting review
9. APPROVED — approved; setup underway
10. LIVE — processing live; onboarding complete
11. NURTURE — interested but not ready; returning to market
12. LOST — chose competitor or decided not to switch
13. DNC — do not contact; removed from all sequences

────────────────────────────────────
LEAD SCORING PRIORITIES
────────────────────────────────────
Score your leads to focus time on highest-probability opportunities:

HIGH PRIORITY (work within 24 hours):
  → Statement already uploaded (ready for analysis)
  → Inbound call or email inquiry (they reached out)
  → Referred lead (mutual connection intro)
  → Known rate above 3.0%
  → Processing $50K+/month

MEDIUM PRIORITY (work within 48–72 hours):
  → Cold lead with known volume $10K–$50K
  → Showed interest but no statement yet
  → Processing 6+ months with same processor (loyalty = potential stagnation)

LOW PRIORITY (work when time permits):
  → Cold lead, volume unknown
  → Multiple prior contacts with no engagement
  → Very small volume ($5K–$10K/month)

────────────────────────────────────
FOLLOW-UP TIMING RULES
────────────────────────────────────
These are minimum standards — faster is better:

After initial contact:     Follow up same day if possible; next business day at latest
After statement request:   Follow up in 24 hours if no statement received
After statement received:  Analysis within 2 hours; proposal delivery within 24 hours
After proposal sent:       Follow up within 24 hours
After a no-show:           Follow up within 1 hour of missed meeting
After verbal "yes":        Application link within 30 minutes; follow up same day

────────────────────────────────────
WHEN TO ESCALATE vs. WHEN TO NURTURE
────────────────────────────────────
ESCALATE TO MANAGER when:
  → Merchant is high-risk vertical
  → Volume above $500K/month
  → Merchant is locked in lease or complex contract
  → Merchant is threatening legal action related to current processor
  → Underwriting decision is delayed beyond 5 business days
  → Compliance concern arises

MOVE TO NURTURE when:
  → Merchant said "not right now" but showed genuine interest
  → Contract doesn't end for 6+ months
  → Business is in a temporary disruption (new location, staff changes)
  → Merchant is comparing multiple options and timeline is unclear

MOVE TO DNC when:
  → Merchant explicitly said "do not contact again"
  → Number/email bounced + no other contact info available
  → Federal or state DNC registry verification confirms restriction

────────────────────────────────────
HANDLING DEAD LEADS
────────────────────────────────────
After 6 unanswered follow-up attempts (mix of call, email, SMS):
  → Move to "Stale Outreach" tag
  → Enroll in Win-Back sequence (90-day dormant re-engagement)
  → Remove from active pipeline view
  → Do NOT move to DNC unless they explicitly asked to be removed

Re-engagement criteria (move back to active pipeline):
  → Any inbound reply from the contact
  → Mention of rate increase at current processor
  → Upcoming contract renewal (new context)
  → Changed business circumstances (new location, new partner, etc.)

────────────────────────────────────
CRM (GHL) HYGIENE STANDARDS
────────────────────────────────────
Every contact record must have:
  □ Correct name and business name
  □ Phone and email verified
  □ Lead source tagged (cold call, website, referral, LinkedIn, etc.)
  □ Vertical tagged (restaurant, medical, retail, etc.)
  □ Current pipeline stage accurate
  □ Last contact note (within 48 hours)
  □ Next-action task with due date

Weekly review:
  → Review all leads in stages 2–7 (active pipeline)
  → Identify any stuck >5 days with no note — review strategy
  → Review all "Proposal Sent" leads >5 days — plan close attempt
  → Clean up any duplicate contacts (use GHL merge tool)`,
  },

  escalationSOP: {
    title: "Escalation & Issue Resolution SOP",
    folder: "04",
    content: `LIBERTY BANCARD — ESCALATION & ISSUE RESOLUTION SOP
====================================================
How to Handle Disputes, Terminal Issues, Billing Errors, and Manager Escalations
Internal Use

────────────────────────────────────
CONTACT MATRIX
────────────────────────────────────
Issue Type                  First Contact              Escalation
──────────────────────────  ─────────────────────────  ───────────────────────────
Terminal malfunction         Your assigned rep          Liberty Bancard support line
Funding/deposit question     Your assigned rep          Manager → Processor support
Chargeback assistance        Your assigned rep          Manager → Risk team
Billing/statement error      Your assigned rep          Manager → Billing department
Application status           Your assigned rep          Underwriting contact
High-risk merchant flag      Manager                    Underwriting directly
Legal/compliance question    Manager                    Compliance officer
Merchant cancellation        Your assigned rep          Manager retention call

Merchant support:           support@libertybancard.com | 954-266-8214
Manager contact:            Your Regional Manager | 954-266-8214
Underwriting:               Underwriting Team | underwriting@libertybancard.com
Technical support:          Tech Support | support@libertybancard.com | 954-266-8214

────────────────────────────────────
TERMINAL MALFUNCTIONS
────────────────────────────────────
Common terminal issues and first response:

Terminal won't power on:
  → Check power connection; try rebooting (hold power button 10 seconds)
  → If battery-powered, charge for 30 minutes before retesting
  → If still unresponsive: escalate to tech support

Terminal won't connect (Offline):
  → Check Wi-Fi or cellular signal
  → Reboot the terminal and router
  → Try manual settlement if batch is urgent
  → If persists: escalate to tech support

Transactions declining:
  → Confirm not a card-level issue (test with a different card)
  → Confirm merchant account is in good standing (check with manager)
  → Check terminal firmware — may need update
  → If all cards declining: escalate to processor immediately

Wrong amount charged:
  → If within 24 hours: void and re-run
  → If batch already settled: process a refund
  → Advise merchant on refund timeline (2–5 business days to customer)

Response time commitment: All terminal issues acknowledged within 2 hours during business hours, 4 hours after hours.

────────────────────────────────────
BILLING ERRORS
────────────────────────────────────
Step 1: Identify the error
  → Gather the specific statement showing the incorrect charge
  → Note the charge date, amount, and type
  → Compare to their agreement terms

Step 2: Verify internally
  → Confirm with manager or billing whether the charge is correct or an error
  → Do not promise a credit before internal verification

Step 3: Communicate to merchant
  If error confirmed:
    "I've verified the charge was in error — I'm requesting a credit immediately. Credits typically post within 1–2 billing cycles. I'll follow up when it's confirmed."
  If charge is correct:
    "I looked into it — the charge is {{fee explanation}}. Here's why it appears on your statement. If you'd like to discuss your fee structure going forward, I'm happy to review that with you."

────────────────────────────────────
CHARGEBACK ASSISTANCE
────────────────────────────────────
A chargeback is a transaction dispute initiated by the cardholder's bank. The merchant must respond with evidence within the dispute deadline (typically 7–10 days).

When a merchant reports a chargeback:
  Step 1: Identify the transaction — amount, date, cardholder name
  Step 2: Gather evidence the merchant can provide:
    → Signed receipt or sales slip
    → Delivery confirmation (for shipped goods)
    → Proof of service delivery (signed agreement, work order)
    → Communication records with the cardholder
    → Clear return/refund policy at point of sale
  Step 3: Submit evidence through the chargeback response portal by the deadline
  Step 4: Follow up on the outcome and advise merchant

Prevention best practices to share with merchants:
  → Get signed receipts for all transactions above $50
  → Use AVS (Address Verification) for card-not-present
  → Use a clear, recognizable billing descriptor
  → Maintain written records of all services delivered
  → Respond to every dispute by the deadline — missed deadlines are automatic losses

────────────────────────────────────
MERCHANT DISPUTES / COMPLAINTS
────────────────────────────────────
When a merchant expresses serious dissatisfaction:
  Step 1: Listen fully — do not interrupt or become defensive
  Step 2: Acknowledge: "I hear you and I want to make this right."
  Step 3: Identify the specific issue
  Step 4: Set realistic expectations for resolution
  Step 5: Escalate to manager if:
    → Merchant is threatening to cancel
    → Merchant is threatening legal action
    → Issue involves a billing error above $500
    → You cannot identify the root cause

Response time commitment:
  → All merchant complaints: acknowledged within 2 business hours
  → Resolution or escalation path communicated within 4 business hours
  → Follow-up on open issues: within 24 hours`,
  },

  // ── FOLDER 05: Partner & Agent Resources ────────────────────────────────

  agentOnboardingGuide: {
    title: "Agent Onboarding Guide — Day-One Orientation",
    folder: "05",
    content: `LIBERTY BANCARD — AGENT ONBOARDING GUIDE
=========================================
Day-One Orientation for New Sales Representatives
Internal Use

Welcome to Liberty Bancard. This guide covers everything you need to get started on Day 1 and be effective in your first 30 days.

────────────────────────────────────
SYSTEMS ACCESS — GET THESE FIRST
────────────────────────────────────
You need access to these tools on Day 1. Contact your manager if any are missing.

1. REPLIT APP (CRM Dashboard)
   URL: libertybancard.com/agent-portal
   Your username: info@libertybancard.com
   Password: Set via the password reset email sent on your start date
   What you'll use it for: Contact management, pipeline, statement uploads, proposals

2. GOHLEVEL (GHL) — Outreach & Communication Platform
   URL: app.gohighlevel.com
   Login: Provided by your manager
   What you'll use it for: Email sequences, SMS, call tracking, appointment calendar

3. GOOGLE WORKSPACE
   Email: {{firstname}}@libertybancardteam.com
   Set up: Check your personal email for Google Workspace invitation
   What you'll use it for: Email, this Google Drive vault, shared docs

4. STATEMENT UPLOAD PORTAL
   URL: libertybancard.com/upload-statement
   How to use: Walk merchants through uploading. You'll receive notification when a statement arrives.

5. SAVINGS CALCULATOR
   Location: In the CRM dashboard under "Statement Review"
   What it does: Builds comparison proposals from statement data

────────────────────────────────────
YOUR FIRST WEEK SCHEDULE
────────────────────────────────────
Day 1:
  □ Complete system access setup (above)
  □ Read all training guides in this Google Drive vault:
    - Start with: Master Sales Playbook
    - Then: Cold Call Script & Talk Tracks
    - Then: Statement Review Guide
    - Then: Objection Handling Playbook
    - Then: Agent Quick-Start + Commission Guide
  □ Shadow a senior rep on 2+ calls (ask your manager to set this up)
  □ Set up your GHL profile and notification preferences

Day 2:
  □ Make your first 10 cold calls (no pressure to close — just practice opener + discovery)
  □ Log every call in GHL
  □ Debrief with your manager: what went well, what felt awkward

Day 3:
  □ Make 20+ cold calls
  □ Your goal for today: get 1 merchant to agree to share a statement
  □ Review 1 actual processing statement with your manager

Day 4:
  □ Continue calling — aim for 30+ dials
  □ Build your first savings comparison using the calculator (even if the merchant hasn't agreed yet — practice helps)

Day 5:
  □ Weekly review with your manager
  □ Identify your target vertical for Week 2
  □ Set a 30-day goal: statements requested, proposals sent, applications submitted

────────────────────────────────────
WHO TO CALL WITH QUESTIONS
────────────────────────────────────
Your direct manager:    Your Regional Manager | 954-266-8214 | info@libertybancard.com
Underwriting questions: Always go through your manager first
Technical support:      support@libertybancard.com | 954-266-8214
Document issues:        Your manager first; they'll escalate

Rule of thumb: If you're stuck on a call, don't promise anything — say "Let me confirm that and get back to you within the hour." Then call your manager.

────────────────────────────────────
WHAT SUCCESS LOOKS LIKE IN 30 DAYS
────────────────────────────────────
By Day 30, a successful new agent will have:
  ✓ Made 400+ cold calls (average of 20/day)
  ✓ Booked 10+ discovery calls
  ✓ Received 5+ statements
  ✓ Delivered 3+ proposals
  ✓ Submitted 1–2 applications
  ✓ Completed all training guides
  ✓ Participated in at least 3 mock calls with manager
  ✓ Has a working pipeline of 20+ active contacts

These aren't quotas for Day 30 — they're benchmarks for where a rep who's doing the right activities should land. If your activity is there, deals will follow.

────────────────────────────────────
TRAINING READING ORDER
────────────────────────────────────
1. Master Sales Playbook (Folder 02)       — Start here
2. Cold Call Script & Talk Tracks (Folder 02)
3. Statement Review Guide (Folder 02)
4. Objection Handling Playbook (Folder 02)
5. Closing Scripts (Folder 02)
6. Vertical Talk Tracks for your top 2–3 verticals (Folder 02)
7. Agent Commission Schedule & Earnings Guide (this folder)
8. Daily Operations SOP (Folder 04)
9. Statement Collection SOP (Folder 04)
10. Competitor Comparison Sheets (Folder 01)`,
  },

  rampPlan306090: {
    title: "30-60-90 Day Agent Ramp Plan",
    folder: "05",
    content: `LIBERTY BANCARD — 30-60-90 DAY AGENT RAMP PLAN
================================================
Structured Ramp for New Sales Representatives
Internal Use

────────────────────────────────────
DAY 1–30: FOUNDATIONS & FIRST DEALS
────────────────────────────────────
OBJECTIVE: Learn the fundamentals, develop outreach habits, submit first application.

Activity Targets (Days 1–30):
  • Dials per day:           20–30 (build up from 10 on Day 1)
  • Discovery conversations: 2–3 per day (live connects that go beyond opener)
  • Statement requests:      5 total by Day 30
  • Proposals delivered:     2 total by Day 30
  • Applications submitted:  1 by Day 30 (stretch: 2)

Training Milestones:
  □ All 10 training guides read by Day 7
  □ First mock call with manager by Day 3
  □ Second mock call by Day 10
  □ First live statement review conducted with manager present by Day 14

Shadowing:
  □ Shadow 3 calls with a senior rep in Days 1–7
  □ Shadow 2 statement review calls with senior rep
  □ Debrief each shadow call: "What would you do differently?"

Check-Ins:
  □ Daily check-in with manager: Days 1–10 (10–15 minutes)
  □ Weekly 30-minute review: Week 2 and Week 3
  □ 30-day performance review: formal review with manager

30-Day Success Markers:
  ✓ Comfortable with opener + discovery questions on cold calls
  ✓ Can identify tiered vs. interchange-plus pricing from a statement
  ✓ Has run at least 2 statement analyses independently
  ✓ Has at least 1 application submitted or in progress
  ✓ Has a working GHL pipeline with 20+ contacts

────────────────────────────────────
DAY 31–60: BUILDING MOMENTUM
────────────────────────────────────
OBJECTIVE: Increase deal velocity, hit first closes, establish pipeline discipline.

Activity Targets (Days 31–60):
  • Dials per day:           25–40
  • Discovery conversations: 3–5 per day
  • Statement requests:      8–10 additional (Days 31–60)
  • Proposals delivered:     5 additional
  • Applications submitted:  2–3 additional (1–2 go-lives expected from Day 1–30 apps)
  • Closes (go-live merchants): 1–2

Quota Introduction:
  By Day 45: Monthly quota introduced (agree on number with manager based on ramp trajectory)
  Day 45–60: Working toward first monthly quota attainment

New Skills Added:
  □ Begin working 2–3 verticals simultaneously (not just 1 from Week 1)
  □ Run first referral partner conversation
  □ Handle a chargeback or billing question independently
  □ Build a proposal using both interchange-plus and Liberty Zero options

Check-Ins:
  □ Weekly 30-minute review with manager
  □ 60-day performance review: formal review

60-Day Success Markers:
  ✓ Pipeline has 40+ active contacts in stages 2–7
  ✓ 2+ proposals in "Follow-Up / Negotiating" stage
  ✓ First merchant live and processing
  ✓ Comfortable with all common objections
  ✓ Hitting 30+ dials per day consistently

────────────────────────────────────
DAY 61–90: FULL QUOTA & MASTERY
────────────────────────────────────
OBJECTIVE: Hit full quota, develop advanced skills, build referral network.

Activity Targets (Days 61–90):
  • Full daily activity target (30–50 dials depending on pipeline stage)
  • 3–5 go-lives this period
  • First referral partner signed or in progress
  • Monthly residual begins building (based on Day 1–60 portfolio)

Advanced Development:
  □ Complete first advanced vertical training (choose your top 2 verticals)
  □ Conduct first referral partner recruitment call
  □ Run a full review+close independently from statement to application
  □ Participate in weekly team standup as a contributor, not just listener

Milestone Goals:
  ✓ Monthly quota achieved (or within 80% with clear path)
  ✓ 5+ merchants processing live (residual portfolio beginning)
  ✓ First monthly residual statement received
  ✓ Pipeline hygiene: <10% of contacts in pipeline without a next-action task
  ✓ Referral partner relationship in progress

90-Day Review:
  □ Formal 90-day performance review
  □ Set 6-month goals: volume target, residual income target, portfolio size
  □ Identify 1–2 development areas for Q2
  □ Discuss advanced training or specialization path`,
  },

  commissionSchedule: {
    title: "Agent Commission Schedule & Earnings Guide",
    folder: "05",
    content: `LIBERTY BANCARD — AGENT COMMISSION SCHEDULE & EARNINGS GUIDE
=============================================================
How Commissions Work | Residual Income Model | Path to $10K/Month
Internal Use

────────────────────────────────────
HOW LIBERTY BANCARD COMMISSIONS WORK
────────────────────────────────────
Liberty Bancard agents earn residual income — monthly commissions from every merchant in their portfolio, for as long as the merchant processes with Liberty Bancard.

This is fundamentally different from "deal commission" (one-time payment at close). The residual model means your income compounds every month as you add merchants. A rep who signs 3 merchants per month for 12 months has a growing portfolio — each month's income is higher than the last.

────────────────────────────────────
THE RESIDUAL INCOME MODEL
────────────────────────────────────
How residuals are calculated:
  1. Merchant processes $X in cards during the month
  2. Liberty Bancard earns a gross margin on that processing (varies by program and merchant rate)
  3. Agent earns a percentage of that gross margin — the residual split

Residual split tiers (example structure — confirm current tiers with your manager):
  Months 1–3:    40% of gross profit from each merchant
  Months 4–12:   50% of gross profit from each merchant
  Month 13+:     60% of gross profit from each merchant (loyalty tier)

Example residual calculation:
  Merchant: restaurant processing $60,000/month
  Liberty Bancard gross margin on this merchant: $450/month (estimated)
  Agent residual split (at 50%): $225/month from this one merchant

  After 12 months with 20 merchants averaging $225/month each:
  20 × $225 = $4,500/month in residual income

  After 24 months with 40 merchants:
  40 × $225 = $9,000/month — approaching full-time income from residuals

────────────────────────────────────
UPFRONT BONUSES
────────────────────────────────────
In addition to residuals, Liberty Bancard pays upfront activation bonuses when merchants go live. Current bonus structure — ask your manager for the current schedule:

  Standard activation bonus:     $(Value) per merchant go-live
  High-volume merchant bonus:    $[Y] additional for merchants above $50K/month
  Monthly activation milestone:  $[Z] bonus for reaching X go-lives in a calendar month

These bonuses are paid separately from residuals — they're immediate income while your residual portfolio grows.

────────────────────────────────────
HOW TO READ YOUR COMMISSION STATEMENT
────────────────────────────────────
Commission statements are available in your agent portal on the 15th of each month (for the prior month's activity).

Reading your statement:
  Column 1: Merchant name (or MID)
  Column 2: Monthly processing volume
  Column 3: Gross profit generated
  Column 4: Your residual split %
  Column 5: Your residual earned

Check every month:
  → Are all your active merchants listed? (missing merchant = potential data issue — report to manager)
  → Does volume look approximately right for each merchant?
  → Have any merchants closed or churned? (portfolio shrinks — focus on additions to offset)

────────────────────────────────────
THE PATH TO $10,000/MONTH
────────────────────────────────────
$10,000/month in residual income is achievable within 18–24 months for agents who consistently build their portfolio.

Working backward from $10K:
  At average $200/month residual per merchant → need 50 merchants
  At average $300/month residual per merchant → need 33 merchants
  At average $150/month residual per merchant → need 67 merchants

How long does it take to build 50 merchants?
  If you sign 3 merchants/month → 17 months (accounting for some churn)
  If you sign 5 merchants/month → 11 months
  If you sign 2 merchants/month → 27 months

The levers you control:
  → Activity (dials, outreach) — drives how many deals you close
  → Deal size (targeting high-volume merchants) — drives residual per merchant
  → Retention (keeping merchants happy) — drives portfolio stability

Tips for maximizing residual income:
  ✓ Focus on higher-volume merchants: $50K+/month generates 2–3× more residual per merchant
  ✓ Monthly check-ins prevent churn — a quick call saves $200/month × 36 months = $7,200
  ✓ Ask for referrals at the 30-day mark when satisfaction is highest
  ✓ Upsell Liberty Zero when eligible — merchant stays longer, may process more

────────────────────────────────────
MERCHANT RETENTION = INCOME PROTECTION
────────────────────────────────────
Your residual income is only as stable as your merchant portfolio.

Churn risk factors (address proactively):
  → Merchant hasn't heard from you in 90+ days
  → Merchant had an unresolved service issue
  → Merchant is contacted by a competitor (happens — you can't always prevent it)
  → Merchant's business changes significantly

Retention actions that work:
  → Monthly 5-minute check-in call or text
  → 30-day and 90-day in-person or video check-ins
  → Flag any billing anomalies before the merchant notices
  → Annual statement review — proactively show them they're still getting a good deal
  → Referral request at satisfaction peaks (Day 30, 6-month mark)`,
  },

  agentQuickReferenceCard: {
    title: "Agent Quick-Reference Card",
    folder: "05",
    content: `LIBERTY BANCARD — AGENT QUICK-REFERENCE CARD
=============================================
Most Important Links, Logins, and Tools | Print and Keep Handy
Internal Use

────────────────────────────────────
LOGINS & PORTALS
────────────────────────────────────
CRM Dashboard:            libertybancard.com/agent-portal | Login: your email
GHL (GoHighLevel):        app.gohighlevel.com | Login: provided by manager
Google Workspace Email:   mail.google.com | {{firstname}}@libertybancardteam.com
Google Drive Vault:       drive.google.com (see Master Vault link provided by manager) | This document lives here
Statement Upload Portal:  libertybancard.com/upload-statement | (share with merchants)
Commission Portal:        libertybancard.com/agent-portal | Statements on 15th of each month

────────────────────────────────────
KEY CONTACTS
────────────────────────────────────
Your manager:             {{Contact Name}} | 954-266-8214 | info@libertybancard.com
Merchant support:         support@libertybancard.com | 954-266-8214
Underwriting:             underwriting@libertybancard.com
Technical support:        support@libertybancard.com | 954-266-8214
Main office:              954-266-8214

────────────────────────────────────
MOST IMPORTANT PHONE NUMBERS TO KNOW
────────────────────────────────────
Main line (merchant-facing): 954-266-8214
Your direct line (your personal): {{Your Direct Number}}
Manager direct: 954-266-8214

────────────────────────────────────
SALES TOOLS — QUICK LINKS
────────────────────────────────────
Savings Calculator:       In CRM dashboard → Statement Review
Proposal Builder:         In CRM dashboard → Contacts → Statement tab
Comparison One-Pagers:    Folder 01 in this Google Drive vault
Vertical Talk Tracks:     Folder 02 in this Google Drive vault

────────────────────────────────────
TOP 5 DOCS EVERY AGENT NEEDS
────────────────────────────────────
1. Master Sales Playbook (Folder 02) — The 5-step process
2. Cold Call Script (Folder 02) — Openers, gatekeeper scripts, voicemail
3. Statement Review Guide (Folder 02) — How to read any statement
4. Objection Handling Playbook (Folder 02) — 20 objections + responses
5. Competitor Comparisons (Folder 01) — Square, Stripe, Clover, Toast

────────────────────────────────────
COMPLIANCE REMINDERS (DAILY)
────────────────────────────────────
  ✗ Never promise a specific rate before underwriting
  ✗ Never claim "guaranteed savings" — use "approximately" or "projected"
  ✗ Never say "0% processing" without adding: "for qualifying merchants, where permitted by state law, card brand rules, and underwriting"
  ✗ Never send SMS without TCPA consent
  ✗ Never contact anyone on the DNC list
  ✓ Log every contact in GHL the same day
  ✓ Escalate compliance questions to your manager before responding

────────────────────────────────────
DAILY ACTIVITY MINIMUMS
────────────────────────────────────
New agents (Days 1–30):  20+ dials, 2+ conversations, 1+ statement request/week
Growing agents (Day 31–90): 30+ dials, 3+ conversations, 2+ statements/week
Experienced agents:       40+ dials, 5+ conversations, 4+ statements/week

────────────────────────────────────
PIPELINE STAGE CHEAT SHEET
────────────────────────────────────
1 NEW LEAD → 2 CONTACTED → 3 STATEMENT REQUESTED → 4 STATEMENT RECEIVED →
5 PROPOSAL SENT → 6 FOLLOW-UP → 7 APPLICATION STARTED → 8 UNDERWRITING →
9 APPROVED → 10 LIVE → → → (residual income)

Alternatives: 11 NURTURE (not now) | 12 LOST | 13 DNC

────────────────────────────────────
EMERGENCY SITUATIONS
────────────────────────────────────
Merchant terminal completely down → Call manager immediately; escalate to tech support
Merchant deposit missing after 3 business days → Escalate to manager right away
Chargeback deadline approaching → Act same day; contact manager for documentation guidance
Compliance or legal concern raised → Stop the conversation; call manager before continuing`,
  },

  // ── FOLDER 06: Legal & Compliance ───────────────────────────────────────

  dncCompliancePolicy: {
    title: "DNC & Compliance Policy",
    folder: "06",
    content: `LIBERTY BANCARD — DNC & COMPLIANCE POLICY
==========================================
Do-Not-Call, TCPA, Opt-Out, and Record-Keeping Requirements
Internal Use — Agent-Readable Version

────────────────────────────────────
OVERVIEW
────────────────────────────────────
This policy covers Liberty Bancard's obligations and procedures for:
  1. Federal and state Do-Not-Call (DNC) regulations
  2. TCPA (Telephone Consumer Protection Act) compliance for calls and SMS
  3. Required disclosures
  4. Opt-out handling
  5. Record-keeping

Non-compliance with these rules is not a training issue — it's a legal and financial risk that can result in personal liability, regulatory fines, and reputational damage. If you're unsure about any outreach, stop and ask your manager.

────────────────────────────────────
DO-NOT-CALL (DNC) POLICY
────────────────────────────────────
Federal DNC Registry:
  The National DNC Registry is maintained by the FTC. Business owners may register their personal phone numbers.
  → Before dialing any number, it must be checked against the federal DNC registry
  → GHL sequences are configured to suppress DNC-registered numbers — do not bypass this
  → DNC checks must be refreshed every 31 days for any number dialed

B2B Exception:
  The federal DNC registry does not apply to calls made to a business phone in connection with a business transaction. Liberty Bancard primarily calls business lines — this exception generally applies.
  → Exception does NOT apply to personal mobile phones, even if used for business
  → Exception does NOT apply to home-based businesses at residential numbers

Internal DNC List:
  Liberty Bancard maintains an internal DNC list in GHL.
  → Any contact who requests "do not call" or "remove me from your list" must be added to the internal DNC list within 24 hours
  → Adding someone to DNC in GHL removes them from all active sequences automatically
  → Internal DNC is maintained indefinitely — no expiration

State DNC Registries:
  Some states maintain separate DNC registries. Check with your manager for the current list of states requiring state-level registry checks.

────────────────────────────────────
TCPA COMPLIANCE — CALLS
────────────────────────────────────
The TCPA regulates automated calls, prerecorded messages, and calls to cell phones.

Key rules for calling:
  • Do not use autodialing technology to call cell phones without prior express consent
  • Do not call before 8 AM or after 9 PM in the recipient's local time zone
  • Always identify yourself and the company name at the beginning of the call
  • Honor all "do not call" requests immediately

For AI/voice calls (if using Liberty Bancard's Voice AI — Rachel):
  • Consent must be collected before the AI calls any contact
  • The AI must identify itself as an AI within the first disclosure of the call
  • All AI call recordings are maintained in the system

────────────────────────────────────
TCPA COMPLIANCE — SMS
────────────────────────────────────
SMS is subject to strict TCPA rules. Non-compliance fines are $500–$1,500 per message.

Prior express written consent required before any marketing SMS:
  • Consent is collected via web form checkbox (libertybancard.com forms)
  • Consent can also be given verbally during a call — note it in the CRM
  • Do NOT send SMS to any contact who has not provided consent

Required in all first-time SMS to new contacts:
  → "Reply STOP to opt out" (exact language)
  → Identify as Liberty Bancard
  → Do not send before 8 AM or after 9 PM local time

Opt-out handling (critical):
  → When a contact replies STOP, UNSUBSCRIBE, CANCEL, or QUIT — remove from all SMS sequences immediately
  → GHL automatically suppresses "STOP" responses — do not re-add them manually
  → If you accidentally add a STOP responder back, report to manager immediately

────────────────────────────────────
REQUIRED DISCLOSURES
────────────────────────────────────
ALL communications (email, phone, in-person) about the following must include the compliance language listed:

Processing rates and savings:
  Append: "No savings claims without statement review. Results vary based on merchant-specific analysis."

0% processing / Liberty Zero program:
  Append: "Eligibility, underwriting, card brand rules, and applicable laws apply."

Next-day funding:
  Append: "Eligibility, cutoff times, and bank schedule apply."

Any written marketing materials:
  Include footer disclaimer (verbatim — see Brand Guidelines for full text)

────────────────────────────────────
RECORD-KEEPING REQUIREMENTS
────────────────────────────────────
The following must be documented and retained in GHL:
  ✓ All call logs (date, time, duration, outcome)
  ✓ All SMS sent and received
  ✓ All email sequences and individual emails
  ✓ TCPA consent records (date, method, IP or call recording)
  ✓ DNC requests and date of removal from all contact
  ✓ Agent agreements and onboarding acknowledgments

Retention period:
  → Call logs: 4 years minimum
  → Consent records: 5 years minimum
  → DNC removal confirmations: indefinitely

────────────────────────────────────
WHAT TO DO IF UNSURE
────────────────────────────────────
If you're ever unsure whether an outreach action is compliant:
  1. STOP — do not send or say anything
  2. Ask your manager before proceeding
  3. When in doubt, err on the side of not sending

The cost of asking is zero. The cost of a TCPA violation is $500–$1,500 per message, per violation. Always ask.`,
  },

  merchantDataHandlingPolicy: {
    title: "Merchant Data Handling Policy",
    folder: "06",
    content: `LIBERTY BANCARD — MERCHANT DATA HANDLING POLICY
================================================
How Merchant Statements and Financial Data Are Collected, Stored, Used, and Protected
Internal Use

────────────────────────────────────
WHAT DATA WE COLLECT
────────────────────────────────────
Through the statement review process, Liberty Bancard may collect:
  • Processing statements (monthly financial summary documents)
  • Business name, address, and contact information
  • Processing volume and fee data
  • Bank account routing information (for deposit setup — post-close only)
  • Business owner identity documents (for underwriting)

What we do NOT collect or store:
  ✗ Full card numbers (PAN) — never collected, never stored
  ✗ Card CVV/CVC codes — never collected
  ✗ Cardholder data from individual transactions
  ✗ Social Security Numbers (except where required for underwriting, stored securely and separately)

────────────────────────────────────
HOW DATA IS COLLECTED
────────────────────────────────────
Statement upload portal (libertybancard.com/upload-statement):
  • TLS 1.3 encrypted in transit
  • Files stored in encrypted cloud storage
  • Access restricted to admin and authorized agents only
  • Merchant receives automated confirmation when upload is received

Email submission:
  • Acceptable but less secure than portal
  • Agents must move statements from email to the secure portal within 24 hours
  • Personal email accounts must not be used for statement storage

Phone/text/photo submissions:
  • Agent captures image and uploads to the secure portal
  • Do not store merchant statement photos on personal devices
  • Delete from device after uploading to the portal

────────────────────────────────────
HOW DATA IS STORED
────────────────────────────────────
  • Uploaded files: Encrypted at rest using AES-256
  • Database records: Hosted on secured PostgreSQL — access is role-based
  • Agent access: Limited to their own assigned contacts by role permissions
  • Admin access: Full system access — admin users must have individual credentials

Data segmentation:
  • Pre-close (statement + analysis): stored in CRM linked to contact record
  • Post-close (banking/underwriting): submitted to acquiring bank via secure underwriting portal
  • Underwriting documents: not stored in the Liberty Bancard system after submission

────────────────────────────────────
WHO HAS ACCESS
────────────────────────────────────
  Admin (Scott/owner):     Full access to all merchant data
  Manager:                 Access to all contacts in their team; all pipeline data
  Agent:                   Access to their own assigned contacts only
  Affiliate/Partner:       No access to merchant financial data — commission portal only
  Merchant:                Access to their own portal records only

Third-party access:
  → Acquiring bank / underwriting: receives application + supporting docs only
  → No data is sold to third parties
  → No data is shared with marketing data brokers

────────────────────────────────────
DATA RETENTION
────────────────────────────────────
  Processing statements (pre-close):     Retained for 2 years from date of collection
  Underwriting documents:                Submitted to acquiring bank; not retained locally beyond 90 days
  Contact records (CRM):                 Retained indefinitely unless deletion is requested
  Call and SMS records:                  Retained 4 years per compliance requirements
  Consent records:                       Retained 5 years

────────────────────────────────────
MERCHANT DATA DELETION REQUESTS
────────────────────────────────────
Any merchant may request deletion of their data at any time.

Process:
  1. Merchant submits deletion request via email to support@libertybancard.com or via the portal
  2. Request is logged with timestamp and requester identity
  3. Admin reviews and processes within 30 days
  4. Deletion includes: contact record, uploaded statements, email/SMS history
  5. Exceptions: records required for legal compliance, active contracts, or audit purposes

What cannot be deleted:
  → Records required for tax reporting (1099-K obligations)
  → Active processing agreements (until termination is confirmed)
  → Records under a legal hold

────────────────────────────────────
AGENT RESPONSIBILITIES
────────────────────────────────────
  ✓ Upload all statement files to the secure portal — do not store on personal devices
  ✓ Never email full merchant statements to personal email addresses
  ✓ Log all data collection in CRM (so we have an audit trail)
  ✓ Immediately report any suspected data breach or unauthorized access to manager
  ✓ Complete your annual data security awareness training

  ✗ Do not share merchant financial data with anyone outside Liberty Bancard
  ✗ Do not store merchant data in Google Drive personal folders, Dropbox, or similar
  ✗ Do not discuss specific merchant financials in public settings
  ✗ Do not use merchant data for any purpose other than the statement review and proposal process`,
  },

  agentContractorAgreementTemplate: {
    title: "Agent Independent Contractor Agreement Template",
    folder: "06",
    content: `LIBERTY BANCARD — INDEPENDENT CONTRACTOR AGREEMENT
===================================================
TEMPLATE — FOR EXECUTION WITH QUALIFIED LEGAL REVIEW
Last Updated: 2026

NOTE: This is a template document. All agent agreements must be reviewed by qualified legal counsel before execution. Consult an attorney licensed in the applicable jurisdiction before using this document.

════════════════════════════════════════════════════

INDEPENDENT CONTRACTOR AGREEMENT

This Independent Contractor Agreement ("Agreement") is entered into as of {{Effective Date}} ("Effective Date") between:

Liberty Bancard, LLC, a Florida limited liability company, with its principal place of business at {{Agent Address}}, Fort Lauderdale, Florida ("Company"), and

{{Agent Full Legal Name}}, an individual residing at {{Agent Address}} ("Contractor").

════════════════════════════════════════════════════
1. INDEPENDENT CONTRACTOR STATUS
════════════════════════════════════════════════════
1.1 Contractor agrees that they are an independent contractor and not an employee of the Company for any purpose. Nothing in this Agreement shall be construed to create an employer-employee relationship, partnership, joint venture, or any other association between the parties.

1.2 Contractor is solely responsible for all taxes, insurance, and benefits applicable to the compensation earned under this Agreement. The Company will issue a Form 1099 for amounts paid in a calendar year that meet the applicable IRS threshold.

1.3 Contractor shall have no authority to bind the Company contractually or legally, except as expressly authorized in writing.

════════════════════════════════════════════════════
2. SERVICES
════════════════════════════════════════════════════
2.1 Contractor agrees to perform payment processing sales and merchant development services on behalf of the Company, including prospecting for merchant accounts, presenting Company programs, collecting merchant processing applications, and supporting merchant onboarding, as directed by the Company.

2.2 Contractor shall perform all services in a professional manner consistent with Company standards and in compliance with all applicable laws and regulations, including TCPA, state DNC laws, and card brand regulations.

════════════════════════════════════════════════════
3. COMMISSION STRUCTURE
════════════════════════════════════════════════════
3.1 Residual Commissions. Contractor shall earn residual commissions based on the gross processing profit generated by merchants submitted by Contractor and approved by the Company's acquiring bank, as follows:

  Months 1–3 of each merchant's activity:        {{Value}}% of monthly gross profit
  Months 4–12 of each merchant's activity:       {{Value}}% of monthly gross profit
  Month 13 and thereafter:                        {{Value}}% of monthly gross profit

3.2 Upfront Bonuses. Contractor may be eligible for upfront activation bonuses per the Company's current bonus schedule, which may be updated from time to time. Current schedule is attached as Exhibit A.

3.3 Commission Payment. Commissions are paid on or around the 15th of each month for the prior month's activity.

3.4 Chargebacks and Returns. If a merchant account is closed, reversed, or subject to significant chargebacks within 90 days of activation, the Company reserves the right to recoup any upfront bonus paid for that merchant.

════════════════════════════════════════════════════
4. CONFIDENTIALITY
════════════════════════════════════════════════════
4.1 During the term of this Agreement and for 3 years following its termination, Contractor shall not disclose, use, or make available any Confidential Information of the Company to any third party without prior written consent.

4.2 "Confidential Information" includes: merchant contact lists, proprietary pricing structures, commission schedules, sales strategies, underwriting criteria, software and systems, and any other information designated as confidential by the Company.

4.3 Contractor shall return all Confidential Information to the Company upon termination and retain no copies.

════════════════════════════════════════════════════
5. NON-SOLICITATION
════════════════════════════════════════════════════
5.1 During the term of this Agreement and for 12 months following termination, Contractor shall not directly or indirectly solicit, encourage, or assist any merchant who was an active Liberty Bancard merchant during the term of this Agreement to terminate or reduce their business with the Company.

5.2 During the term of this Agreement and for 6 months following termination, Contractor shall not solicit any employee, agent, or contractor of the Company to terminate their relationship with the Company.

════════════════════════════════════════════════════
6. INTELLECTUAL PROPERTY
════════════════════════════════════════════════════
6.1 Any materials, scripts, templates, tools, or other work product created by Contractor in connection with the performance of services under this Agreement shall be the exclusive property of the Company.

6.2 Contractor retains no rights to use Company branding, materials, or intellectual property following termination.

════════════════════════════════════════════════════
7. REPRESENTATIONS AND WARRANTIES
════════════════════════════════════════════════════
Contractor represents and warrants that:
  (a) Contractor has the legal authority to enter into this Agreement
  (b) Performance of services under this Agreement does not violate any other agreement
  (c) Contractor will comply with all applicable federal, state, and local laws in performing services
  (d) Contractor will not make unauthorized representations about the Company's products or services

════════════════════════════════════════════════════
8. TERMINATION
════════════════════════════════════════════════════
8.1 Either party may terminate this Agreement at any time, with or without cause, upon 30 days written notice.

8.2 The Company may terminate this Agreement immediately upon written notice for:
  (a) Material breach of this Agreement
  (b) Violation of applicable law or card brand regulations
  (c) Fraudulent conduct
  (d) Unauthorized use of Confidential Information

8.3 Upon termination, Contractor's right to receive residual commissions continues for 90 days for merchants actively processing at the time of termination, unless termination is for cause.

════════════════════════════════════════════════════
9. GOVERNING LAW
════════════════════════════════════════════════════
This Agreement shall be governed by the laws of the State of Florida. Any disputes arising under this Agreement shall be resolved through binding arbitration in Broward County, Florida, under the rules of the American Arbitration Association.

════════════════════════════════════════════════════
10. ENTIRE AGREEMENT
════════════════════════════════════════════════════
This Agreement constitutes the entire agreement between the parties regarding its subject matter and supersedes all prior discussions, representations, and agreements.

────────────────────────────────────────────────────
SIGNATURES

Company:
Liberty Bancard, LLC
By: ___________________________
Name: Scott Liberty
Title: CEO
Date: ___________________________

Contractor:
By: ___________________________
Name: {{Contractor Full Legal Name}}
Date: ___________________________
Social Security / EIN: ___________________________
────────────────────────────────────────────────────

EXHIBIT A — CURRENT COMMISSION AND BONUS SCHEDULE
[Attach current schedule — updated separately from this agreement]`,
  },

  // ── FOLDER 07: Product Sheets ───────────────────────────────────────────

  libertyZeroProgramSheet: {
    title: "Liberty Zero™ Program Sheet",
    folder: "07",
    content: `LIBERTY BANCARD — LIBERTY ZERO™ PROGRAM SHEET
===============================================
The 0% Processing Program | Complete Explanation for Sales and Merchant Use
Internal + Merchant-Shareable (remove "Internal Use" section before sharing)

────────────────────────────────────
WHAT IS LIBERTY ZERO?
────────────────────────────────────
Liberty Zero™ is Liberty Bancard's branded name for compliant fee-offset processing programs — specifically cash discount and compliant surcharging.

The core concept: instead of the merchant absorbing the 2–3% credit card processing fee on every transaction, the fee is disclosed to card-paying customers at checkout. Depending on the program structure, card customers either see a higher price (surcharging) or cash customers receive a discount (cash discount).

In plain language: "You accept cards, pay nothing to process them. Card customers pay a disclosed service fee."

────────────────────────────────────
TWO PROGRAM STRUCTURES
────────────────────────────────────

CASH DISCOUNT (CD):
  How it works:
  • Your posted price is the card price
  • Customers who pay cash receive a discount (typically equal to the processing fee)
  • Card customers pay the listed price; cash customers pay less

  Legal status: Legal in all 50 states
  No card brand registration required
  Best for: Restaurants, retail, salons, service businesses

  Example:
    Menu price: $20.00 (card price)
    Cash price displayed separately: $19.30 (or "Cash pays $19.30")
    Merchant collects $20 from card customers; $19.30 from cash customers

COMPLIANT SURCHARGING:
  How it works:
  • Your posted price is the base price (cash price)
  • A disclosed service fee (typically 3–4%) is added to credit card transactions at checkout
  • Debit card transactions are exempt from surcharging by card brand rules

  Legal status: Legal in most states — some restrictions apply (Connecticut, Massachusetts, Puerto Rico — check current list)
  Requires registration with Visa and Mastercard (Liberty Bancard handles this)
  Best for: Professional services, auto repair, contractors, B2B merchants

  Example:
    Invoice: $500.00
    Credit card surcharge (3%): $15.00
    Total charged to credit card: $515.00
    Cash/debit: $500.00

────────────────────────────────────
WHICH MERCHANTS QUALIFY?
────────────────────────────────────
Strong Liberty Zero candidates:
  ✓ Processing $5,000+/month in card volume
  ✓ Located in an eligible state (cash discount: all 50; surcharging: most)
  ✓ Customer base is not extremely price-sensitive
  ✓ Average ticket is high enough that a disclosed service fee isn't disruptive
  ✓ Staff can communicate a one-sentence checkout script

Less suitable:
  ✗ Very price-sensitive, high-competition markets (budget grocery at scale)
  ✗ E-commerce with high cart abandonment risk from fee disclosure
  ✗ States with active surcharging restrictions (verify before recommending)
  ✗ Merchants who don't want any change to customer experience

────────────────────────────────────
COMPLIANCE — WHAT LIBERTY BANCARD HANDLES FOR YOU
────────────────────────────────────
Compliant signage:
  → Point-of-sale signage with required disclosures per card brand guidelines
  → Wording reviewed for compliance with Visa/Mastercard rules
  → Provided by Liberty Bancard — merchant hangs in place

Receipt formatting:
  → Receipts automatically display both prices (cash and card) or the service fee as a separate line item
  → Terminal is programmed correctly before go-live
  → No manual receipt editing required

Staff script:
  → One sentence: "Cash price is $(Value), card price is $[Y] — how would you like to pay?"
  → Liberty Bancard provides this in writing for staff training

Card brand registration (surcharging):
  → Visa and Mastercard require merchants to register before surcharging
  → Liberty Bancard completes this registration — merchant takes no action

Ongoing support:
  → Card brand rules change — Liberty Bancard monitors and updates programs accordingly
  → Compliance support available through your Liberty Bancard rep

────────────────────────────────────
THE MATH — EXAMPLE
────────────────────────────────────
Restaurant processing $60,000/month:

WITHOUT Liberty Zero:
  Processing at 2.7% effective rate: $1,620/month in fees
  Annual cost: $19,440

WITH Liberty Zero (cash discount):
  Processor fees: $0
  Cost to merchant: $0
  Annual savings: $19,440

Note: Some merchants see a slight change in card/cash ratio when cash discount is implemented. On average, card volume remains 85–95% of prior card volume (customers continue using cards). The savings still far exceed any marginal revenue shift.

────────────────────────────────────
COMMON QUESTIONS AND ANSWERS
────────────────────────────────────
Q: Will customers complain about the service fee?
A: With clear upfront signage and a one-sentence staff script, most merchants report minimal friction. Transparency is the key. Customers who see the pricing upfront before completing the transaction rarely object.

Q: What about debit cards?
A: Debit cards are handled differently — card brand rules prohibit surcharging debit. The terminal is configured to automatically recognize and correctly handle debit transactions. Cash discount programs treat debit and credit the same way, which simplifies compliance.

Q: What if a customer doesn't want to pay the fee?
A: Offer cash or debit. The program doesn't require cards — customers have an alternative.

Q: Do I need to change my prices?
A: Under cash discount: your current prices become the card price; you add a cash price (lower). Under surcharging: your current prices are the base price; a fee is added for credit cards at checkout.

Q: Is it really legal?
A: Yes. Cash discount is legal in all 50 states. Surcharging is legal in most states with proper disclosure. We verify eligibility for your state and business type before recommending.

Q: What happens if card brand rules change?
A: Liberty Bancard monitors card brand regulations and updates program configurations accordingly. You don't have to track this yourself.

────────────────────────────────────
ENROLLMENT PROCESS
────────────────────────────────────
1. Statement review — confirm eligibility and calculate savings
2. State verification — confirm which program structure applies
3. Application — standard merchant application with Liberty Zero notation
4. Underwriting — standard approval process
5. Program setup — terminal programmed, signage ordered
6. Go-live — Liberty Bancard checks all compliance elements before first transaction`,
  },

  // ── TERMINAL PRODUCT SHEETS — 6 individual docs ────────────────────────

  ps_dejavoo: {
    title: "Product Sheet — Liberty Bancard Smart Terminal (Dejavoo QD4)",
    folder: "07",
    content: `LIBERTY BANCARD — PRODUCT SHEET: LIBERTY BANCARD SMART TERMINAL (DEJAVOO QD4)
================================================================================
Our Flagship Recommendation for Most Merchants | Internal Sales Use

WHAT IT IS:
The Liberty Bancard Smart Terminal is our branded name for the Dejavoo QD4 — a rugged, Android-based mobile smart terminal pre-configured for Liberty Bancard's programs including Liberty Zero™.

KEY SPECS:
  Display:          5.5" HD touchscreen (color)
  Printer:          Built-in high-speed thermal printer
  Battery:          Extended life — 8+ hours active use
  Connectivity:     4G LTE (dual SIM) + Wi-Fi + Bluetooth
  Payment types:    EMV chip, NFC/contactless, Magstripe (swipe)
  OS:               Android-based smart platform
  Durability:       Drop-tested, ruggedized build

KEY FEATURES:
  ✓ Pre-programmed for Liberty Zero™ — cash discount and surcharging ready
  ✓ Surcharge/service fee automatically calculated and displayed
  ✓ Tip-on-screen capability
  ✓ Quick settlement and automated batching
  ✓ Receipt via paper print, email, or SMS
  ✓ Real-time reporting accessible via web portal
  ✓ Dual SIM for backup connectivity (never offline at a critical moment)
  ✓ Works on Liberty Bancard's interchange-plus program without reconfiguration

BEST FIT MERCHANTS:
  ✓ Restaurants (especially Liberty Zero candidates)
  ✓ Auto repair shops and service businesses
  ✓ Contractors and field service businesses
  ✓ Mobile businesses (pop-up, food truck, market vendor)
  ✓ Any merchant who values portability + Liberty Zero compatibility

WHY AGENTS LEAD WITH THIS:
  → Pre-configured for our programs — zero additional setup
  → Works everywhere (4G + Wi-Fi) — never loses connectivity
  → Merchant-friendly interface — staff learns in minutes
  → Liberty Zero disclosure, signage, and receipt format configured by Liberty Bancard

PRICING/AVAILABILITY:
  Contact for pricing — varies by merchant profile and program. Free with certain qualifying agreements.

NOTE: All pricing and availability subject to merchant profile and underwriting. Do not quote specific terminal prices without confirming with your manager.`,
  },

  ps_clover_flex: {
    title: "Product Sheet — Clover Flex 3",
    folder: "07",
    content: `LIBERTY BANCARD — PRODUCT SHEET: CLOVER FLEX 3
================================================
Internal Sales Use

WHAT IT IS:
The Clover Flex 3 is a powerful handheld all-in-one POS system — touchscreen, built-in printer, barcode scanner, and access to the full Clover App Market. Works with Liberty Bancard processing.

KEY SPECS:
  Display:          6" HD touchscreen
  Printer:          Built-in thermal receipt printer
  Camera:           Barcode scanner
  Battery:          All-day battery
  Connectivity:     Wi-Fi, 4G LTE, Bluetooth
  Payment types:    EMV, NFC, Magstripe, QR
  OS:               Clover OS (Android-based)

KEY FEATURES:
  ✓ Tableside payments for restaurants
  ✓ Full Clover App Market access (loyalty, inventory, scheduling)
  ✓ Employee management and permissions
  ✓ Inventory tracking and real-time sales reporting
  ✓ Customer engagement tools (loyalty, gift cards)
  ✓ Works with Liberty Bancard processing — we program the backend

BEST FIT MERCHANTS:
  Restaurants with tableside service needs, retail with mobility requirement, service businesses needing full POS features on the go.

PRICING/AVAILABILITY:
  Contact for pricing — varies by merchant profile and program.

NOTE: All pricing and availability subject to merchant profile and underwriting.`,
  },

  ps_clover_mini: {
    title: "Product Sheet — Clover Mini 3",
    folder: "07",
    content: `LIBERTY BANCARD — PRODUCT SHEET: CLOVER MINI 3
================================================
Internal Sales Use

WHAT IT IS:
Compact countertop POS — 8-inch touchscreen with built-in printer, fingerprint staff login, and full Clover ecosystem. Works with Liberty Bancard processing.

KEY SPECS:
  Display:          8" HD touchscreen
  Printer:          Built-in thermal
  Security:         Fingerprint reader for staff login
  Connectivity:     Wi-Fi, Ethernet
  Payment types:    EMV, NFC, Magstripe, QR

KEY FEATURES:
  ✓ Table management (restaurants)
  ✓ Customer-facing display option available
  ✓ Offline payment capability
  ✓ Tip adjustment on screen
  ✓ Full Clover App Market

BEST FIT MERCHANTS:
  Quick-service restaurants, cafes, small retail, service counters where countertop installation is preferred.

PRICING/AVAILABILITY:
  Contact for pricing — varies by merchant profile and program.

NOTE: All pricing and availability subject to merchant profile and underwriting.`,
  },

  ps_clover_station: {
    title: "Product Sheet — Clover Station Duo",
    folder: "07",
    content: `LIBERTY BANCARD — PRODUCT SHEET: CLOVER STATION DUO
=====================================================
Internal Sales Use

WHAT IT IS:
The flagship full-service countertop POS — dual screen setup (14" merchant + 8" customer-facing), built-in printer, cash drawer support. Works with Liberty Bancard processing.

KEY SPECS:
  Merchant Display:   14" HD touchscreen
  Customer Display:   8" touchscreen (customer-facing)
  Printer:            Built-in thermal
  Cash Drawer:        Supported (included in bundles)
  Connectivity:       Wi-Fi, Ethernet

KEY FEATURES:
  ✓ Full restaurant POS (table management, online ordering integration)
  ✓ Customer-facing display for tip, signature, loyalty
  ✓ Advanced inventory management
  ✓ Employee scheduling and time clock
  ✓ Detailed sales analytics
  ✓ Multi-location management

BEST FIT MERCHANTS:
  Full-service restaurants, retail stores with counter checkout, high-volume businesses needing full POS environment. Recommended replacement for Toast-dependent merchants who want to save on processing while keeping full POS functionality.

PRICING/AVAILABILITY:
  Contact for pricing — varies by merchant profile and program.

NOTE: All pricing and availability subject to merchant profile and underwriting.`,
  },

  ps_pax_a920: {
    title: "Product Sheet — PAX A920",
    folder: "07",
    content: `LIBERTY BANCARD — PRODUCT SHEET: PAX A920
==========================================
Internal Sales Use

WHAT IT IS:
A sleek Android smart terminal — 5" HD display, fast processor, all-day battery. One of the most popular smart terminals in the market. Works with Liberty Bancard processing.

KEY SPECS:
  Display:          5" HD IPS touchscreen
  Printer:          Built-in high-speed thermal
  Processor:        Quad-core 1.4GHz
  Battery:          5,250 mAh (all-day)
  Connectivity:     4G LTE, Wi-Fi, Bluetooth 4.0
  Payment types:    EMV, NFC, Magstripe, QR

KEY FEATURES:
  ✓ Dual cameras (front and rear) for QR and barcode scanning
  ✓ Slim, lightweight design (professional appearance)
  ✓ Android-based — familiar interface for most staff
  ✓ Cash discount/surcharge program support
  ✓ Fast transaction processing

BEST FIT MERCHANTS:
  Retail stores, restaurants, salons and spas, professional services — any merchant who values aesthetic design in their terminal.

PRICING/AVAILABILITY:
  Contact for pricing — varies by merchant profile and program.

NOTE: All pricing and availability subject to merchant profile and underwriting.`,
  },

  ps_swipesimple: {
    title: "Product Sheet — SwipeSimple",
    folder: "07",
    content: `LIBERTY BANCARD — PRODUCT SHEET: SWIPESIMPLE
=============================================
Internal Sales Use

WHAT IT IS:
A mobile payment solution — Bluetooth card reader + iOS/Android app. Turns any smartphone or tablet into a payment terminal. Best for small merchants or those who want the lowest hardware investment.

KEY SPECS:
  Reader:           Bluetooth chip/swipe/tap reader
  App:              iOS 13+ / Android 8+
  Connectivity:     Bluetooth to phone
  Payment types:    EMV, NFC, Magstripe
  Receipts:         Email, SMS, or print via AirPrint

KEY FEATURES:
  ✓ Virtual terminal built-in (key-enter cards without reader)
  ✓ Recurring payments and invoicing
  ✓ Product catalog and basic inventory
  ✓ Real-time transaction dashboard
  ✓ Integrates with QuickBooks
  ✓ No long-term hardware contract

BEST FIT MERCHANTS:
  Solo entrepreneurs, market vendors, home service businesses, small businesses who want the lowest possible hardware investment. Best for merchants processing <$20K/month who want simplicity.

PRICING:
  Reader: Starting from $49. No monthly fee with processing.

NOTE: All pricing and availability subject to merchant profile and underwriting.`,
  },

  // ── FOLDER 08: Business Operations & Reviews ─────────────────────────────

  weeklyStandupTemplate: {
    title: "Weekly Team Standup Template",
    folder: "08",
    content: `LIBERTY BANCARD — WEEKLY TEAM STANDUP TEMPLATE
================================================
Reusable Meeting Agenda | Every Monday | 30–45 Minutes
Facilitator: Manager | Participants: All Active Sales Reps

────────────────────────────────────
MEETING SETUP
────────────────────────────────────
Frequency:    Weekly — recommend Monday at 9:00 AM
Duration:     30 minutes (strict); 45 minutes max with training topic
Format:       In-person or video call (GHL calendar or Google Meet)
Pre-work:     Each rep reviews their pipeline and prepares updates before the call

────────────────────────────────────
AGENDA (30 MINUTES)
────────────────────────────────────

0:00 – 0:05 OPENING — Pipeline Numbers
Manager leads: Pull up the GHL pipeline view for the team.

Share these numbers from last 7 days:
  • Total new leads entered: ___
  • Statements received: ___
  • Proposals delivered: ___
  • Applications submitted: ___
  • Merchants live (go-lives): ___
  • Total pipeline value (if tracked): $___

"Last week we {{last week's key activity}}. This week the focus is on {{this week's focus}}."

────────────────────────────────────
0:05 – 0:20 REP PIPELINE UPDATES
────────────────────────────────────
Each rep shares in 2–3 minutes max:

Questions for each rep:
  1. What are your top 2–3 deals this week? (stage + next action)
  2. Is there a deal you're stuck on that you want the team's help with?
  3. What was your biggest win from last week?
  4. What is your #1 goal for this week?

Manager note: Hold reps to time. This is not a conference call — it's a standup. Energy matters.

────────────────────────────────────
0:20 – 0:25 BLOCKERS & ISSUES
────────────────────────────────────
Open floor for any blockers — things preventing progress:
  • Underwriting delays
  • Terminal or tech issues
  • Merchant who needs special handling
  • Competitor situation that needs strategy help

Manager decision: resolve now (2 minutes) or take offline.

────────────────────────────────────
0:25 – 0:30 TRAINING TOPIC OF THE WEEK
────────────────────────────────────
Rotating training topics (1 topic per week, manager selects):
  Week 1: Opener and pattern interrupt — practice 2 openers live
  Week 2: Statement review — walk through one real (anonymized) statement together
  Week 3: Objection handling — role play 2 common objections
  Week 4: Closing — practice the trial close and assumptive close
  Week 5: Vertical deep-dive — 1 vertical, full talk track + common objections
  Week 6: Competitor scenario — "Merchant says they're happy with Toast/Square"
  Week 7: Liberty Zero pitch — practice the elevator pitch + eligibility check
  Week 8: Referral partner pitch — practice the CPA/bookkeeper conversation
  (Repeat with different content)

────────────────────────────────────
0:30 CLOSE
────────────────────────────────────
Manager closes:
  "This week's team goal is: ___. Individual goals are set. Let's go."

────────────────────────────────────
GOALS FOR NEXT 7 DAYS (Set at end of meeting)
────────────────────────────────────
Team goal for the week: Statements received / Proposals submitted / Applications / Go-lives
Individual goals (each rep states their 3-number goal):
  Rep 1: {{Contact Name}} — ___ dials, ___ statements requested, ___ proposals delivered
  Rep 2: {{Contact Name}} — ___
  Rep 3: {{Contact Name}} — ___

────────────────────────────────────
MEETING NOTES (Complete after each meeting)
────────────────────────────────────
Date: ___
Facilitator: ___
Attendees: ___

Top deals discussed:
  1. ___
  2. ___
  3. ___

Blockers identified:
  ___

Training topic:
  ___

Team goal this week:
  ___

Notes for follow-up:
  ___`,
  },

  monthlyBusinessReviewTemplate: {
    title: "Monthly Business Review (MBR) Template",
    folder: "08",
    content: `LIBERTY BANCARD — MONTHLY BUSINESS REVIEW (MBR) TEMPLATE
==========================================================
Reusable Google Doc for Monthly Review | Complete by 5th of Each Month
Facilitator: Admin/Owner | Participants: Manager(s), Senior Reps (optional)

────────────────────────────────────
MBR — {{Month}} {{Year}}
Completed by: ___ | Date: ___
────────────────────────────────────

════════════════════════════════════
SECTION 1: MERCHANT VOLUME & GROWTH
════════════════════════════════════
Total active merchants (end of month): ___
New merchants live this month: ___
Merchants churned/closed this month: ___
Net portfolio change: ___ (new – churned)

Total monthly processing volume (all merchants): $___
Month-over-month volume change: ___% ( ↑ / ↓ )
Year-to-date volume: $___

Processing volume by program:
  Interchange-Plus merchants:    ___ merchants | $___/month volume
  Liberty Zero merchants:        ___ merchants | $___/month volume

Average merchant volume: $___/month
Median merchant volume: $___/month

════════════════════════════════════
SECTION 2: REVENUE VS. TARGET
════════════════════════════════════
Monthly residual revenue generated: $___
Month-over-month change: ___% ( ↑ / ↓ )
Year-to-date residual revenue: $___

Revenue target for this month: $___
Variance from target: $___ ( ___% )

Upfront bonus payouts this month: $___
Total commission payout (all agents): $___

Active agents: ___
Average revenue per agent: $___

════════════════════════════════════
SECTION 3: TOP AGENTS / PERFORMERS
════════════════════════════════════
Top performers this month:

Rank  Agent Name          New Merchants  Volume Added    Residual Earned
────  ──────────────────  ─────────────  ──────────────  ───────────────
1.    ___                 ___            $___            $___
2.    ___                 ___            $___            $___
3.    ___                 ___            $___            $___

Recognition notes:
  ___

Performance concerns (handle separately with individual — not in group setting):
  ___

════════════════════════════════════
SECTION 4: PIPELINE HEALTH
════════════════════════════════════
Pipeline snapshot (end of month):

Stage                      Count    Estimated Value
─────────────────────────  ───────  ────────────────
1. New Lead                ___      N/A
2. Contacted               ___      N/A
3. Statement Requested     ___      $___/mo potential
4. Statement Received      ___      $___/mo potential
5. Proposal Sent           ___      $___/mo potential
6. Follow-Up               ___      $___/mo potential
7. Application Started     ___      $___/mo potential
8. Underwriting            ___      $___/mo potential

Stalled leads (no movement in 10+ days): ___
DNC removals this month: ___

Pipeline conversion rates:
  Statement Request → Statement Received: ___%
  Statement Received → Proposal Sent:     ___%
  Proposal Sent → Application:            ___%
  Application → Live:                     ___%

════════════════════════════════════
SECTION 5: OPERATIONAL ISSUES
════════════════════════════════════
Underwriting issues this month (count and nature):
  ___

Terminal or tech issues:
  ___

Merchant support tickets (count by type):
  Billing/fees:       ___
  Terminal issues:    ___
  Chargeback help:    ___
  Other:              ___

Average support ticket resolution time: ___ hours

Compliance issues or DNC violations (if any):
  ___

════════════════════════════════════
SECTION 6: MARKETING PERFORMANCE
════════════════════════════════════
Website statement uploads this month: ___
Inbound leads (web form, calls): ___
Conversion rate (inbound lead → active opportunity): ___%

Top lead sources this month:
  1. ___   (___ leads)
  2. ___   (___ leads)
  3. ___   (___ leads)

Email sequence performance:
  Cold outreach send volume: ___
  Open rate: ___%
  Reply rate: ___%
  Sequence opt-outs: ___

Referral partner activity:
  Active referral partners: ___
  Referral-sourced leads this month: ___
  Referral-sourced go-lives: ___

════════════════════════════════════
SECTION 7: NEXT MONTH PRIORITIES
════════════════════════════════════
Top 3 priorities for {{Next Month}}:
  1. ___
  2. ___
  3. ___

Key initiatives / projects in progress:
  ___

Agent coaching focus areas:
  ___

Operational improvements planned:
  ___

Revenue/volume goal for next month: $___

════════════════════════════════════
SECTION 8: NOTES & ACTION ITEMS
════════════════════════════════════
Key decisions made this review:
  ___

Action items (owner | deadline):
  1. ___ | ___ | ___
  2. ___ | ___ | ___
  3. ___ | ___ | ___

Next MBR date: ___`,
  },

  kpiDashboardGuide: {
    title: "KPI Dashboard Reference Guide",
    folder: "08",
    content: `LIBERTY BANCARD — KPI DASHBOARD REFERENCE GUIDE
================================================
Which KPIs Matter | How to Calculate Them | What "Good" Looks Like
Internal Use — Management & Agent Reference

────────────────────────────────────
OVERVIEW
────────────────────────────────────
This guide explains the key performance indicators (KPIs) used to track Liberty Bancard's sales, merchant, and operational performance. Understanding these numbers helps every agent and manager make better decisions — what to focus on, what's healthy, and what needs attention.

────────────────────────────────────
KPI 1: EFFECTIVE RATE
────────────────────────────────────
Definition: The actual percentage of processing volume paid as fees, across all fee types.

Formula: Effective Rate = Total Monthly Fees ÷ Total Monthly Volume × 100

Examples:
  Total fees $1,200 on $45,000 volume → Effective Rate = 2.67%
  Total fees $900 on $45,000 volume → Effective Rate = 2.00%

What "good" looks like:
  Liberty Bancard merchants (interchange-plus):   1.5–2.2% effective
  Industry average (tiered pricing):              2.4–3.2%
  Poor (overpaying significantly):                3.2%+

Why it matters:
  → The most important number in any sales conversation
  → Use it to demonstrate savings opportunity
  → Track it for each merchant post-go-live to confirm they're benefiting

────────────────────────────────────
KPI 2: SAVINGS % (vs. Prior Processor)
────────────────────────────────────
Definition: The percentage reduction in processing fees after switching to Liberty Bancard.

Formula: Savings % = (Prior Effective Rate − New Effective Rate) ÷ Prior Effective Rate × 100

Example:
  Prior rate: 2.8%  |  New rate: 1.7%
  Savings: (2.8 – 1.7) ÷ 2.8 × 100 = 39.3%

What "good" looks like:
  Typical savings range: 20–45% effective rate reduction
  Liberty Zero merchants: 100% (all processor fees eliminated)

Why it matters:
  → Key proof point in marketing and case studies
  → Validates that the proposal delivered on its promise
  → Track for each merchant at 30, 90, and 180 days post-go-live

────────────────────────────────────
KPI 3: CLOSE RATE
────────────────────────────────────
Definition: The percentage of qualified opportunities that result in a signed application.

Formula: Close Rate = Merchants Signed ÷ Proposals Delivered × 100

What "good" looks like:
  New agents (months 1–3):       15–25%
  Developing agents (months 4–12): 25–40%
  Experienced agents:              35–55%
  Top performers:                  50%+

Stage-specific conversion benchmarks:
  Cold call → Live conversation:   5–10%
  Live conversation → Statement:   25–40%
  Statement → Proposal:            70–85% (if you got the statement, you should build a strong case)
  Proposal → Application:          35–50%
  Application → Go-Live:           85–95%

Why it matters:
  → Closing rate measures sales skill — how effectively you convert qualified opportunities
  → If close rate is below 25%, focus on proposal quality and objection handling
  → If close rate is high but activity is low, focus on prospecting volume

────────────────────────────────────
KPI 4: AVERAGE DEAL SIZE
────────────────────────────────────
Definition: The average monthly processing volume of merchants you bring on.

Formula: Average Deal Size = Total Volume of New Merchants ÷ Number of New Merchants

What "good" looks like:
  Target average deal size:    $25,000–$75,000/month in processing volume
  High performer target:       $50,000–$150,000+/month average
  Entry-level agents:          $15,000–$40,000/month average

Why it matters:
  → Higher average deal size = higher residual per merchant = faster path to income goals
  → $50K merchant earns ~2× the residual of a $25K merchant with the same effort
  → Focus vertical strategy on higher-volume verticals (medical, restaurant, auto)

────────────────────────────────────
KPI 5: RESIDUAL PORTFOLIO VALUE (RPV)
────────────────────────────────────
Definition: The total monthly residual income generated by your active merchant portfolio.

Formula: RPV = Sum of monthly residual earned from all active merchants

Example:
  30 merchants × $175/month average residual = $5,250/month RPV

What "good" looks like:
  New agent (Month 6):        $500–$1,500/month RPV
  Developing agent (Month 12): $2,000–$4,000/month RPV
  Experienced agent (Year 2):  $5,000–$10,000+/month RPV
  Senior/top performer:        $10,000–$25,000+/month RPV

Growth trajectory:
  RPV should grow every month unless churned merchants exceed new additions
  Monitor: RPV growth rate month-over-month — is it accelerating or stalling?

Why it matters:
  → The single most important measure of long-term agent income
  → Tracks the compounding value of your merchant portfolio
  → Churn hurts RPV — retention is critical

────────────────────────────────────
KPI 6: CHURN RATE
────────────────────────────────────
Definition: The percentage of your merchant portfolio that stops processing with Liberty Bancard each month.

Formula: Monthly Churn Rate = Merchants Lost This Month ÷ Total Active Merchants × 100

What "good" looks like:
  Healthy churn rate:    <2% per month (losing fewer than 2 in 100 merchants each month)
  Industry average:      3–5% per month
  Red flag:              >5% per month (investigate root cause immediately)

Common churn causes:
  → Competitor poached with lower rate (often temporary/bait-and-switch)
  → Merchant went out of business
  → Service issue not resolved
  → Merchant stopped accepting cards (rare)
  → Agent lost contact with merchant (preventable — monthly check-ins)

Retention actions that reduce churn:
  → Monthly touchpoint (call or text — even 2 minutes)
  → Annual statement review (show them they're still getting a good deal)
  → Fast response to any service issue
  → Referral asks at satisfaction peaks (creates relationship investment)

────────────────────────────────────
DASHBOARD SUMMARY — QUICK REFERENCE
────────────────────────────────────
KPI                   Formula                              Target
─────────────────────  ───────────────────────────────────  ───────────────────────
Effective Rate         Fees ÷ Volume × 100                  1.5–2.2% (Liberty merchants)
Savings %             (Old Rate – New Rate) ÷ Old × 100    20–45%
Close Rate            Signed ÷ Proposals × 100             35–55% (experienced)
Average Deal Size      Volume ÷ New Merchants               $25K–$75K/mo
Residual Portfolio     Sum of monthly merchant residuals    $5K+ (Year 1 target)
Monthly Churn Rate     Lost ÷ Total × 100                   <2%/month
Statement → Proposal   Proposals ÷ Statements × 100        70%+
Application → Live     Live ÷ Apps × 100                   85%+`,
  },

  // ── FOLDER 00: Vault Guide ────────────────────────────────────────────────

  vaultGuide: {
    title: "📋 Liberty Bancard Vault — Guide & Merge Field Reference",
    folder: "00",
    content: `LIBERTY BANCARD — MASTER BUSINESS VAULT
GUIDE & MERGE FIELD REFERENCE
=========================================
This folder (📋 00 — Master Index) is your starting point.

The Master Index Google Doc — which links every document in this vault with
its title, link, owner, and category — lives at the ROOT of this Google Drive
vault (one level above this folder). Pin it or bookmark it.

────────────────────────────────────────────────────────────
VAULT STRUCTURE
────────────────────────────────────────────────────────────
📋 00 — Master Index          This guide + link to root Master Index
🎨 01 — Brand & Marketing     One-pagers, competitor comparisons, social posts
💼 02 — Sales Playbooks       Playbook, cold call scripts, talk tracks
📧 03 — Outreach Sequences    Email sequences, SMS library, LinkedIn playbook
📚 04 — SOPs                  Operations, onboarding, statement collection
🤝 05 — Agent Resources       Onboarding guide, 90-day ramp, commission guide
⚖️ 06 — Legal & Compliance    DNC policy, data handling, contractor agreement
🛠️ 07 — Product Sheets        Liberty Zero + 6 terminal product sheets
📊 08 — Business Operations   Standup template, MBR template, KPI guide

────────────────────────────────────────────────────────────
MERGE FIELD NOTATION — HOW TO USE TEMPLATES
────────────────────────────────────────────────────────────
All sales templates (email, SMS, call scripts) in this vault use
{{double curly brace}} notation for personalization fields.

This is standard CRM merge-tag notation (compatible with HubSpot,
ActiveCampaign, Mailchimp, GoHighLevel, and most email platforms).

COMMON MERGE FIELDS:
  {{First Name}}           Recipient's first name
  {{Contact Name}}         Full contact name
  {{Owner Name}}           Business owner's name
  {{Agent Name}}           Your name (the sales rep sending)
  {{Prospect City}}        The prospect's city
  {{Prospect Vertical}}    The prospect's industry (restaurant, retail, etc.)
  {{Business Name}}        Merchant business name
  {{Business Type}}        Type of business (Restaurant, Auto Repair, etc.)
  {{Mutual Connection}}    Name of referral/connection
  {{Merchant Email}}       Prospect's email address
  {{Current Processor}}    Prospect's current payment processor

DOLLAR AMOUNT FIELDS (fill in from statement review):
  $(Current Monthly Cost)  What merchant pays now
  $(New Monthly Cost)      What they'd pay on our program
  $(Monthly Savings)       Monthly savings (current minus new)
  $(Monthly Cost)          Generic monthly cost figure

HOW TO USE IN YOUR CRM:
  Copy the template → paste into your email/SMS tool → the CRM will
  auto-fill any merge fields it recognizes → manually fill in any
  merchant-specific dollar figures from your statement review.

────────────────────────────────────────────────────────────
MASTER INDEX (ROOT LEVEL)
────────────────────────────────────────────────────────────
The Master Business Vault Index is a Google Doc at the root of this
Drive folder. It lists every document with:
  • Title
  • Direct link
  • Owner (team responsible)
  • Category (folder section)
  • One-line description

To find it: go up one level from this folder to the root of
"Liberty Bancard — Master Business Vault."

────────────────────────────────────────────────────────────
CONTACT
────────────────────────────────────────────────────────────
Questions about vault contents: support@libertybancard.com
Phone: 954-266-8214`,
  },
};

// ============================================================
// MASTER INDEX CONTENT (generated after all docs are created)
// ============================================================

function buildMasterIndexContent(
  docLinks: Record<string, { title: string; url: string; folder: string; description: string; owner: string; category: string }>
): string {
  const byFolder: Record<string, Array<{ key: string; title: string; url: string; description: string; owner: string; category: string }>> = {};
  for (const [key, info] of Object.entries(docLinks)) {
    if (!byFolder[info.folder]) byFolder[info.folder] = [];
    byFolder[info.folder].push({ key, title: info.title, url: info.url, description: info.description, owner: info.owner, category: info.category });
  }

  const folderNames: Record<string, string> = {
    "01": "🎨 01 — Brand & Marketing",
    "02": "💼 02 — Sales Playbooks & Scripts",
    "03": "📧 03 — Outreach Sequences & Templates",
    "04": "📚 04 — SOPs & Operating Procedures",
    "05": "🤝 05 — Partner & Agent Resources",
    "06": "⚖️ 06 — Legal & Compliance",
    "07": "🛠️ 07 — Product Sheets",
    "08": "📊 08 — Business Operations & Reviews",
  };

  const startHereKeys = ["masterSalesPlaybook", "coldCallScript", "statementReviewGuide", "agentOnboardingGuide", "agentQuickReferenceCard"];
  const startHereDocs = startHereKeys.map(k => docLinks[k]).filter(Boolean);

  const startHereSection = `
════════════════════════════════════════════════════════════════
⭐ START HERE — NEW SALES REP READING LIST (5 Documents)
════════════════════════════════════════════════════════════════
If you're new, read these 5 documents in this order before your first dial.

${startHereDocs.map((d, i) => `${i + 1}. ${d.title}
   Link:     ${d.url}
   Owner:    ${d.owner}
   Category: ${d.category}
   ${d.description}`).join("\n\n")}

════════════════════════════════════════════════════════════════
`;

  let sections = "";
  const folderOrder = ["00", "01", "02", "03", "04", "05", "06", "07", "08"];
  for (const folder of folderOrder) {
    const docs = byFolder[folder];
    if (!docs || docs.length === 0) continue;
    const name = folderNames[folder] || folder;
    sections += `\n────────────────────────────────────\n${name}\n────────────────────────────────────\n`;
    for (const doc of docs) {
      sections += `\n${doc.title}\n   Link:     ${doc.url}\n   Owner:    ${doc.owner}\n   Category: ${doc.category}\n   ${doc.description}\n`;
    }
  }

  return `LIBERTY BANCARD — MASTER BUSINESS VAULT INDEX
===============================================
Created: ${new Date().toLocaleDateString()}
Purpose: The single entry point for all Liberty Bancard business documents.
         Any team member — agent, manager, admin, new hire — starts here.

${startHereSection}
════════════════════════════════════════════════════════════════
FULL DOCUMENT INDEX
════════════════════════════════════════════════════════════════
${sections}

════════════════════════════════════════════════════════════════
ABOUT THIS VAULT
════════════════════════════════════════════════════════════════
This Google Drive vault was built to give every Liberty Bancard team member everything they need to operate with confidence — on Day 1.

Vault structure:
  🎨 01 — Brand & Marketing:          Brand guidelines, company overview, one-pagers, comparisons, email templates, social posts
  💼 02 — Sales Playbooks & Scripts:  Master playbook, cold call scripts, objection handling, statement review, closing scripts, vertical talk tracks
  📧 03 — Outreach Sequences:         Email sequences, SMS templates, LinkedIn playbook, referral partner kit
  📚 04 — SOPs:                       Daily operations, statement collection, merchant onboarding, lead management, escalation
  🤝 05 — Partner & Agent Resources:  Onboarding guide, 30-60-90 day ramp plan, commission guide, quick-reference card
  ⚖️ 06 — Legal & Compliance:         DNC policy, data handling policy, contractor agreement template
  🛠️ 07 — Product Sheets:             Liberty Zero program sheet, all 6 terminal product sheets
  📊 08 — Business Operations:        Weekly standup template, monthly MBR template, KPI dashboard guide

Contact for updates: support@libertybancard.com | 954-266-8214`;
}

// ============================================================
// FOLDER STRUCTURE
// ============================================================

const SUBFOLDER_NAMES = [
  "📋 00 — Master Index",
  "🎨 01 — Brand & Marketing",
  "💼 02 — Sales Playbooks & Scripts",
  "📧 03 — Outreach Sequences & Templates",
  "📚 04 — SOPs & Operating Procedures",
  "🤝 05 — Partner & Agent Resources",
  "⚖️ 06 — Legal & Compliance",
  "🛠️ 07 — Product Sheets",
  "📊 08 — Business Operations & Reviews",
];

// Map folder code → subfolder name
const FOLDER_CODE_TO_NAME: Record<string, string> = {
  "00": "📋 00 — Master Index",
  "01": "🎨 01 — Brand & Marketing",
  "01a": "🎨 01 — Brand & Marketing",
  "02": "💼 02 — Sales Playbooks & Scripts",
  "03": "📧 03 — Outreach Sequences & Templates",
  "04": "📚 04 — SOPs & Operating Procedures",
  "05": "🤝 05 — Partner & Agent Resources",
  "06": "⚖️ 06 — Legal & Compliance",
  "07": "🛠️ 07 — Product Sheets",
  "08": "📊 08 — Business Operations & Reviews",
};

export interface VaultStatus {
  rootFolderId?: string;
  rootFolderUrl?: string;
  masterIndexUrl?: string;
  documentsCreated: number;
  totalDocuments: number;
  errors: string[];
  completed: boolean;
}

export async function createMasterVault(): Promise<VaultStatus> {
  const connectors = getConnectors();
  const ROOT_NAME = "Liberty Bancard — Master Business Vault";

  const errors: string[] = [];
  let documentsCreated = 0;
  const totalDocuments = Object.keys(DOCS).length + 1; // +1 for master index

  // Step 1: Create or find root folder
  let rootId = await findFile(connectors, ROOT_NAME, "application/vnd.google-apps.folder");
  if (!rootId) {
    rootId = await createFolder(connectors, ROOT_NAME);
  }
  const rootFolderUrl = `https://drive.google.com/drive/folders/${rootId}`;

  // Step 2: Create subfolders
  const subfolderIds: Record<string, string> = {};
  for (const sfName of SUBFOLDER_NAMES) {
    const sfId = await ensureFolder(connectors, sfName, rootId);
    // Determine the code from the name
    const match = sfName.match(/(\d{2})/);
    if (match) {
      subfolderIds[match[1]] = sfId;
    }
  }

  // Step 3: Create all documents
  const docLinks: Record<string, { title: string; url: string; folder: string; description: string; owner: string; category: string }> = {};

  const DESCRIPTIONS: Record<string, string> = {
    brandGuidelines: "Complete brand standards: colors, typography, logo rules, voice principles, do/don't examples, and required compliance language.",
    companyOverview: "Who Liberty Bancard is, the statement-first methodology, Liberty Zero, and the 3-step process. Suitable for sharing with merchants and partners.",
    vop_restaurant: "Value proposition, proof points, and CTA for restaurant merchants — stops the 3% table loss.",
    vop_medical: "Value proposition and savings case for medical and healthcare practices.",
    vop_retail: "Value proposition for retail merchants on tight margins losing to premium card downgrades.",
    vop_auto: "Value proposition for auto repair shops — fleet cards, high tickets, Liberty Zero fit.",
    vop_hotel: "Value proposition for hotels and hospitality merchants with CNP downgrade exposure.",
    vop_lawfirm: "Value proposition for law firms collecting retainers — B2B interchange and Level 2/3 data.",
    vop_salon: "Value proposition for salons and spas — tip-adjust optimization and Liberty Zero.",
    vop_dental: "Value proposition for dental practices — rewards card downgrade and PCI compliance.",
    vop_gym: "Value proposition for gyms and fitness studios — recurring billing CNP optimization.",
    vop_ecommerce: "Value proposition for e-commerce merchants overpaying on Stripe/Square flat rates.",
    vop_contractors: "Value proposition for contractors — keyed-entry downgrade and Liberty Zero at high ticket.",
    vop_grocery: "Value proposition for grocery stores — debit optimization and per-transaction fee reduction.",
    vop_cstore: "Value proposition for convenience stores — per-transaction fee and Liberty Zero normalization.",
    cc_square: "Side-by-side pricing, hidden fees, and why-switch talking points vs. Square.",
    cc_stripe: "Side-by-side pricing, hidden fees, and why-switch talking points vs. Stripe.",
    cc_clover: "Clover processing comparison — same terminal, better processor, lower cost.",
    cc_toast: "Toast comparison with breakeven analysis for switching to Clover Station Duo + Liberty Bancard.",
    emailTemplates: "Ready-to-send email templates for cold outreach (5 variants), statement follow-up, referral partner welcome, and re-engagement.",
    socialMediaCopyBank: "30 LinkedIn and Facebook post templates: savings proof, fee education, Liberty Zero, and case study frameworks.",
    masterSalesPlaybook: "The definitive 5-step selling guide: mindset, discovery, statement collection, proposal delivery, and close.",
    coldCallScript: "Full cold call script with 3 opener variants, gatekeeper handling, discovery questions, statement pivot, and voicemail script.",
    objectionHandlingPlaybook: "Word-for-word responses to the 20 most common merchant objections with reframe language and bridge phrases.",
    statementReviewGuide: "Step-by-step guide to calculating effective rate, identifying fee structures, finding hidden fees, and building the savings case.",
    closingScripts: "Trial closes, savings reveal script, direct close, urgency triggers, stall handling, and verbal-to-written commitment bridge.",
    tt_restaurant: "Restaurant-specific pain points, savings angles, objections, and opening hooks.",
    tt_medical: "Medical and healthcare pain points, savings angles, and opening hooks.",
    tt_retail: "Retail pain points, savings angles, and opening hooks.",
    tt_auto: "Auto repair pain points, savings angles, and opening hooks.",
    tt_hotel: "Hotel and hospitality pain points, savings angles, and opening hooks.",
    tt_lawfirm: "Law firm pain points, B2B interchange angles, and opening hooks.",
    tt_salon: "Salon and spa pain points, tip-adjust optimization, and opening hooks.",
    tt_dental: "Dental pain points, rewards card exposure, and opening hooks.",
    tt_gym: "Gym and fitness pain points, recurring billing CNP, and opening hooks.",
    tt_ecommerce: "E-commerce pain points, Stripe/Square alternative math, and opening hooks.",
    tt_contractors: "Contractor pain points, keyed-entry exposure, and opening hooks.",
    tt_grocery: "Grocery pain points, debit optimization, and opening hooks.",
    tt_cstore: "C-store pain points, per-transaction fee focus, and opening hooks.",
    emailSequenceMap: "Complete map of all outreach sequences: audience, trigger, steps, timing, and exit conditions for all 9 sequences.",
    smsTemplatesLibrary: "20+ compliant SMS templates for initial outreach, appointment reminders, no-show follow-up, statement requests, and post-close check-ins.",
    linkedInPlaybook: "Connection request templates, InMail scripts, and follow-up sequences for merchants and referral partners.",
    referralPartnerOutreachKit: "Email and phone scripts for recruiting CPAs, bookkeepers, insurance agents, and chamber contacts as referral partners.",
    dailyOperationsSOP: "Full daily workflow for sales reps with time-blocked schedule, activity targets, GHL hygiene standards, and weekly rhythm.",
    statementCollectionSOP: "How to request, receive, and analyze merchant statements — including acceptable formats, portal instructions, and proposal delivery.",
    merchantOnboardingSOP: "Everything after the merchant signs: document collection, underwriting, terminal setup, go-live, and post-go-live check-in schedule.",
    leadManagementSOP: "Pipeline stages, lead scoring, follow-up timing rules, when to escalate vs. nurture, and GHL hygiene standards.",
    escalationSOP: "Contact matrix and procedures for terminal issues, billing errors, chargebacks, merchant complaints, and manager escalations.",
    agentOnboardingGuide: "Systems access, first-week schedule, who to contact, reading order, and what success in 30 days looks like.",
    rampPlan306090: "Structured 90-day ramp: activity targets, training milestones, check-in schedule, and success markers for each phase.",
    commissionSchedule: "Residual income model, upfront bonuses, how to read your commission statement, and the path to $10K/month.",
    agentQuickReferenceCard: "Logins, key contacts, tool links, compliance reminders, daily minimums, and pipeline stage cheat sheet.",
    dncCompliancePolicy: "DNC registry rules, TCPA compliance for calls and SMS, required disclosures, opt-out handling, and record-keeping requirements.",
    merchantDataHandlingPolicy: "What data is collected, how it's stored, who has access, data retention periods, and merchant deletion request process.",
    agentContractorAgreementTemplate: "Ready-to-execute template covering contractor status, commission structure, confidentiality, non-solicitation, IP, and termination terms.",
    libertyZeroProgramSheet: "Complete explanation of Liberty Zero: how cash discount and surcharging work, compliance, qualification criteria, and enrollment process.",
    ps_dejavoo: "Liberty Bancard Smart Terminal (Dejavoo QD4) — specs, Liberty Zero pre-config, and best-fit merchants.",
    ps_clover_flex: "Clover Flex 3 — handheld POS with full app market, tableside payments, best for restaurants.",
    ps_clover_mini: "Clover Mini 3 — compact countertop POS with fingerprint login, best for quick-service.",
    ps_clover_station: "Clover Station Duo — full-service dual-screen POS, best for full-service restaurants and retail.",
    ps_pax_a920: "PAX A920 — sleek Android smart terminal with all-day battery, popular in retail and salons.",
    ps_swipesimple: "SwipeSimple — mobile Bluetooth reader + app for low-volume merchants wanting simplicity.",
    weeklyStandupTemplate: "Reusable 30-minute standup agenda with pipeline review, rep updates, blockers, rotating training topics, and weekly goals.",
    monthlyBusinessReviewTemplate: "Monthly review template covering merchant volume, revenue vs. target, top performers, pipeline health, operations, marketing, and next-month priorities.",
    kpiDashboardGuide: "Definitions, formulas, and 'what good looks like' benchmarks for all key KPIs: effective rate, savings %, close rate, average deal size, RPV, and churn.",
    vaultGuide: "Vault orientation guide: folder structure map, full merge-field reference ({{First Name}}, $(Monthly Savings), etc.), how to use CRM templates, and Master Index location.",
  };

  // Owner for each document (team member or role responsible for content)
  const OWNERS: Record<string, string> = {
    brandGuidelines: "Marketing Team",
    companyOverview: "Marketing Team",
    vop_restaurant: "Marketing Team",
    vop_medical: "Marketing Team",
    vop_retail: "Marketing Team",
    vop_auto: "Marketing Team",
    vop_hotel: "Marketing Team",
    vop_lawfirm: "Marketing Team",
    vop_salon: "Marketing Team",
    vop_dental: "Marketing Team",
    vop_gym: "Marketing Team",
    vop_ecommerce: "Marketing Team",
    vop_contractors: "Marketing Team",
    vop_grocery: "Marketing Team",
    vop_cstore: "Marketing Team",
    cc_square: "Sales Leadership",
    cc_stripe: "Sales Leadership",
    cc_clover: "Sales Leadership",
    cc_toast: "Sales Leadership",
    emailTemplates: "Marketing Team",
    socialMediaCopyBank: "Marketing Team",
    masterSalesPlaybook: "Sales Leadership",
    coldCallScript: "Sales Leadership",
    objectionHandlingPlaybook: "Sales Leadership",
    statementReviewGuide: "Sales Leadership",
    closingScripts: "Sales Leadership",
    tt_restaurant: "Sales Leadership",
    tt_medical: "Sales Leadership",
    tt_retail: "Sales Leadership",
    tt_auto: "Sales Leadership",
    tt_hotel: "Sales Leadership",
    tt_lawfirm: "Sales Leadership",
    tt_salon: "Sales Leadership",
    tt_dental: "Sales Leadership",
    tt_gym: "Sales Leadership",
    tt_ecommerce: "Sales Leadership",
    tt_contractors: "Sales Leadership",
    tt_grocery: "Sales Leadership",
    tt_cstore: "Sales Leadership",
    emailSequenceMap: "Sales Leadership",
    smsTemplatesLibrary: "Sales Leadership",
    linkedInPlaybook: "Sales Leadership",
    referralPartnerOutreachKit: "Sales Leadership",
    dailyOperationsSOP: "Operations",
    statementCollectionSOP: "Operations",
    merchantOnboardingSOP: "Operations",
    leadManagementSOP: "Operations",
    escalationSOP: "Operations",
    agentOnboardingGuide: "Operations",
    rampPlan306090: "Operations",
    commissionSchedule: "Finance",
    agentQuickReferenceCard: "Operations",
    dncCompliancePolicy: "Compliance",
    merchantDataHandlingPolicy: "Compliance",
    agentContractorAgreementTemplate: "Legal",
    libertyZeroProgramSheet: "Product Team",
    ps_dejavoo: "Product Team",
    ps_clover_flex: "Product Team",
    ps_clover_mini: "Product Team",
    ps_clover_station: "Product Team",
    ps_pax_a920: "Product Team",
    ps_swipesimple: "Product Team",
    weeklyStandupTemplate: "Operations",
    monthlyBusinessReviewTemplate: "Leadership",
    kpiDashboardGuide: "Leadership",
    vaultGuide: "Operations",
  };

  // Category (folder-level label) for each document
  const CATEGORIES: Record<string, string> = {
    brandGuidelines: "Brand & Marketing",
    companyOverview: "Brand & Marketing",
    vop_restaurant: "Brand & Marketing",
    vop_medical: "Brand & Marketing",
    vop_retail: "Brand & Marketing",
    vop_auto: "Brand & Marketing",
    vop_hotel: "Brand & Marketing",
    vop_lawfirm: "Brand & Marketing",
    vop_salon: "Brand & Marketing",
    vop_dental: "Brand & Marketing",
    vop_gym: "Brand & Marketing",
    vop_ecommerce: "Brand & Marketing",
    vop_contractors: "Brand & Marketing",
    vop_grocery: "Brand & Marketing",
    vop_cstore: "Brand & Marketing",
    cc_square: "Brand & Marketing",
    cc_stripe: "Brand & Marketing",
    cc_clover: "Brand & Marketing",
    cc_toast: "Brand & Marketing",
    emailTemplates: "Brand & Marketing",
    socialMediaCopyBank: "Brand & Marketing",
    masterSalesPlaybook: "Sales Playbooks & Scripts",
    coldCallScript: "Sales Playbooks & Scripts",
    objectionHandlingPlaybook: "Sales Playbooks & Scripts",
    statementReviewGuide: "Sales Playbooks & Scripts",
    closingScripts: "Sales Playbooks & Scripts",
    tt_restaurant: "Sales Playbooks & Scripts",
    tt_medical: "Sales Playbooks & Scripts",
    tt_retail: "Sales Playbooks & Scripts",
    tt_auto: "Sales Playbooks & Scripts",
    tt_hotel: "Sales Playbooks & Scripts",
    tt_lawfirm: "Sales Playbooks & Scripts",
    tt_salon: "Sales Playbooks & Scripts",
    tt_dental: "Sales Playbooks & Scripts",
    tt_gym: "Sales Playbooks & Scripts",
    tt_ecommerce: "Sales Playbooks & Scripts",
    tt_contractors: "Sales Playbooks & Scripts",
    tt_grocery: "Sales Playbooks & Scripts",
    tt_cstore: "Sales Playbooks & Scripts",
    emailSequenceMap: "Outreach Sequences & Templates",
    smsTemplatesLibrary: "Outreach Sequences & Templates",
    linkedInPlaybook: "Outreach Sequences & Templates",
    referralPartnerOutreachKit: "Outreach Sequences & Templates",
    dailyOperationsSOP: "SOPs & Operating Procedures",
    statementCollectionSOP: "SOPs & Operating Procedures",
    merchantOnboardingSOP: "SOPs & Operating Procedures",
    leadManagementSOP: "SOPs & Operating Procedures",
    escalationSOP: "SOPs & Operating Procedures",
    agentOnboardingGuide: "Partner & Agent Resources",
    rampPlan306090: "Partner & Agent Resources",
    commissionSchedule: "Partner & Agent Resources",
    agentQuickReferenceCard: "Partner & Agent Resources",
    dncCompliancePolicy: "Legal & Compliance",
    merchantDataHandlingPolicy: "Legal & Compliance",
    agentContractorAgreementTemplate: "Legal & Compliance",
    libertyZeroProgramSheet: "Product Sheets",
    ps_dejavoo: "Product Sheets",
    ps_clover_flex: "Product Sheets",
    ps_clover_mini: "Product Sheets",
    ps_clover_station: "Product Sheets",
    ps_pax_a920: "Product Sheets",
    ps_swipesimple: "Product Sheets",
    weeklyStandupTemplate: "Business Operations & Reviews",
    monthlyBusinessReviewTemplate: "Business Operations & Reviews",
    kpiDashboardGuide: "Business Operations & Reviews",
    vaultGuide: "Master Index",
  };

  for (const [key, doc] of Object.entries(DOCS)) {
    try {
      const folderCode = doc.folder;
      const subfolderName = FOLDER_CODE_TO_NAME[folderCode];
      let subfolderId: string;

      // Find or create the subfolder
      if (subfolderIds[folderCode]) {
        subfolderId = subfolderIds[folderCode];
      } else {
        // Try to find by name
        const found = await findFile(connectors, subfolderName, "application/vnd.google-apps.folder", rootId);
        if (found) {
          subfolderId = found;
          subfolderIds[folderCode] = found;
        } else {
          subfolderId = await ensureFolder(connectors, subfolderName, rootId);
          subfolderIds[folderCode] = subfolderId;
        }
      }

      const result = await ensureDoc(connectors, doc.title, doc.content, subfolderId);
      docLinks[key] = {
        title: doc.title,
        url: result.url,
        folder: folderCode,
        description: DESCRIPTIONS[key] || "",
        owner: OWNERS[key] || "Liberty Bancard",
        category: CATEGORIES[key] || "",
      };
      if (result.created) documentsCreated++;
      console.log(`[Vault] ${result.created ? "Created" : "Found"}: ${doc.title} → ${result.url}`);
    } catch (err: any) {
      const msg = `Failed to create "${doc.title}": ${err.message}`;
      errors.push(msg);
      console.error(`[Vault] ERROR: ${msg}`);
    }
  }

  // Step 4: Create Master Index — lives at the ROOT folder per spec ("A Master Index Google Doc lives at the root")
  let masterIndexUrl: string | undefined;
  try {
    const indexFolderId = rootId;
    const indexContent = buildMasterIndexContent(docLinks);
    const indexTitle = "Master Business Vault Index — Liberty Bancard";
    const indexResult = await ensureDoc(connectors, indexTitle, indexContent, indexFolderId);
    masterIndexUrl = indexResult.url;
    if (indexResult.created) documentsCreated++;
    console.log(`[Vault] Master Index ${indexResult.created ? "created" : "found"}: ${masterIndexUrl}`);
  } catch (err: any) {
    errors.push(`Failed to create Master Index: ${err.message}`);
    console.error(`[Vault] ERROR creating master index: ${err.message}`);
  }

  return {
    rootFolderId: rootId,
    rootFolderUrl,
    masterIndexUrl,
    documentsCreated,
    totalDocuments,
    errors,
    completed: errors.length === 0,
  };
}

export async function getVaultStatus(): Promise<{ exists: boolean; rootFolderUrl?: string; folderCount?: number }> {
  const connectors = getConnectors();
  const ROOT_NAME = "Liberty Bancard — Master Business Vault";
  const rootId = await findFile(connectors, ROOT_NAME, "application/vnd.google-apps.folder");

  if (!rootId) return { exists: false };

  const q = `'${rootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const resp = await connectors.proxy("google-drive", `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, { method: "GET" });
  const data = await parseJsonOrThrow<{ files: { id: string; name: string }[] }>(resp, "getVaultStatus");

  return {
    exists: true,
    rootFolderUrl: `https://drive.google.com/drive/folders/${rootId}`,
    folderCount: data.files?.length || 0,
  };
}
