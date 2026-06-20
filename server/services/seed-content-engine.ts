import { storage } from "../storage";
import type { InsertContentAuthor, InsertSocialPost } from "@shared/schema";

const KB_SALES_SCRIPTS: Array<{ title: string; category: string; content: string; tags: string[]; isPublished: boolean }> = [
  {
    title: "The 5-Minute Comparison Call Script",
    category: "Sales Scripts",
    tags: ["call script", "comparison call", "statement review", "sales"],
    isPublished: true,
    content: `# The 5-Minute Comparison Call Script

Use this script on every comparison call. The goal is to get the merchant's current effective rate, show the math on what they'd save, and close for a statement upload or next-step commitment — all within 5 minutes.

---

## OPENING (30 seconds)

"Hi {{firstName}}, this is {{agentName}} from Liberty Bancard — thanks for taking a few minutes. Real quick, I want to make sure this is worth your time before we dive in. Do you currently accept credit and debit cards at your business?"

[Yes] → "Great. And roughly how much volume are you running through your processor each month? Ballpark is fine."

[Get a number] → "Perfect. And do you know offhand what your current effective rate is — meaning the actual percentage you're paying after all fees, not just the advertised rate?"

- If they know: note it and proceed.
- If they don't know: "No worries — most merchants don't. That's actually what I'm going to show you today."

---

## STATEMENT REVIEW (2 minutes)

"So here's the thing — most processors quote you one rate, but when you add up all the fees on your statement, the real number is usually 0.3% to 1% higher than what you think you're paying."

"For example, if you're on 2.6% flat and your actual effective rate after all fees is 3.2%, on $[their monthly volume] a month, that gap alone is $[calculate: volume × 0.006]/month — or $[annualize] a year."

CALCULATION TIP: If they're doing $80K/month and paying 3.2% effective vs. an ideal 2.2%, that's $800/month or $9,600/year.

"What I want to do is pull up your last statement with you — or if you can forward it to me — and show you your real effective rate, line by line. No smoke and mirrors."

---

## THE COMPARISON (1 minute)

"Here's how our pricing works. We use interchange-plus pricing — that means you pay the actual Visa/Mastercard interchange rate plus a small, fixed markup. No bundled rates, no tiered surprises."

"For a business like yours, our all-in effective rate would typically run about [give range based on vertical: retail 1.9–2.3%, restaurant 2.0–2.4%, healthcare 1.8–2.2%, high-ticket 1.7–2.1%]. Compare that to what you're currently paying."

"And if you're open to a cash discount or dual-pricing program, we can get your net processing cost to near zero — legally, with full card-brand approval. That's a separate conversation if it's interesting."

---

## THE CLOSE (30 seconds)

Choose based on where the merchant is:

**If they're engaged and motivated:**
"The easiest next step is to forward me your last processing statement — PDF, photo of the paper, whatever you have. I'll do the full analysis overnight and send you a side-by-side comparison. Takes you 2 minutes. Does that work?"

**If they're interested but cautious:**
"I'm not going to push you to make any decisions today. Let me just show you the numbers — if it makes sense, great; if not, at least you'll know exactly what you're paying. Can we get 10 minutes on the calendar this week?"

**If they want to think about it:**
"Totally understand. One quick question before I let you go — is it the timing that's not right, or is there something specific that would need to change for this to make sense?"

---

## OBJECTION HANDLING

**"I'm in a contract."**
"What's your early termination fee?"
[They answer] → "If switching saves you $[X]/month, your breakeven is [ETF ÷ monthly savings] months. Most early terminations pay for themselves in 2–4 months. Worth running the math?"

**"Need to think about it."**
"Of course. What specifically would you want to think through? If it's the numbers, I can have the full comparison to you by tomorrow — that might make the decision easier."

**"Happy with my current processor."**
"That's great — and I'm not here to fix something that isn't broken. But when's the last time you had an independent look at your effective rate? Even happy customers are often surprised. If the analysis confirms you're getting a good deal, you'll have peace of mind. If it doesn't — you'll be glad you looked."

**"Need to talk to my partner / accountant."**
"Absolutely. Would it help if I put together a one-page summary of the numbers that you could share with them? That way they have all the facts in front of them when you discuss it."`,
  },
  {
    title: "Handling the 5 Most Common Merchant Objections",
    category: "Sales Scripts",
    tags: ["objections", "sales", "rebuttals", "closing"],
    isPublished: true,
    content: `# Handling the 5 Most Common Merchant Objections

Each objection below includes a reframe (what's really going on) and a suggested reply. Use the reply verbatim or adapt it to your voice.

---

## OBJECTION 1: "I'm in a contract / I'll have an early termination fee."

**Reframe:** The merchant assumes switching costs more than staying. They haven't done the breakeven math — and neither have you yet. Make them do the math together.

**Suggested Reply:**
"What's your early termination fee? Because if we can save you $400–$800 a month, even a $495 ETF pays for itself in 30–60 days. Most merchants who switch mid-contract are cash-flow positive by month two. Can I run the breakeven on your statement?"

---

## OBJECTION 2: "I'm happy with my current processor."

**Reframe:** Satisfaction doesn't mean they're getting a good deal — it usually means they haven't compared. Happy is not the same as optimized.

**Suggested Reply:**
"That's great — I'm not here to create a problem where there isn't one. But here's the thing: most merchants who tell me they're happy haven't looked at their effective rate in over a year. If an independent review confirms you're on good pricing, you'll know for sure. If it doesn't — you'll have missed $600–$1,200/month you could have kept. Would you let me do a 24-hour analysis, no strings attached?"

---

## OBJECTION 3: "Your rates seem about the same as what I'm paying now."

**Reframe:** They're comparing advertised rates, not effective rates. The gap between the two is where merchants lose the most money.

**Suggested Reply:**
"The advertised rate is almost never the real number. What you're actually paying is your effective rate — that's total fees divided by total volume on your statement. Most merchants think they're at 2.5% and find out they're actually at 3.1–3.4% when you include all the fees. I can calculate your exact effective rate from your last statement in under 24 hours. Want me to show you the real number?"

---

## OBJECTION 4: "I need to talk to my partner / accountant first."

**Reframe:** This is a legitimate request, not a brush-off. Make it easy for them to have the conversation by giving them the right materials.

**Suggested Reply:**
"Absolutely — I'd encourage that. Would it help if I put together a one-page savings summary showing your current effective rate versus what you'd pay with us, plus the annual dollar difference? Something concrete they can review without having to ask you to remember the details. That way the conversation with your partner or accountant is about the numbers, not the concept."

---

## OBJECTION 5: "I already tried switching processors once — it was a hassle."

**Reframe:** They had a bad experience and are risk-averse. Don't dismiss the experience. Validate it, then differentiate your process.

**Suggested Reply:**
"That's completely fair — a bad setup experience can cost you days of disruption. What went wrong last time? [Listen.] Here's what we do differently: we handle the equipment setup, merchant account transfer, and software integration. Your team doesn't have to touch the technical side. Most switches we do are live within 48–72 hours, and we do a same-day call after go-live to make sure everything is clean. I can also put you in touch with two or three current clients who switched from [their processor] if that would help."`,
  },
];

