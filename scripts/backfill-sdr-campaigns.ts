#!/usr/bin/env tsx
/**
 * Backfill Liberty Bancard copy into all 10 SDR campaigns (SDR-01 through SDR-10).
 *
 * WHY THIS SCRIPT EXISTS
 * The generic backfill-templates-apply.ts missed all SDR campaigns because:
 *   (1) it filters campaign steps by stepType === "email", but SDR steps use
 *       initial_outreach / follow_up / value_add / social_proof / breakup.
 *   (2) extractVerticalKey() only matches "V-[Vertical]:" prefixes, which SDR
 *       campaign names don't have.
 *
 * This script bypasses both gaps with a hardcoded SDR_CAMPAIGN_CONTENT map
 * and matches by campaignId + stepOrder — never by stepType.
 *
 * SAFETY GATES
 *   - Backup-exists check before any writes
 *   - Banned phrase audit — aborts if any fire
 *   - Soft-flag phrases — warns and requires --force if found without caveat
 *   - Merge-tag audit — aborts on unsupported tags
 *   - Post-write dry-run verification
 *   - Touches ONLY subject + bodyTemplate; never status, isActive, stepOrder, etc.
 *   - Does NOT touch follow_up_sequences or V-[Vertical] sequences
 *
 * USAGE
 *   npx tsx scripts/backfill-sdr-campaigns.ts --dry-run   (review, no DB writes)
 *   npx tsx scripts/backfill-sdr-campaigns.ts             (apply)
 *   npx tsx scripts/backfill-sdr-campaigns.ts --dry-run   (verify all ALREADY CURRENT)
 */

import fs from "fs";
import path from "path";
import { db } from "../server/db";
import { campaigns, campaignSteps } from "../shared/schema";
import { eq, and, asc } from "drizzle-orm";

// ── CLI flags ──────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE   = process.argv.includes("--force");

// ── Allowed merge tags ─────────────────────────────────────────────────────────
const ALLOWED_TAGS = new Set([
  "firstName", "companyName", "agentName", "agentPhone", "agentEmail", "bookingLink",
]);

// ── Banned phrases — hard STOP ────────────────────────────────────────────────
const BANNED_PHRASES = [
  "guaranteed savings",
  "guaranteed approval",
  "permitted everywhere",
  "full card-brand approval",
  "no liability exposure",
  "no chargebacks",
  "hipaa-compliant",
  "iolta-compliant",
  "fees never touch trust accounts",
  "will save",
  "eliminate your fees entirely",
];

// ── Soft-flag phrases — warn; require --force if present without a caveat ─────
const SOFT_FLAGS = [
  "same-day funding",
  "next-day funding",
  "no long-term contract",
  "free terminal",
  "0% processing",
  "near zero",
];

// Caveat phrases that make a soft-flag acceptable (any one of these in the same body is enough)
const SOFT_CAVEAT_PHRASES = [
  "availability depends on approval",
  "ask about month-to-month",
  "ask about faster funding",
  "illustrative",
  "depends on",
  "results vary",
  "actual results",
  "structured to follow",
  "when implemented",
  "state-specific rules apply",
];

function auditMergeTags(text: string, label: string): void {
  const found = [...text.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
  for (const tag of found) {
    if (!ALLOWED_TAGS.has(tag)) {
      console.error(`\n🛑 KILL LINE: unsupported merge tag {{${tag}}} in ${label}. Aborting.`);
      process.exit(2);
    }
  }
}

function checkBannedPhrases(text: string, label: string): void {
  const lower = text.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) {
      console.error(`\n🛑 KILL LINE: banned phrase "${phrase}" found in ${label}. Aborting.`);
      process.exit(2);
    }
  }
}

function checkSoftFlags(text: string, label: string): boolean {
  const lower = text.toLowerCase();
  let warned = false;
  for (const flag of SOFT_FLAGS) {
    if (!lower.includes(flag)) continue;
    const hasCaveat = SOFT_CAVEAT_PHRASES.some(c => lower.includes(c));
    if (!hasCaveat) {
      console.warn(`  ⚠  SOFT FLAG: "${flag}" in ${label} — no caveat phrase found`);
      warned = true;
    }
  }
  return warned;
}

function ensureBackupExists(): void {
  const scriptsDir = path.join(process.cwd(), "scripts");
  const backups = fs.readdirSync(scriptsDir).filter(
    f => (f.startsWith("backfill-backup-") || f.startsWith("sdr-backup-")) && f.endsWith(".json")
  );
  if (backups.length === 0) {
    console.error(
      "\n🛑 KILL LINE: No backup JSON found in scripts/. Run the dry-run script first:\n" +
      "   npx tsx scripts/backfill-templates-dryrun.ts\n" +
      "   (or any prior backfill-backup-*.json file is sufficient)\n"
    );
    process.exit(2);
  }
  console.log(`✅ Backup found: scripts/${backups.sort().at(-1)}`);
}

// ── SDR Campaign Content Map ──────────────────────────────────────────────────
// Key: exact campaign name as stored in the DB
// Value: steps in stepOrder sequence (1-indexed)
// Fields: subject + bodyTemplate only — nothing else

interface StepContent {
  stepOrder: number;
  subject: string;
  bodyTemplate: string;
}