async function seedKnowledgeBaseScripts() {
  try {
    const existing = await storage.getKnowledgeBaseArticles();
    const existingTitles = new Set(existing.map((a: any) => a.title));
    for (const article of KB_SALES_SCRIPTS) {
      if (!existingTitles.has(article.title)) {
        await storage.createKnowledgeBaseArticle({
          ...article,
          viewCount: 0,
          helpfulCount: 0,
        });
        console.log(`[Seed:KB] Created article: ${article.title}`);
      }
    }
  } catch (err: any) {
    console.error("[Seed:KB] Sales Scripts seeding failed:", err.message);
  }
}

const AUTHORS: InsertContentAuthor[] = [
  {
    slug: "liberty-bancard-team",
    name: "Liberty Bancard Team",
    title: "Editorial Desk",
    bio: "The Liberty Bancard editorial team writes about merchant services, payment economics, and the operational details that determine how much businesses actually pay to accept cards.",
    longBio:
      "The Liberty Bancard editorial team is a working group of underwriters, account managers, and former merchants who collectively review thousands of processing statements each year. Our coverage focuses on transparent interchange-plus pricing, programs that legally offset processing costs (cash discount and surcharging), industry-specific risk and reserves, and the compliance and security controls every merchant should understand. Every article is reviewed against the same checklist: is it factually accurate, is it specific enough to be useful, and does it avoid the marketing language that makes most payments content useless?",
    avatarUrl: "/logo-blue.png",
    linkedinUrl: "https://www.linkedin.com/company/liberty-bancard",
    websiteUrl: "https://libertybancard.com",
    expertise: ["Interchange-plus pricing", "Cash discount", "Surcharging", "PCI DSS", "Statement audits"],
    email: "editorial@libertybancard.com",
  },
  {
    slug: "scott-hunter",
    name: "Scott Hunter",
    title: "Founder, Liberty Bancard",
    bio: "Scott Hunter founded Liberty Bancard to give small businesses the same wholesale processing pricing that large enterprises get — without the contract games.",
    longBio:
      "Scott Hunter has spent more than a decade in payments, first as a Tier-1 ISO and then as the founder of Liberty Bancard. He focuses on long-form statement audits, helping merchants migrate from tiered or bundled pricing to transparent interchange-plus, and building cash discount and surcharging programs that hold up under card brand scrutiny. He writes regularly about effective rate calculation, hidden fees, and the operational details (batch timing, downgrade-free authorizations, Level II/III data, next-day funding) that determine merchant economics.",
    avatarUrl: "/logo-blue.png",
    linkedinUrl: "https://www.linkedin.com/in/scott-hunter-payments",
    websiteUrl: "https://libertybancard.com",
    expertise: [
      "Statement audits",
      "Interchange-plus migration",
      "Cash discount compliance",
      "Reserve & underwriting strategy",
      "ISO operations",
    ],
    email: "scott@libertybancard.com",
  },
];