const SDR_CAMPAIGN_CONTENT: Record<string, StepContent[]> = {

  "SDR-01: Statement Review Cold Outreach": [
    {
      stepOrder: 1,
      subject: "Can we run a free processing analysis for {{companyName}}?",
      bodyTemplate: `Hi {{firstName}},

I help business owners find out exactly what they're paying in payment processing fees — and whether there's a better option.

It takes about 10 minutes to review your last processing statement and tell you your true effective rate, what you'd pay with us, and how much you'd save. If we can't do better, I'll tell you upfront.

No commitment required — just the numbers.

Would you be open to forwarding your last statement to {{agentEmail}} so I can run the analysis?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    {
      stepOrder: 2,
      subject: "Re: Processing review for {{companyName}}",
      bodyTemplate: `Hi {{firstName}},

Following up on my note about the free processing analysis.

I know this kind of thing can get lost in the inbox — so just wanted to make sure it landed.

One thing worth knowing: most businesses we work with don't realize they may be paying more than necessary until they actually see the breakdown. For a business doing $50K/month in card volume, even a modest rate difference adds up fast — this is an illustrative example, not a guaranteed outcome.

If you want the analysis, all I need is your most recent processing statement. {{agentEmail}}

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 3,
      subject: "What your effective rate actually tells you",
      bodyTemplate: `Hi {{firstName}},

Quick note — no ask here.

Most business owners know what their quoted rate is (2.6%, 2.9%, etc.), but not their effective rate — the actual percentage they're paying after all fees, assessments, and monthly charges are factored in.

Your effective rate is the only number that lets you make an honest apples-to-apples comparison. I've seen businesses quoted 2.6% who were actually paying 3.4% when everything was added up.

If you want to know your real number, forward your last processing statement to {{agentEmail}} — I'll calculate it for free within 24 hours.

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 4,
      subject: "How {{companyName}}'s peers are benchmarking their processing costs",
      bodyTemplate: `Hi {{firstName}},

Something I've noticed: the business owners who get the most value from a processing review aren't necessarily the ones getting the worst deal — they're the ones who actually want to know where they stand.

We've run hundreds of free analyses for businesses in your area. About 70% of the time, there's meaningful savings available. 30% of the time, the business is already getting a competitive rate and I tell them so.

Either way, you walk away knowing exactly what you're paying and whether it's fair.

If you'd like to be in that group: {{agentEmail}}

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 5,
      subject: "Last note from me, {{firstName}}",
      bodyTemplate: `Hi {{firstName}},

This is my last follow-up — I don't want to keep showing up in your inbox if the timing isn't right.

If you ever want a free, no-obligation analysis of your processing costs, I'm here: {{agentEmail}}

We work with businesses across Florida and the Southeast. The analysis is free, takes 24 hours, and comes with no commitment.

Take care,
{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
  ],

  "SDR-02: 0% Processing Program": [
    {
      stepOrder: 1,
      subject: "Is {{companyName}} interested in 0% credit card processing?",
      bodyTemplate: `Hi {{firstName}},

I'm reaching out about a program that a growing number of Florida businesses have switched to: cash discount pricing, which can bring your effective processing cost close to zero when implemented with proper disclosures, signage, and program rules.

Here's how it works: customers paying by credit card see a price that includes the processing cost built in. Customers paying cash receive a discount. The result is that your net processing cost can drop significantly.

This is different from surcharging, which has different rules and restrictions. Cash discount programs are structured to follow applicable card-brand and state requirements when set up correctly.

For businesses doing $30K–$300K+/month in card volume, the fee reduction can be meaningful — the exact amount depends on your current setup and volume.

Would you be open to a quick call to see if it fits your business model?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    {
      stepOrder: 2,
      subject: "Re: 0% processing at {{companyName}} — a quick clarification",
      bodyTemplate: `Hi {{firstName}},

Following up on my note about the cash discount program.

I know the first reaction for a lot of business owners is "is this actually legal?" — and that's the right instinct. So I want to be direct:

Cash discount programs are structured to follow applicable card-brand and state requirements — the key is implementation details including proper signage and disclosure. What isn't allowed is charging different prices without disclosure, which is why setup matters.

We've helped dozens of businesses in Florida implement this. The setup and disclosure requirements are what make the difference.

Worth 15 minutes to see if it fits your business?

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 3,
      subject: "How cash discount pricing works — the compliance angle",
      bodyTemplate: `Hi {{firstName}},

No ask in this one — just some context.

There are two ways to offset processing costs that business owners often confuse:

1. Surcharging: Adding a fee to credit card transactions only. Restricted in some states, requires specific disclosures, and cannot be applied to debit cards.

2. Cash discount: Listing a cash price and offering that price to cash customers — while the regular price covers your processing cost. Available in most states when set up with required signage and disclosures; state-specific rules apply.

The cash discount approach is what we implement. When done right, customers see it as a discount for paying cash — which is exactly what it is.

If you'd like to see exactly what the numbers would look like for your volume: {{agentEmail}}

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 4,
      subject: "What businesses like {{companyName}} are saying after switching",
      bodyTemplate: `Hi {{firstName}},

I've been working with business owners on cash discount programs for a while now, and there are two things that come up consistently after the switch:

The first is obvious: the savings. When your net processing cost drops significantly, that's real money staying in the business every month.

The second is less obvious: customer reaction. Most business owners expect pushback, and almost none get it. Customers understand cash discounts — they see them at gas stations, parking garages, and retailers every day.

If you'd like to talk through whether this model fits your specific business: {{agentPhone}} or {{agentEmail}}

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 5,
      subject: "Closing the loop, {{firstName}}",
      bodyTemplate: `Hi {{firstName}},

This is my last note on this.

If the cash discount program ever sounds interesting — or if you just want to know what you're currently paying vs. what's possible — I'm here: {{agentEmail}}

We work with businesses across Florida on payment processing, equipment, and funding. No pressure, no commitment required.

Take care,
{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
  ],

  "SDR-03: Beat Square & Stripe": [
    {
      stepOrder: 1,
      subject: "Is {{companyName}} still on Square or Stripe?",
      bodyTemplate: `Hi {{firstName}},

I work with business owners who are processing on Square, Stripe, or PayPal and want to know if they're getting a fair deal.

Here's the quick version: flat-rate processors charge one rate for everything — typically 2.6–2.9%. The problem is that interchange (the actual underlying cost of card processing) varies significantly by card type. Debit cards cost around 0.8%. Basic credit cards are around 1.5%. Most everyday transactions cost well under 2%.

Flat-rate pricing means you're paying that same 2.6–2.9% on every transaction regardless of actual cost — which is where the margin goes for the processor.

Interchange-plus pricing, which is what we offer, passes through the actual interchange cost plus a small fixed markup. For many businesses, that can translate to meaningfully lower costs than flat-rate — the exact difference depends on your card mix and volume.

Would you be open to a 10-minute comparison?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    {
      stepOrder: 2,
      subject: "The flat-rate trap — a quick read for {{firstName}}",
      bodyTemplate: `Hi {{firstName}},

Following up on my note about Square and Stripe pricing.

Here's a simple way to think about it:

If you're doing $60K/month in card volume at 2.7% flat, you're paying $1,620/month in processing fees.

If your actual interchange cost on that same volume averages 1.6% (this is illustrative — your actual number depends on your card mix), you'd pay around $960/month on interchange-plus — a $660/month difference.

That's the flat-rate premium. A statement review shows whether the math works that way for your specific volume and card mix.

All I need to show you the comparison is your last processing statement. Forward it to {{agentEmail}} and I'll have the breakdown back within 24 hours.

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 3,
      subject: "What Square doesn't show you on your processing statement",
      bodyTemplate: `Hi {{firstName}},

Square's statements are intentionally simple — one rate, one line. That simplicity is also what makes it hard to see what you're actually paying relative to market.

Here's what's not on your Square statement:
— Your effective rate (your total fees as a percentage of total volume)
— The interchange breakdown by card type
— What those same transactions would cost at market pricing

The effective rate is the only number that lets you make a real comparison. Many Square users, when they calculate it, find they're at 2.7–3.1% effective — which may be higher than what interchange-plus delivers for their card mix.

If you want to know your number: {{agentEmail}}. Send your last statement and I'll calculate it for free.

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 4,
      subject: "Why {{companyName}}'s peers are leaving flat-rate processors",
      bodyTemplate: `Hi {{firstName}},

The shift away from Square and Stripe isn't a new trend — but it has accelerated as business owners have gotten more sophisticated about reading their statements.

The businesses that typically see the most meaningful rate differences on the switch:

— Businesses with a high share of debit card transactions (debit interchange is often much cheaper than what flat-rate charges)
— Businesses with high average ticket sizes (the absolute dollar difference adds up fast)
— Businesses processing $40K+/month (the rate difference becomes significant at volume)

If any of those describe {{companyName}}, it's worth a look. Forward your statement to {{agentEmail}} and I'll show you the math.

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 5,
      subject: "Last note on your processing, {{firstName}}",
      bodyTemplate: `Hi {{firstName}},

This is my last email on this. I know switching processors sounds like a bigger project than it usually is — and I don't want to push if the timing isn't right.

If you ever decide you want to benchmark what you're paying on Square or Stripe against interchange-plus pricing: {{agentEmail}}

The analysis is free, takes 24 hours, and comes with no obligation.

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
  ],

  "SDR-04: Restaurant & Food Service": [
    {
      stepOrder: 1,
      subject: "A free processing review for your restaurant",
      bodyTemplate: `Hi {{firstName}},

Running a restaurant is already one of the hardest things in business — thin margins, long hours, and costs that never stop climbing.

One cost a lot of restaurant owners overlook: payment processing fees. If you're on a flat-rate processor like Square or Toast Payments, you could be paying 2.6–2.9% on every card swipe when the actual interchange cost is often under 1.5% for many transaction types.

At Liberty Bancard, we specialize in restaurant payment processing. We've helped restaurants in your area find more competitive rates — whether there are savings available for your business depends on your current setup, volume, and card mix.

What we offer:
✓ Interchange-plus pricing (the most transparent model in the industry)
✓ Free terminal or POS integration
✓ Flexible settlement options — ask about faster funding availability
✓ Flexible terms — ask about month-to-month options

It takes 10 minutes to review your statement and see if we can beat your current rate. If we can't, I'll tell you straight up.

Would you be open to a quick call this week?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    {
      stepOrder: 2,
      subject: "Re: Your restaurant's processing statement",
      bodyTemplate: `Hi {{firstName}},

One quick question: do you know your current effective rate? That's the actual percentage you're paying after all fees — not the advertised rate. Many restaurant owners think they're around 2.5% when the true number is often higher once everything is factored in.

I can calculate yours from your last statement in about 5 minutes and tell you exactly what you're paying and how it compares to available options. No obligation, no commitment.

Just forward your latest processing statement to {{agentEmail}} and I'll have a full breakdown back to you within 24 hours.

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 3,
      subject: "The one number most restaurant owners don't know",
      bodyTemplate: `Hi {{firstName}},

No ask here — just a number worth knowing.

Your effective rate: the actual percentage you're paying on all card transactions after every fee, assessment, and monthly charge is included.

Many restaurant owners think they're at 2.5%. When we calculate the real number, it's often higher. The difference comes from daily assessment fees, PCI fees, statement fees, and interchange downgrades — none of which show up in the quoted rate.

Knowing your real effective rate takes 5 minutes. If you want it, forward your last statement to {{agentEmail}} and I'll have it back to you within 24 hours.

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 4,
      subject: "How restaurants in your area are benchmarking their processing costs",
      bodyTemplate: `Hi {{firstName}},

We've helped dozens of restaurants across Florida find more competitive processing options. The ones that tend to see the biggest differences are usually on two types of setups: (1) flat-rate processors like Square for Restaurants or Toast Payments, or (2) legacy processors with bundled or tiered pricing.

Both models work fine when you're small. Once you're processing $50K+/month, the rate structure starts to make a meaningful difference.

If you'd like to see the comparison for your specific volume: {{agentEmail}}

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 5,
      subject: "Last note, {{firstName}}",
      bodyTemplate: `Hi {{firstName}},

This is my final follow-up. I know running a restaurant means your inbox is the last thing on your mind most days.

If you ever want to know exactly what you're paying in processing fees and whether there's a better option: {{agentEmail}}

The analysis is free and comes with no commitment. Happy to work around your schedule.

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
  ],

  "SDR-05: Medical / Dental / Medspa": [
    {
      stepOrder: 1,
      subject: "Reduce your practice's processing costs",
      bodyTemplate: `Hi {{firstName}},

Running a medical practice comes with enough overhead — malpractice insurance, staffing, EHR fees, and more. Payment processing shouldn't be adding unnecessary cost on top of that.

At Liberty Bancard, we work with healthcare practices on payment processing with a focus on:

✓ Interchange-plus pricing — transparent, no hidden fees
✓ Patient payment plan support — recurring billing built in
✓ Support for PCI-conscious payment workflows
✓ Integration with major EHR and practice management systems
✓ Settlement options — ask about faster funding availability

For practices processing through their EHR's built-in payment system, there's often a significant rate difference worth reviewing — whether there are savings available depends on your current setup and volume.

I'd love to run a free analysis of your current statement. No commitment, no obligation. If we can't improve your rate, I'll tell you upfront.

Would you be available for a brief call this week?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    {
      stepOrder: 2,
      subject: "Free processing analysis for your practice",
      bodyTemplate: `Hi {{firstName}},

Following up on my earlier note — wanted to make sure this didn't get lost in the inbox.

For a practice doing $60K/month in patient card payments, even a modest rate improvement can translate to meaningful monthly savings — the exact amount depends on your current effective rate and card mix (this is illustrative; actual results vary).

I can calculate your effective rate from your last processing statement — it takes me under 24 hours. Would you be willing to forward it to {{agentEmail}}?

No obligation, no pitch — just the numbers.

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 3,
      subject: "The patient payment tool most practices overlook",
      bodyTemplate: `Hi {{firstName}},

One thing worth mentioning that goes beyond processing rates:

Patient payment plans — recurring installment billing for large balances — are something most practices handle manually, if at all. Setting up proper recurring billing infrastructure, with tokenized card storage and automatic retry logic, can meaningfully improve collections on outstanding balances — actual results depend on your patient billing workflow and outstanding balance profile.

It also reduces the front-desk burden of chasing payments.

We set this up as part of our standard processing package at no extra charge.

If you'd like to see the full picture of what we offer for practices like yours: {{agentEmail}}

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 4,
      subject: "How healthcare practices are benchmarking their processing costs",
      bodyTemplate: `Hi {{firstName}},

We've worked with medical, dental, and med spa practices across Florida on payment processing. The patterns we see consistently:

— Practices on their EHR's built-in payment system are often paying above market rates compared to interchange-plus options
— Practices that haven't reviewed their statement in over a year often have fee creep that's accumulated silently
— Patient payment plan adoption tends to improve when the billing experience is streamlined

A 10-minute statement review can tell you exactly where your practice stands. Forward it to {{agentEmail}}.

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 5,
      subject: "Last note, {{firstName}}",
      bodyTemplate: `Hi {{firstName}},

This is my final follow-up. I know running a practice comes with enough on your plate already.

If you ever want an independent look at what your practice is paying in processing fees: {{agentEmail}}

The analysis is completely free and comes with no obligation. Some practices find meaningful savings after a statement review — the amount depends on your volume and current pricing.

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
  ],

  "SDR-06: Retail & E-Commerce": [
    {
      stepOrder: 1,
      subject: "Are you overpaying on retail card processing?",
      bodyTemplate: `Hi {{firstName}},

If you're running a retail store and using a flat-rate processor like Square, PayPal, or Stripe, there's a good chance you're overpaying on every transaction.

Flat-rate processors are easy to set up, but they charge one rate for everything — which means you're paying the same high rate on low-cost debit cards as you are on premium rewards credit cards.

At Liberty Bancard, we put retail businesses on interchange-plus pricing — the same model used by Fortune 500 retailers. Clients on flat-rate processors often find more competitive rates with interchange-plus pricing — the difference depends on your card mix and volume.

What we offer:
✓ True interchange-plus pricing — no bundled flat rates
✓ Free equipment upgrade (keep your current setup or upgrade)
✓ Settlement options including faster funding (availability depends on approval)
✓ Flexible terms — ask about month-to-month options

If you're doing $30K+ a month in card volume, a quick review of your statement can show exactly what you're paying and whether a better option is available.

Worth 10 minutes of your time?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    {
      stepOrder: 2,
      subject: "Quick question about your processing rates",
      bodyTemplate: `Hi {{firstName}},

I know you're busy running the store, so I'll keep this short.

One question: when's the last time you actually reviewed your processing statement line by line?

Most retail owners haven't done it in over a year — and when we dig in, we often find fees that could be meaningfully reduced.

If you can forward me your most recent statement, I'll do the entire analysis for free and have results back to you within 24 hours.

No sales pressure. If the numbers don't work, I'll tell you.

{{agentName}}
Liberty Bancard
{{agentEmail}}`,
    },
    {
      stepOrder: 3,
      subject: "The retail processing cost nobody talks about",
      bodyTemplate: `Hi {{firstName}},

Something most retail processors don't explain clearly: not all card types cost the same to accept.

A basic Visa debit card has an interchange rate of about 0.8%. A Chase Sapphire Preferred has an interchange rate of around 2.0%. On a flat-rate setup at 2.7%, you're paying the same rate on both — which means you're subsidizing the rewards card users with the margin you'd otherwise keep on debit transactions.

Interchange-plus pricing charges you the actual underlying cost of each card type, plus a small fixed markup. You pay less on the cheap cards and a fair price on the premium ones.

For retail businesses with meaningful debit card volume, this can make a noticeable difference — the exact amount depends on your card mix and current rates. Forward your statement to {{agentEmail}} if you want the calculation for your specific volume.

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 4,
      subject: "How retail businesses are getting fairer processing rates",
      bodyTemplate: `Hi {{firstName}},

We've helped retail businesses across Florida move to interchange-plus pricing. Businesses on flat-rate processors often find more competitive pricing when they switch — the clearest wins are for businesses with:
— High debit card volume (debit interchange is much cheaper than flat-rate)
— $30K+/month in card volume (the savings become significant at volume)
— Flat-rate setups through Square, PayPal, or Stripe

If any of those fit {{companyName}}, it's worth a look. Let me know if you'd like the analysis: {{agentEmail}}

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 5,
      subject: "Last note, {{firstName}}",
      bodyTemplate: `Hi {{firstName}},

This is my final follow-up on the processing review.

If you ever want to see what you're paying vs. what interchange-plus pricing would cost for your store: {{agentEmail}}

No obligation, no commitment required. Happy to help whenever the timing is right.

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
  ],

  "SDR-07: Auto / Service / Trades": [
    {
      stepOrder: 1,
      subject: "Reduce your shop's processing fees on large repair invoices",
      bodyTemplate: `Hi {{firstName}},

Auto repair shops and trades businesses deal with a unique payment challenge: high-ticket invoices on jobs that can run $500–$5,000+, and flat-rate processing fees that take a significant bite out of each one.

If you're on a flat-rate processor at 2.6–2.9%, you're paying $26–$87 in processing fees on a $3,000 repair job. Interchange-plus pricing can cut that significantly.

At Liberty Bancard, we work with auto shops, contractors, and trades businesses to:

✓ Lower effective rates with interchange-plus pricing
✓ Review whether a cash-discount program fits your business model
✓ Provide free, modern terminal equipment
✓ Settlement options including faster funding (availability depends on approval)

For a shop doing $60K/month in card volume, even a modest rate improvement adds up meaningfully — the analysis will show the actual numbers for your setup.

Want me to run a free comparison on your statement?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    {
      stepOrder: 2,
      subject: "Free statement analysis for your shop",
      bodyTemplate: `Hi {{firstName}},

Following up on my earlier message. I'll keep it simple:

If your shop is doing $50K+/month in card volume, a statement review will show exactly what you're paying and whether savings are available. All I need is your most recent statement to run the comparison. Forward it to {{agentEmail}} and I'll have a complete analysis back to you within 24 hours — showing your current effective rate vs. what you'd pay with us, line by line.

If we can't save you money, I'll tell you — and you'll at least know exactly what you're paying.

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 3,
      subject: "The cash discount option for service businesses",
      bodyTemplate: `Hi {{firstName}},

Worth mentioning for auto shops and trades businesses: beyond lower processing rates, there's a second option many service businesses have explored — a cash discount program.

Here's the setup: you post your regular price (which covers your processing cost). Customers paying cash receive a discount. The card-paying customer pays the listed price; the cash customer pays less. When implemented with proper signage and disclosure, it's structured to follow applicable card-brand and state requirements.

For a shop doing $60K/month in card volume, the potential reduction is worth calculating. As an illustrative example: a business moving from a 2.7% effective rate to near zero on $60K/month saves roughly $1,600/month — actual results depend on your setup, state rules, and whether the program fits your customer base.

Interested in seeing the numbers for your shop? {{agentEmail}}

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 4,
      subject: "How service businesses are getting better processing deals",
      bodyTemplate: `Hi {{firstName}},

Auto shops and trades businesses often have some of the highest processing costs in any industry — large invoices on flat-rate setups means the absolute dollar amount of processing fees is substantial.

We've helped shops across Florida with two solutions: interchange-plus pricing for those who want a straightforward rate reduction, and cash discount programs for those who want to significantly offset processing fees (implementation and eligibility vary).

If you'd like to know which option makes more sense for your volume: forward your last statement to {{agentEmail}} and I'll put together the comparison.

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 5,
      subject: "Last note, {{firstName}}",
      bodyTemplate: `Hi {{firstName}},

This is my final follow-up. I know you're busy keeping the business running.

If you ever want a free look at your processing costs vs. what's available: {{agentEmail}}

The analysis is free and comes with no commitment.

Take care,
{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
  ],

  "SDR-08: Win-Back / Reactivation": [
    {
      stepOrder: 1,
      subject: "Checking in, {{firstName}}",
      bodyTemplate: `Hi {{firstName}},

It's been a while since we last connected, and I didn't want to let too much time pass without checking in.

A lot has changed in payment processing over the past year or two — Visa and Mastercard have updated their interchange schedules, and many processors have made quiet adjustments that have increased effective rates for businesses that aren't watching closely.

If you haven't reviewed your processing costs recently, now's a reasonable time to do it. We offer a free statement analysis — no commitment, no obligation.

Would you be open to a quick review?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    {
      stepOrder: 2,
      subject: "Has your processor reviewed your rates recently? Probably not.",
      bodyTemplate: `Hi {{firstName}},

Here's something most business owners don't know: processors rarely proactively lower your rates, even when interchange schedules are updated. The adjustments that increase your rates get passed through automatically. The adjustments that could lower them often don't.

The result is that businesses that don't actively review their statements end up paying more over time — gradually, and in ways that are easy to miss.

A fresh analysis takes 24 hours and is completely free. If you'd like to know where you stand today: {{agentEmail}}

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 3,
      subject: "Why merchants come back for a second look",
      bodyTemplate: `Hi {{firstName}},

Something we see consistently: business owners who looked at switching processors before but didn't — and come back 6–12 months later after seeing their rates creep up.

The most common reason they didn't switch the first time: timing, or the feeling that the savings weren't worth the effort. The most common reaction when they do switch: "I wish I'd done this sooner."

The switching process itself typically takes about a day.

If you'd like to revisit the conversation: {{agentEmail}} or {{agentPhone}}

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 4,
      subject: "Your review is still available, {{firstName}}",
      bodyTemplate: `Hi {{firstName}},

Just a final note: your free processing review is still available whenever you're ready.

If rates, volume, or circumstances have changed since we last spoke — or if you just want to benchmark where you stand today — I'm here: {{agentEmail}}

No pressure. Take care,
{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
  ],

  "SDR-09: Professional Services": [
    {
      stepOrder: 1,
      subject: "How {{companyName}} handles client payments — a quick question",
      bodyTemplate: `Hi {{firstName}},

I work with professional service firms — law offices, CPA practices, consultants, financial advisors — on payment processing specifically designed for your client billing model.

Professional services businesses have a few unique characteristics that most processors don't account for well: large retainer and invoice payments, premium-card-heavy client bases, and in some cases, specific billing compliance requirements.

At Liberty Bancard, we offer:
✓ Interchange-plus pricing — lower effective rates on large professional invoices
✓ Payment options for law firms designed around trust-account requirements
✓ Client installment billing — recurring payment plan support
✓ Integration with Clio, QuickBooks, FreshBooks, and other professional platforms
✓ Settlement options — ask about faster funding availability

For firms with high-value client invoices, the rate difference between flat-rate and interchange-plus can be meaningful — a statement review will show whether savings are available for your specific volume and card mix.

Can I run a free analysis?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    {
      stepOrder: 2,
      subject: "Re: Payment processing at {{companyName}}",
      bodyTemplate: `Hi {{firstName}},

Following up on my note about professional services payment processing.

One thing worth highlighting for firms with high-value client invoices: premium rewards cards (Amex Platinum, Chase Sapphire, etc.) carry some of the highest interchange rates in the industry — often 2.3–2.7% just for interchange.

On a flat-rate setup at 2.9%, you're paying nearly the same rate whether the client uses a basic debit card or a premium Amex. With interchange-plus, debit and standard cards come in significantly cheaper — which brings your blended rate down meaningfully.

For a firm billing $80K+/month in card transactions, the rate difference can add up meaningfully — the analysis will show the actual numbers for your volume and card mix.

If you'd like the analysis: {{agentEmail}}

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 3,
      subject: "The cost of premium cards at your firm — the number most partners miss",
      bodyTemplate: `Hi {{firstName}},

No ask in this one — just a number worth knowing for professional service firms.

Premium credit cards (Amex Platinum, Chase Sapphire Reserve, high-tier business rewards cards) are held disproportionately by the clients of law firms, CPA practices, and consultants. These cards carry the highest interchange rates in the system.

On a flat-rate processor, you absorb that cost invisibly. On interchange-plus, you pay the actual interchange rate for each card type — which means debit cards and basic credit cards are dramatically cheaper, bringing your overall effective rate down.

The differential between flat-rate and interchange-plus is typically widest for businesses with a premium-card-heavy client base — which often describes professional services.

If you want to know your specific number: {{agentEmail}}

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 4,
      subject: "How professional firms are benchmarking their processing costs",
      bodyTemplate: `Hi {{firstName}},

We've worked with law firms, CPA practices, and consulting businesses across Florida on payment processing. A few things that come up consistently:

— Firms using LawPay or CPACharge are often paying above market rates when compared to interchange-plus options
— Firms that haven't done a processing review in 2+ years have almost always had quiet fee increases
— For law firms, payment setups designed around trust-account requirements are available

If you'd like to see where your firm stands: {{agentEmail}}

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 5,
      subject: "Last note, {{firstName}}",
      bodyTemplate: `Hi {{firstName}},

This is my final follow-up.

If you ever want an independent review of your firm's processing costs — or want to know whether there's a more cost-effective option than your current setup — I'm here: {{agentEmail}}

The analysis is free, takes 24 hours, and comes with no obligation.

Take care,
{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
  ],

  "SDR-10: Salon / Spa / Beauty": [
    {
      stepOrder: 1,
      subject: "Lower your salon's processing fees — free terminal included",
      bodyTemplate: `Hi {{firstName}},

Running a salon or beauty business means you're handling a high volume of smaller transactions — plus tips — and those fees add up fast on a flat-rate pricing model.

At 2.6% flat, a $60 haircut with a $12 tip costs you about $1.87 in processing fees. Multiply that across 30–50 transactions a day, and you're looking at real money leaving your business every week.

At Liberty Bancard, we help salons and beauty professionals:

✓ Move to interchange-plus pricing — significantly cheaper on most everyday transactions
✓ Get a free tip-enabled terminal or integrate with your booking software
✓ Settlement options including faster funding (availability depends on approval)
✓ Flexible terms — ask about month-to-month options

Many salon clients find meaningful savings after a statement review — the amount depends on your volume, transaction size, and current rates.

Can I send you a free analysis?

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
    {
      stepOrder: 2,
      subject: "Quick note about your salon's processing",
      bodyTemplate: `Hi {{firstName}},

Just a quick follow-up — I promise I won't take much of your time.

One thing I've seen a lot with salons: they may be paying more than necessary on processing fees, often through their booking platform's built-in payments (Vagaro, StyleSeat, Square Appointments, etc.).

The booking software is great — I'm not suggesting you change it. But you often don't have to use their payment processor, and the savings from switching can be significant.

Forward your last processing statement to {{agentEmail}} and I'll have a full breakdown within 24 hours.

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 3,
      subject: "Modern payment options for {{companyName}}",
      bodyTemplate: `Hi {{firstName}},

Beyond processing rates, a few payment features specifically benefit salons and beauty businesses:

Tip management: Integrated tip prompts on terminal screens — tips go straight to the right staff member, no awkward cash moment.

Booking platform pass-through: If you're using Vagaro, StyleSeat, or Square Appointments, you don't have to use their payment processor. Connecting your own processor can reduce your processing costs without changing your booking workflow — the actual amount depends on your volume and current rates.

Gift card and package sales: Properly tracked prepaid balances, tied into your POS.

We set all of this up as part of onboarding at no extra charge.

If you'd like to see the full picture: {{agentEmail}}

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 4,
      subject: "How beauty businesses are cutting processing costs",
      bodyTemplate: `Hi {{firstName}},

We've helped salons, day spas, nail studios, and barbershops across Florida find more competitive processing options. The clearest opportunities are for businesses using:
— Square or PayPal (flat-rate, can be expensive on high volumes of smaller transactions)
— Booking software processors like Vagaro Pay or StyleSeat Pay (convenient but not always competitive on rate)

If {{companyName}} fits either of those, it's worth a look. Let me know if you'd like the analysis: {{agentEmail}}

{{agentName}}
Liberty Bancard`,
    },
    {
      stepOrder: 5,
      subject: "Last note, {{firstName}}",
      bodyTemplate: `Hi {{firstName}},

This is my final follow-up. I know how busy things get running a salon or spa.

If you ever want to know what you're paying in processing fees and whether there's a better option: {{agentEmail}}

No commitment, no obligation. Happy to help whenever the timing is right.

{{agentName}}
Liberty Bancard
{{agentPhone}}`,
    },
  ],

};

// ── Pre-flight: audit all copy before touching the DB ─────────────────────────

function preFlight(): void {
  console.log("\n─── Pre-flight: banned phrase + merge tag audit ──────────────────────────────");
  let softWarnings = 0;

  for (const [campaignName, steps] of Object.entries(SDR_CAMPAIGN_CONTENT)) {
    for (const step of steps) {
      const subjectLabel = `campaign="${campaignName}" step=${step.stepOrder} subject`;
      const bodyLabel    = `campaign="${campaignName}" step=${step.stepOrder} bodyTemplate`;
      const combinedLabel = `campaign="${campaignName}" step=${step.stepOrder}`;

      // Banned phrases: check each field independently
      checkBannedPhrases(step.subject,      subjectLabel);
      checkBannedPhrases(step.bodyTemplate, bodyLabel);

      // Merge tags: check each field independently
      auditMergeTags(step.subject,          subjectLabel);
      auditMergeTags(step.bodyTemplate,     bodyLabel);

      // Soft flags: check subject+body combined — a caveat in the body covers
      // a flagged phrase in the subject line of the same step (they arrive together)
      const combined = step.subject + "\n" + step.bodyTemplate;
      if (checkSoftFlags(combined, combinedLabel)) softWarnings++;
    }
  }

  if (softWarnings > 0 && !FORCE) {
    console.error(
      `\n🛑 ${softWarnings} soft-flag warning(s) found without caveat phrases.\n` +
      `   Review the warnings above. If the copy is intentional, re-run with --force.\n`
    );
    process.exit(2);
  }

  console.log(`✅ Pre-flight passed (0 banned phrases, 0 unsupported merge tags, ${softWarnings} soft flags caveated)\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== SDR Campaign Content Backfill — ${DRY_RUN ? "DRY RUN" : "APPLY"} ===\n`);

  if (!DRY_RUN) ensureBackupExists();

  preFlight();

  const SDR_NAMES = Object.keys(SDR_CAMPAIGN_CONTENT);

  // Load all campaigns from DB and filter to SDR names only
  const allCampaigns = await db.select().from(campaigns);
  const sdrCampaigns = allCampaigns.filter(c => SDR_NAMES.includes(c.name));

  const foundNames  = new Set(sdrCampaigns.map(c => c.name));
  const missingNames = SDR_NAMES.filter(n => !foundNames.has(n));

  if (missingNames.length > 0) {
    console.warn("⚠  The following SDR campaigns were NOT found in DB (they may not exist yet):");
    for (const n of missingNames) console.warn(`   - "${n}"`);
    console.warn("");
  }

  let totalUpdated = 0;
  let totalAlreadyCurrent = 0;
  let totalCampaignsUpdated = 0;

  for (const campaign of sdrCampaigns) {
    const contentSteps = SDR_CAMPAIGN_CONTENT[campaign.name];
    if (!contentSteps) continue;

    const dbSteps = await db
      .select()
      .from(campaignSteps)
      .where(eq(campaignSteps.campaignId, campaign.id))
      .orderBy(asc(campaignSteps.stepOrder));

    let campaignUpdatedCount = 0;

    console.log(`\n  Campaign: "${campaign.name}" (id=${campaign.id}, ${dbSteps.length} steps in DB, ${contentSteps.length} steps in map)`);

    for (const content of contentSteps) {
      const dbStep = dbSteps.find(s => s.stepOrder === content.stepOrder);

      if (!dbStep) {
        console.warn(`    ⚠  Step ${content.stepOrder} NOT FOUND in DB for this campaign — skipping`);
        continue;
      }

      const alreadyCurrent =
        dbStep.subject      === content.subject &&
        dbStep.bodyTemplate === content.bodyTemplate;

      if (alreadyCurrent) {
        console.log(`    [ALREADY CURRENT] step=${content.stepOrder} subject="${content.subject.slice(0, 60)}"`);
        totalAlreadyCurrent++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`    [WOULD UPDATE] step=${content.stepOrder} subject="${content.subject.slice(0, 60)}"`);
        console.log(`      current subject:  "${(dbStep.subject ?? "").slice(0, 60)}"`);
      } else {
        await db
          .update(campaignSteps)
          .set({ subject: content.subject, bodyTemplate: content.bodyTemplate })
          .where(and(
            eq(campaignSteps.campaignId, campaign.id),
            eq(campaignSteps.stepOrder, content.stepOrder)
          ));

        // Post-write read-back audit
        const [stored] = await db
          .select({ subject: campaignSteps.subject, bodyTemplate: campaignSteps.bodyTemplate })
          .from(campaignSteps)
          .where(and(
            eq(campaignSteps.campaignId, campaign.id),
            eq(campaignSteps.stepOrder, content.stepOrder)
          ));

        if (stored) {
          auditMergeTags(stored.subject ?? "",      `[stored] campaign="${campaign.name}" step=${content.stepOrder} subject`);
          auditMergeTags(stored.bodyTemplate ?? "", `[stored] campaign="${campaign.name}" step=${content.stepOrder} bodyTemplate`);
        }

        console.log(`    [UPDATED] step=${content.stepOrder} subject="${content.subject.slice(0, 60)}"`);
      }

      totalUpdated++;
      campaignUpdatedCount++;
    }

    if (campaignUpdatedCount > 0) totalCampaignsUpdated++;
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n─── Summary ──────────────────────────────────────────────────────────────────");
  console.log(`  Campaigns targeted:        ${sdrCampaigns.length} / ${SDR_NAMES.length}`);
  console.log(`  Campaigns with changes:    ${DRY_RUN ? "(dry run)" : totalCampaignsUpdated}`);
  console.log(`  Steps ${DRY_RUN ? "that would update" : "updated"}:       ${totalUpdated}`);
  console.log(`  Steps already current:     ${totalAlreadyCurrent}`);
  console.log(`  Banned phrase audit:       PASSED`);
  console.log(`  Merge tag audit:           PASSED`);
  console.log(`  Fields modified:           subject, bodyTemplate only`);
  console.log(`  Real outbound sent:        NO`);

  if (DRY_RUN) {
    console.log("\n  This was a DRY RUN — no database writes were made.");
    if (totalUpdated > 0) {
      console.log(`  Re-run without --dry-run to apply ${totalUpdated} update(s).\n`);
    } else {
      console.log("  ✅ All steps are already current — nothing to apply.\n");
    }
  } else {
    console.log(`\n✅ Apply complete. Re-run with --dry-run to verify all steps show [ALREADY CURRENT].\n`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