// 20 LinkedIn drafts spanning the four content pillars (5 each).
const LINKEDIN_DRAFTS: Array<Omit<InsertSocialPost, "createdBy">> = [
  // Pillar 1: Cost & Pricing
  {
    platform: "linkedin",
    pillar: "Cost & Pricing",
    cluster: "Effective Rate",
    body: "Your processor quoted 1.79% but you're actually paying 3.2%.\n\nHere's how to verify in 60 seconds:\n\n1. Pull your last processing statement\n2. Find total fees and total volume\n3. Divide fees / volume\n4. Multiply by 100\n\nThat number is your effective rate. It's the only one that matters.\n\nIf the gap from your quoted rate is more than 0.3%, you have hidden costs worth investigating.\n\nWe'll do a free line-by-line review if you want a second set of eyes.",
    hashtags: ["#payments", "#smallbusiness", "#merchantservices"],
    status: "draft",
    authorName: "Scott Hunter",
  },
  {
    platform: "linkedin",
    pillar: "Cost & Pricing",
    cluster: "Tiered vs Interchange-Plus",
    body: "Tiered pricing was designed to be confusing. That's not an opinion — it's the business model.\n\nQualified, mid-qualified, non-qualified — those buckets exist so you can't tell what's interchange and what's processor markup.\n\nInterchange-plus splits them out. You see the real card cost on every line, then a small fixed markup.\n\nMost merchants save 0.4% to 0.9% just by switching pricing models. Same processor, same hardware, same volume — different math.",
    hashtags: ["#payments", "#interchange", "#smallbusiness"],
    status: "draft",
    authorName: "Liberty Bancard Team",
  },
  {
    platform: "linkedin",
    pillar: "Cost & Pricing",
    cluster: "Hidden Fees",
    body: "Six fees that quietly eat your margin every month:\n\n- PCI non-compliance fee ($19.95–$99/mo)\n- Statement fee ($5–$15)\n- Batch fee per close ($0.10–$0.30)\n- Monthly minimum (charged when volume is low)\n- Annual fee buried in fine print\n- Rate-bump notice you didn't read\n\nAdd them up. For most small merchants this is $400–$1,500 a year before a single transaction.",
    hashtags: ["#smallbusiness", "#fees", "#payments"],
    status: "draft",
  },
  {
    platform: "linkedin",
    pillar: "Cost & Pricing",
    cluster: "Statement Audit",
    body: "We audited 47 processing statements last month.\n\nAverage overpayment: $4,612 a year.\nMedian: $3,180 a year.\nLowest: $0 (already on transparent pricing — kudos).\nHighest: $19,400 a year for a single restaurant.\n\nThe math isn't complicated. The pricing is.\n\nIf you want a second set of eyes on yours, send it over. No obligation.",
    hashtags: ["#paymentsmatters", "#smallbusiness"],
    status: "draft",
  },
  {
    platform: "linkedin",
    pillar: "Cost & Pricing",
    cluster: "Switching Costs",
    body: "\"But I'm under contract\" — said the merchant overpaying $7,200/year.\n\nMost early termination fees range from $250 to $495.\n\nIf switching saves you $600 a month, the breakeven is week six.\n\nThe friction is psychological, not financial. Audit first. Then decide.",
    hashtags: ["#payments", "#contracts", "#smallbusiness"],
    status: "draft",
  },

  // Pillar 2: Programs
  {
    platform: "linkedin",
    pillar: "Programs",
    cluster: "Cash Discount",
    body: "Cash discount programs are not surcharging. The legal distinction matters.\n\nCash discount: posted price reflects the credit price, customers paying cash get a discount.\nSurcharging: posted price is base, an explicit fee is added at credit checkout.\n\nCash discount is legal in all 50 states.\nSurcharging requires Visa/MC registration 30 days in advance and is restricted in CT, MA, and PR.\n\nPick the right tool, then implement it cleanly.",
    hashtags: ["#cashdiscount", "#surcharging", "#payments"],
    status: "draft",
  },
  {
    platform: "linkedin",
    pillar: "Programs",
    cluster: "Surcharging Compliance",
    body: "Surcharging compliance in 5 bullets:\n\n- Register with Visa and Mastercard at least 30 days before launch\n- Cap surcharge at 3% (or your effective rate, whichever is lower)\n- Post signage at the door AND at every point of sale\n- Show the surcharge as a separate receipt line item\n- Never surcharge a debit card — even if the customer routes it as credit\n\nMiss any of these and you're exposed to fines and brand penalties.",
    hashtags: ["#surcharging", "#compliance", "#payments"],
    status: "draft",
  },
  {
    platform: "linkedin",
    pillar: "Programs",
    cluster: "Dual Pricing",
    body: "Dual pricing is having a moment.\n\nIt's a hybrid: you display two prices (cash and credit) and the POS charges accordingly. No surcharge line, no \"discount\" math at the register.\n\nGood for: restaurants, auto repair, professional services.\nLess good for: e-commerce (no cash channel) and stores with frequent split tenders.\n\nDone right, it's the cleanest implementation. Done sloppily, it confuses customers and invites disputes.",
    hashtags: ["#dualpricing", "#payments", "#smallbusiness"],
    status: "draft",
  },
  {
    platform: "linkedin",
    pillar: "Programs",
    cluster: "Customer Communication",
    body: "Most cash discount complaints come from one thing: surprise.\n\nFix it before launch:\n\n- Train every cashier on the one-line explanation\n- Print signage that customers actually read (not 8pt at the bottom)\n- Update your menu/website prices to reflect credit pricing\n- Practice the handoff: \"Heads up — cash saves you 3.5% if you'd prefer\"\n\nNo surprise = no complaint. The program runs itself after week two.",
    hashtags: ["#cashdiscount", "#operations"],
    status: "draft",
  },
  {
    platform: "linkedin",
    pillar: "Programs",
    cluster: "Zero-Cost Math",
    body: "\"Zero-cost processing\" is a marketing phrase. Read the math behind it.\n\nWhat actually happens: the cost shifts from your P&L to the customer's receipt — through a properly structured cash discount or surcharge program.\n\nDone right, your effective rate drops to ~0.05–0.10% (the small residual you still owe).\nDone wrong, you're out of compliance and customers churn.\n\nIt is real. It is also detail-sensitive.",
    hashtags: ["#zerocostprocessing", "#cashdiscount"],
    status: "draft",
  },

  // Pillar 3: Industry
  {
    platform: "linkedin",
    pillar: "Industry",
    cluster: "Med Spas",
    body: "Med spa operators: three things to fix on your processing today.\n\n1. AmEx OptBlue — get on it. Direct AmEx pricing is brutal.\n2. Recurring billing — make sure stored cards are tokenized, not raw PANs.\n3. Membership programs — a separate MID for memberships isolates risk and simplifies reporting.\n\nMed spa AOV is high enough that every basis point compounds fast. Audit twice a year.",
    hashtags: ["#medspa", "#aesthetics", "#payments"],
    status: "draft",
  },
  {
    platform: "linkedin",
    pillar: "Industry",
    cluster: "Dental Practices",
    body: "Dental offices: your processor is probably treating you like a retail merchant. They aren't the same.\n\n- Card-on-file recurring for treatment plans\n- Patient deposits (with refund policies that actually print on receipts)\n- HSA/FSA card support without hard-decline edge cases\n- Statement reporting that maps to your PMS\n\nIf any of those are friction in your practice, your processor isn't built for dental.",
    hashtags: ["#dentistry", "#dentaloffice", "#payments"],
    status: "draft",
  },
  {
    platform: "linkedin",
    pillar: "Industry",
    cluster: "Restaurants",
    body: "Restaurant operators waste more on processing than almost any vertical.\n\nWhy:\n- Tip adjustments that batch incorrectly (downgrades $$$)\n- Card-not-present orders running on card-present rates\n- Online ordering with a separate gateway nobody audits\n- Pre-auth holds that age out and re-auth at higher tiers\n\nFour quick fixes can drop a 3.4% effective rate to 2.7%.",
    hashtags: ["#restaurants", "#hospitality", "#payments"],
    status: "draft",
  },
  {
    platform: "linkedin",
    pillar: "Industry",
    cluster: "B2B & Wholesale",
    body: "B2B merchants paying retail rates is the most common, most expensive mistake we see.\n\nLevel II and Level III data on commercial card transactions can drop your interchange by 40–80 basis points. On a $50K/mo wholesale operation that's $2,400–$4,800 a year — for entering five extra fields per transaction.\n\nYour gateway can probably do this. Your processor probably hasn't enabled it.",
    hashtags: ["#b2b", "#wholesale", "#payments"],
    status: "draft",
  },
  {
    platform: "linkedin",
    pillar: "Industry",
    cluster: "E-Commerce",
    body: "E-commerce processing isn't \"set the gateway, walk away.\"\n\nThings nobody told you:\n- 3DS 2.0 shifts liability and can lower fraud rates\n- Network tokens improve approval rates 1–3%\n- Account updater services prevent recurring failures\n- Velocity limits + AVS tuning matter more than your gateway brand\n\nThe difference between a 91% and 96% approval rate on the same volume is real money.",
    hashtags: ["#ecommerce", "#payments", "#dtc"],
    status: "draft",
  },

  // Pillar 4: Compliance & Security
  {
    platform: "linkedin",
    pillar: "Compliance & Security",
    cluster: "PCI DSS Basics",
    body: "PCI compliance is not a one-time event. It's a yearly self-assessment + ongoing controls.\n\nMost small merchants qualify for SAQ A or SAQ A-EP — short forms, manageable scope.\n\nThe trap: skipping the SAQ and getting hit with the \"non-compliance\" fee ($19.95–$99/month) every month forever.\n\nFile it. Save it. Do it again next year.",
    hashtags: ["#pcidss", "#compliance", "#payments"],
    status: "draft",
  },
  {
    platform: "linkedin",
    pillar: "Compliance & Security",
    cluster: "EMV & Chip",
    body: "If you're still keying chip cards because the reader is finicky, every one of those transactions is downgraded.\n\nDowngrade math:\n- Card-present chip rate: ~1.5% + $0.10\n- Keyed: ~2.5% + $0.15 + downgrade fees\n\nOn $30K/mo with 15% keyed unnecessarily, that's about $360/mo. Fix the reader.",
    hashtags: ["#EMV", "#payments", "#smallbusiness"],
    status: "draft",
  },
  {
    platform: "linkedin",
    pillar: "Compliance & Security",
    cluster: "Chargebacks",
    body: "A chargeback isn't just a refund. It's a fee, a ratio hit, and (if it persists) MATCH list exposure.\n\nThree quick wins to reduce chargebacks:\n\n- Crystal-clear billing descriptors customers recognize\n- Receipt language that names your refund window\n- Save tracking numbers and signed delivery proof for 180 days\n\nMost chargebacks are preventable with operations, not lawyers.",
    hashtags: ["#chargebacks", "#payments", "#fraud"],
    status: "draft",
  },
  {
    platform: "linkedin",
    pillar: "Compliance & Security",
    cluster: "Fraud Tools",
    body: "Fraud tools that actually work for small merchants:\n\n- AVS match required on card-not-present\n- CVV present + matching\n- 3DS 2.0 on >$100 orders\n- Velocity limits per card and per IP\n- Network tokenization (your gateway probably supports it free)\n\nNone of these are exotic. Most processors leave them off by default.",
    hashtags: ["#fraud", "#payments", "#security"],
    status: "draft",
  },
  {
    platform: "linkedin",
    pillar: "Compliance & Security",
    cluster: "Data Storage",
    body: "If you store full PANs in your CRM, your spreadsheet, or a sticky note — you are out of PCI scope rules and one bad day from disaster.\n\nThe rule: never store PAN, expiration, CVV, or magstripe data outside a tokenized vault.\n\nUse your gateway's tokenization. Use a payment-page redirect for e-com. Card data should hit your environment for milliseconds and then live somewhere else, encrypted, by someone whose actual job is securing it.",
    hashtags: ["#payments", "#security", "#pcidss"],
    status: "draft",
  },
];

let didSeed = false;

export async function seedContentEngine() {
  if (didSeed) return;
  didSeed = true;

  // Sales Scripts KB articles
  await seedKnowledgeBaseScripts();

  // Authors
  for (const author of AUTHORS) {
    try {
      const existing = await storage.getContentAuthorBySlug(author.slug);
      if (!existing) {
        await storage.createContentAuthor(author);
        console.log(`[Seed:Content] Created author ${author.slug}`);
      }
    } catch (err: any) {
      console.error(`[Seed:Content] Author ${author.slug} failed:`, err.message);
    }
  }

  // LinkedIn drafts — only seed if no social posts exist (idempotent guard)
  try {
    const existing = await storage.listSocialPosts({ platform: "linkedin" });
    if (existing.length === 0) {
      for (const draft of LINKEDIN_DRAFTS) {
        try {
          await storage.createSocialPost(draft as any);
        } catch (err: any) {
          console.error("[Seed:Content] LinkedIn draft failed:", err.message);
        }
      }
      console.log(`[Seed:Content] Seeded ${LINKEDIN_DRAFTS.length} LinkedIn drafts`);
    }
  } catch (err: any) {
    console.error("[Seed:Content] LinkedIn seed failed:", err.message);
  }
}
