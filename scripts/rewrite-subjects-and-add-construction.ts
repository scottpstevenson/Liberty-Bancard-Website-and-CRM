/**
 * scripts/rewrite-subjects-and-add-construction.ts
 *
 * One-time migration that:
 * 1. Rewrites all email subject lines across all sequences to sound human and branded.
 * 2. Inserts "25. FL Construction — Vertical Playbook" (6-step playbook sequence).
 * 3. Inserts "SDR: Cold Outbound — Construction" (11-step cold outbound sequence).
 *
 * Usage:
 *   npx tsx scripts/rewrite-subjects-and-add-construction.ts
 */

import { pool } from "../server/db";
import { db } from "../server/db";
import { followUpSequences, sequenceSteps } from "../shared/schema";
import { eq, and } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// SUBJECT LINE REWRITE MAP
// Key: [sequenceName, stepOrder]  →  new subject
// Only email steps have subjects; call/sms/voicemail steps are ignored.
// ─────────────────────────────────────────────────────────────────────────────
const SUBJECT_MAP: Record<string, Record<number, string>> = {
  "1. Switch & Save — Statement Audit": {
    4: "Liberty Bancard × {{companyName}} — free statement review",
    5: "Hidden fees in your statement, {{firstName}}",
    8: "{{firstName}} — closing the file on {{companyName}}",
  },
  "2. Payment Stack 101 — Education": {
    1: "Liberty Bancard × {{companyName}} — the payment setup that actually matters",
    3: "The wrong setup costs more than a high rate, {{firstName}}",
  },
  "3. Fast Approval — Application Completion": {
    1: "{{firstName}}, your application is almost done",
    3: "One thing that slows approvals, {{firstName}}",
  },
  "4. Trust Builder — Authority Sequence": {
    1: "Liberty Bancard × {{companyName}} — how to spot a bad processing deal",
    3: "Rate baiting explained, {{firstName}}",
    5: "What triggers funding holds, {{firstName}}",
    6: "{{firstName}} — closing the file on {{companyName}}",
  },
  "5. Chargeback Defense": {
    1: "Liberty Bancard × {{companyName}} — chargeback protection",
    3: "5 chargeback levers you might be missing, {{firstName}}",
    4: "Friendly fraud is costing you, {{firstName}}",
    6: "{{firstName}} — closing the file on {{companyName}}",
  },
  "6. Funding Speed & Reliability": {
    1: "Liberty Bancard × {{companyName}} — what fast funding actually looks like",
    3: "Reserves and holds explained, {{firstName}}",
  },
  "7. POS vs Terminal — Decision Guide": {
    1: "Liberty Bancard × {{companyName}} — terminal vs. POS",
    3: "Right hardware vs. a low rate, {{firstName}}",
  },
  "8. Liberty Smart Terminal — Product Showcase": {
    1: "Liberty Bancard × {{companyName}} — the smart terminal",
    3: "{{firstName}}, setup takes one afternoon",
  },
  "9. Surcharge & Cash Discount — Compliance": {
    1: "Liberty Bancard × {{companyName}} — surcharge compliance",
    3: "Surcharge without the backlash, {{firstName}}",
  },
  "10. Retail Merchants — SDR Outbound + Drip": {
    1: "Liberty Bancard × {{companyName}} — lower your retail fees",
    3: "3 ways retail merchants overpay, {{firstName}}",
    5: "What we fixed for a store like yours, {{firstName}}",
    7: "{{firstName}} — closing the file on {{companyName}}",
  },
  "11. Auto Merchants — SDR Outbound + Drip": {
    1: "Liberty Bancard × {{companyName}} — lower your auto shop fees",
    3: "3 payment issues auto shops deal with, {{firstName}}",
    5: "Cleaner deposit flow for auto shops, {{firstName}}",
    7: "{{firstName}} — closing the file on {{companyName}}",
  },
  "12. Medical & Med Spa — SDR Outbound + Drip": {
    1: "Liberty Bancard × {{companyName}} — patient payment flow",
    3: "3 payment issues medical practices deal with, {{firstName}}",
    5: "Patient payment flow that protects your practice, {{firstName}}",
    7: "{{firstName}} — closing the file on {{companyName}}",
  },
  "13. Recurring Billing — Subscription Merchants": {
    1: "Liberty Bancard × {{companyName}} — fix your recurring billing",
    3: "Payment links for recurring merchants, {{firstName}}",
    5: "Subscription chargebacks explained, {{firstName}}",
  },
  "14. Text-to-Pay & Payment Links": {
    1: "Liberty Bancard × {{companyName}} — text-to-pay for your business",
    3: "Deposits and partials made simple, {{firstName}}",
  },
  "15. Omnichannel — Online + In-Person": {
    1: "Liberty Bancard × {{companyName}} — one unified payment system",
    3: "Online vs. in-store fraud rules, {{firstName}}",
    5: "One dashboard for all your channels, {{firstName}}",
  },
  "16. Security & PCI Compliance — Made Easy": {
    1: "Liberty Bancard × {{companyName}} — PCI made simple",
    3: "EMV, tokenization, encryption — what actually matters, {{firstName}}",
    5: "Your fraud prevention checklist, {{firstName}}",
  },
  "17. Contract Escape — Switch Help": {
    1: "Liberty Bancard × {{companyName}} — are you actually locked in?",
    3: "How to switch with zero downtime, {{firstName}}",
    5: "Export this before you switch, {{firstName}}",
  },
  "18. Objection Crusher — Overcome Hesitation": {
    1: 'Liberty Bancard × {{companyName}} — "your rate seems too low"',
    3: '{{firstName}}, "I don\'t want a contract" — we get it',
    5: "{{firstName}}, chargebacks — here's what actually helps",
    7: "{{firstName}}, our support model explained",
  },
  "19. Reactivation — Cold Lead Revival": {
    1: "Liberty Bancard × {{companyName}} — still with the same processor?",
    3: "New savings report for {{companyName}}, {{firstName}}",
    4: "What we'd change in your setup, {{firstName}}",
  },
  "20. Free Analysis Follow-Up": {
    4: "Liberty Bancard × {{companyName}} — your savings estimate is ready",
    5: "How businesses like yours are saving, {{firstName}}",
    8: "The right terminal for your business, {{firstName}}",
    9: "{{firstName}} — your estimate is about to expire",
  },
  "21. Referral Flywheel — Merchant to Merchant": {
    1: "Liberty Bancard × {{companyName}} — know someone who'd want this?",
    3: "{{firstName}}, a quick intro could pay off",
    5: "How our referral program works, {{firstName}}",
  },
  "Post-Call Review Follow-Up": {
    1: "Liberty Bancard × {{companyName}} — your savings breakdown",
    3: "{{firstName}}, quick question about your review",
  },
  "Proposal Follow-Up": {
    1: "Liberty Bancard × {{companyName}} — your proposal is ready",
    3: "{{firstName}}, had a chance to review the proposal?",
  },
  "No-Show Reschedule": {
    1: "{{firstName}}, let's find a better time",
  },
  "Long-Term Nurture": {
    1: "Liberty Bancard × {{companyName}} — still thinking about payments?",
    3: "{{firstName}}, a quick industry update",
    5: "{{firstName}} — closing the file for now",
  },
  "22. FL Auto Repair — Vertical Playbook": {
    1: "Liberty Bancard × {{companyName}} — lower your shop's card fees",
    3: "{{firstName}}, how a similar shop cut costs",
    5: "{{firstName}} — closing the file on {{companyName}}",
  },
  "23. FL Med Spa — Vertical Playbook": {
    1: "Liberty Bancard × {{companyName}} — membership & payment workflow",
    3: "{{firstName}}, how a similar med spa improved membership revenue",
    5: "{{firstName}} — closing the file on {{companyName}}",
  },
  "24. FL Medical/Dental — Vertical Playbook": {
    1: "Liberty Bancard × {{companyName}} — patient collections review",
    3: "{{firstName}}, how a similar practice improved collections",
    5: "{{firstName}} — closing the file on {{companyName}}",
  },
  "SDR: Cold Outbound — Auto Repair": {
    1: "Liberty Bancard × {{companyName}} — lower your shop's card fees",
    4: "{{firstName}}, how a similar shop saved $400/month",
    7: "FL surcharging for auto shops, {{firstName}}",
    10: "{{firstName}} — closing the file on {{companyName}}",
  },
  "SDR: Cold Outbound — Med Spa": {
    1: "Liberty Bancard × {{companyName}} — membership & payment flow",
    4: "{{firstName}}, how a similar spa improved membership revenue",
    7: "Deposit protection for no-shows, {{firstName}}",
    10: "{{firstName}} — closing the file on {{companyName}}",
  },
  "SDR: Cold Outbound — Dental": {
    1: "Liberty Bancard × {{companyName}} — patient payment flow",
    4: "{{firstName}}, how a similar dental practice improved collections",
    7: "Text-to-pay for patient balances, {{firstName}}",
    10: "{{firstName}} — closing the file on {{companyName}}",
  },
  "SDR: Reply Engaged": {
    1: "Liberty Bancard × {{companyName}} — next steps",
    5: "{{firstName}}, quick follow-up on your interest",
  },
  "SDR: Statement Chase": {
    1: "Liberty Bancard × {{companyName}} — upload for your free analysis",
    5: "{{firstName}}, your free analysis is waiting",
  },
  "SDR: Proposal Follow-Up": {
    1: "Liberty Bancard × {{companyName}} — your savings proposal",
    5: "{{firstName}}, did you see the processing analysis?",
  },
  "SDR: No-Show Recovery": {
    2: "{{firstName}}, let's find a better time",
    5: "{{firstName}} — one last try on your free review",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CONSTRUCTION PLAYBOOK SEQUENCE (6 steps)
// ─────────────────────────────────────────────────────────────────────────────
const CONSTRUCTION_PLAYBOOK = {
  name: "25. FL Construction — Vertical Playbook",
  description: "Florida construction vertical playbook: email + SMS + call targeting general contractors, remodelers, specialty trades, and roofing companies. Focuses on large job invoices, slow-pay clients, text-to-pay for field collection, surcharge on big tickets, and chargeback exposure on B2B jobs.",
  triggerType: "manual",
  triggerConfig: {
    category: "sdr_outbound",
    vertical: "fl_construction",
    region: "florida",
    channelMix: ["email", "sms", "call"],
  },
  totalSteps: 6,
  status: "active",
  steps: [
    {
      stepOrder: 1,
      actionType: "email",
      delayDays: 0,
      delayHours: 0,
      subject: "Liberty Bancard × {{companyName}} — lower your card fees on big jobs",
      body: "<p>Hi {{firstName}},</p><p>We work with Florida contractors and remodelers who run larger job invoices and get crushed on card processing fees — especially when customers pay big balances by credit card on a single transaction.</p><p>3 common issues we see at companies like {{companyName}}:</p><ul><li>High effective rate on large job invoices paid by credit card</li><li>No text-to-pay option for field collection or final draw payments</li><li>Chargeback exposure on B2B project work</li></ul><p>We help construction businesses set up text-to-pay, a cash discount or surcharge program for big tickets, and better B2B payment documentation to reduce dispute exposure.</p><p>Your estimated monthly volume ({{estimatedVolume}}) puts you in a range where a free 10-minute statement review usually uncovers $300–$700/month.</p><p><a href=\"https://api.leadconnectorhq.com/widget/bookings/libertybancard\" style=\"display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;\">Upload a Statement for Free Review</a></p><p>— Liberty Bancard</p><p style=\"font-size:11px;color:#888;\">Florida surcharging applies to credit only (not debit/prepaid), requires disclosure, signage, receipt language, and 30-day notice to acquirer per card brand rules. Florida contractors are licensed through the DBPR CILB. Eligibility, underwriting, card brand rules, and applicable laws apply.</p>",
    },
    {
      stepOrder: 2,
      actionType: "sms",
      delayDays: 0,
      delayHours: 2,
      body: "Hi {{firstName}}, this is {{agentName}} with Liberty Bancard. We help FL contractors cut card fees on big job invoices and collect in the field with text-to-pay. Worth a quick look? Reply YES or visit https://api.leadconnectorhq.com/widget/bookings/libertybancard\nFL surcharging: credit only, disclosure req'd.\n— Liberty Bancard",
    },
    {
      stepOrder: 3,
      actionType: "email",
      delayDays: 3,
      delayHours: 0,
      subject: "{{firstName}}, how a similar contractor cut costs",
      body: "<p>Hi {{firstName}},</p><p>A Florida general contractor similar to {{companyName}} came to us overpaying on processing — particularly on final draw payments and material-supply invoices charged by credit card.</p><p>After switching:</p><ul><li>Effective rate dropped significantly on large job tickets</li><li>Text-to-pay enabled for final draw and punch-list collections in the field</li><li>Cash discount program implemented for jobs over $2,000 — customers paid cash or check and the contractor kept the full amount</li><li>Chargeback documentation process improved, cutting disputes nearly in half</li></ul><p>Want to see what your numbers look like? Send us your latest statement for a free side-by-side comparison.</p><p><a href=\"https://api.leadconnectorhq.com/widget/bookings/libertybancard\" style=\"display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;\">Get a Free Comparison</a></p><p>— Liberty Bancard</p><p style=\"font-size:11px;color:#888;\">Florida surcharging applies to credit only (not debit/prepaid), requires disclosure, signage, receipt language, and 30-day notice to acquirer. Eligibility, underwriting, card brand rules, and applicable laws apply.</p>",
    },
    {
      stepOrder: 4,
      actionType: "sms",
      delayDays: 5,
      delayHours: 0,
      body: "Still interested in seeing if {{companyName}} is overpaying on card fees? Free 10-min review: https://api.leadconnectorhq.com/widget/bookings/libertybancard\nFL surcharging: credit only, disclosure req'd.\n— Liberty Bancard",
    },
    {
      stepOrder: 5,
      actionType: "email",
      delayDays: 7,
      delayHours: 0,
      subject: "{{firstName}} — closing the file on {{companyName}}",
      body: "<p>Hi {{firstName}},</p><p>Last note — our free merchant statement review for construction businesses covers:</p><ul><li>Your true effective rate on large job invoices (not the advertised rate)</li><li>Text-to-pay setup for field and final draw collections</li><li>Cash discount / surcharge compliance for big-ticket jobs</li><li>Financing options for material and labor-intensive projects</li><li>Chargeback exposure on B2B and commercial project payments</li></ul><p>No pressure. If your current setup is solid, we'll tell you.</p><p><a href=\"https://api.leadconnectorhq.com/widget/bookings/libertybancard\" style=\"display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;\">Free Statement Review</a></p><p>— Liberty Bancard</p><p style=\"font-size:11px;color:#888;\">Florida surcharging applies to credit only (not debit/prepaid), requires disclosure, signage, receipt language, and 30-day notice to acquirer per card brand rules. Florida contractors are licensed through DBPR CILB. Eligibility, underwriting, and applicable laws apply.</p>",
    },
    {
      stepOrder: 6,
      actionType: "call",
      delayDays: 1,
      delayHours: 0,
      config: {
        scriptType: "fl_construction_intro",
        opening: "Hi, this is {{agentName}} with Liberty Bancard. We work with Florida contractors on card processing costs — especially on larger job invoices and final draw payments. Who handles your merchant services?",
        qualifyingQuestions: [
          "Who is your current processor?",
          "What's your approximate monthly card volume?",
          "Are you collecting final draw or large job payments by card in the field?",
          "Are you currently using surcharging or cash discount on your projects?",
        ],
        valuePitch: "We specialize in helping Florida construction businesses lower their effective processing cost on large job invoices, set up text-to-pay for field collection, and reduce chargeback exposure on commercial project work.",
        close: "We do a free 10-minute statement review that usually finds $300-700/month in savings. Can I send you a link to upload your latest statement?",
        objectionHandlers: {
          happy_with_current: "Totally fair — most contractors we work with thought the same thing until they saw a line-by-line breakdown on a large invoice. Even if you don't switch, you'll know exactly what you're paying.",
          too_busy: "I understand completely. The review takes less than 10 minutes and we do all the analysis. I'll send a secure upload link and have results back within 24 hours.",
          under_contract: "No problem. Most contracts roll to month-to-month without the owner realizing it. We can check that for you in 2 minutes.",
          rates_are_fine: "Good to hear. But on big job invoices, the effective rate is often very different from the advertised rate — downgrades and junk fees are where most contractors get hit.",
        },
        complianceDisclosure: "This is {{agentName}} calling from Liberty Bancard. We're a payment processing company. This is a business solicitation call. Florida surcharging applies to credit only, requires disclosure, signage, receipt language, and 30-day notice to acquirer per card brand rules.",
      },
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// CONSTRUCTION COLD OUTBOUND SEQUENCE (11 steps)
// ─────────────────────────────────────────────────────────────────────────────
const CONSTRUCTION_COLD_OUTBOUND = {
  name: "SDR: Cold Outbound — Construction",
  description: "AI SDR cold outbound for FL construction. Conversion-optimized: email D0 → call+VM D1 → email D3 → call+VM D5 → email D7 → call+VM D10 → breakup D14.",
  triggerType: "manual",
  triggerConfig: {
    category: "sdr_cold_outbound",
    vertical: "Construction",
  },
  totalSteps: 11,
  status: "active",
  steps: [
    {
      stepOrder: 1,
      actionType: "email",
      delayDays: 0,
      delayHours: 0,
      subject: "Liberty Bancard × {{companyName}} — lower your card fees on big jobs",
      body: "<p>Hi {{firstName}},</p><p>We work with Florida contractors and remodelers on card processing costs — especially on large job invoices where credit card fees eat into margins.</p><p>3 things we typically find:</p><ul><li>Overpriced processing on high-ticket job payments</li><li>No text-to-pay for field or final draw collection</li><li>Chargeback exposure on B2B commercial work</li></ul><p>Free 10-minute statement review — usually uncovers $300-700/month.</p><p><a href=\"https://api.leadconnectorhq.com/widget/bookings/libertybancard\" style=\"display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;\">Get Your Free Review</a></p><p>— Scott, Liberty Bancard</p><p style=\"font-size:11px;color:#888;margin-top:24px;\">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>",
    },
    {
      stepOrder: 2,
      actionType: "call",
      delayDays: 1,
      delayHours: 0,
      config: {
        callMode: "cold_outbound",
        scriptType: "cold_construction_d1",
        voicemailScript: "Hi {{firstName}}, Scott here with Liberty Bancard. We help Florida contractors cut card processing fees on large job invoices — usually $300-700 a month. I'll send you an email, or give me a ring back. Talk soon!",
        opening: "Hi {{firstName}}, this is Scott with Liberty Bancard. We work with Florida construction companies to reduce card processing costs on large job invoices — do you have a couple minutes?",
        close: "Great — I can send you a link to upload your latest statement and we'll have a full savings breakdown in 24 hours.",
      },
    },
    {
      stepOrder: 3,
      actionType: "voicemail_drop",
      delayDays: 0,
      delayHours: 0,
      config: {
        voicemailScript: "Hi {{firstName}}, Scott here with Liberty Bancard. We help Florida contractors cut card processing fees on large job invoices — usually $300-700 a month. I'll send you an email, or give me a ring back. Talk soon!",
        ghlNote: "Upload this voicemail audio to GHL Voicemail Drops library. Add a Voicemail Drop node immediately after the Manual Call node in GHL workflow.",
      },
    },
    {
      stepOrder: 4,
      actionType: "email",
      delayDays: 2,
      delayHours: 0,
      subject: "{{firstName}}, how a similar contractor saved on processing",
      body: "<p>Hi {{firstName}},</p><p>A Florida construction company came to us overpaying on processing — particularly on large final draw payments made by credit card. After switching:</p><ul><li>Effective rate dropped significantly on high-ticket job invoices</li><li>Text-to-pay enabled for collecting final draws in the field</li><li>Cash discount implemented for jobs over $2,000</li><li>Chargeback documentation tightened, cutting disputes nearly in half</li></ul><p>Want to see what your numbers look like?</p><p><a href=\"https://api.leadconnectorhq.com/widget/bookings/libertybancard\" style=\"display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;\">Upload Your Statement</a></p><p>— Scott, Liberty Bancard</p><p style=\"font-size:11px;color:#888;margin-top:24px;\">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>",
    },
    {
      stepOrder: 5,
      actionType: "call",
      delayDays: 2,
      delayHours: 0,
      config: {
        callMode: "cold_outbound",
        scriptType: "cold_construction_d5",
        voicemailScript: "Hi {{firstName}}, Scott with Liberty Bancard again. Just following up — I sent you an email about reducing processing fees on your job invoices. Give me a ring back when you have a minute. Thanks!",
        opening: "Hi {{firstName}}, Scott from Liberty Bancard. Following up on the free statement review — did you get my email?",
        close: "I'll send the upload link right now. 24 hours and you'll know exactly where to save.",
      },
    },
    {
      stepOrder: 6,
      actionType: "voicemail_drop",
      delayDays: 0,
      delayHours: 0,
      config: {
        voicemailScript: "Hi {{firstName}}, Scott with Liberty Bancard again. Just following up — I sent you an email about reducing processing fees on your job invoices. Give me a ring back when you have a minute. Thanks!",
        ghlNote: "Upload this voicemail audio to GHL Voicemail Drops library. Add a Voicemail Drop node immediately after the Manual Call node in GHL workflow.",
      },
    },
    {
      stepOrder: 7,
      actionType: "email",
      delayDays: 2,
      delayHours: 0,
      subject: "FL surcharging for contractors, {{firstName}}",
      body: "<p>Hi {{firstName}},</p><p>Florida allows surcharging on credit cards (not debit). For contractors running large job invoices, this can eliminate processing costs entirely on credit transactions.</p><p>We set this up correctly — compliant signage, dual-pricing at the terminal or payment link, and zero compliance risk.</p><p>Worth 10 minutes to find out what you could save on your next big project?</p><p><a href=\"https://api.leadconnectorhq.com/widget/bookings/libertybancard\" style=\"display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;\">Book a Quick Call</a></p><p>— Scott, Liberty Bancard</p><p style=\"font-size:11px;color:#888;margin-top:24px;\">Florida surcharging: credit only, not debit/prepaid; requires disclosure, signage, receipt language, and 30-day acquirer notice. Eligibility, underwriting, card brand rules, and applicable laws apply.</p>",
    },
    {
      stepOrder: 8,
      actionType: "call",
      delayDays: 3,
      delayHours: 0,
      config: {
        callMode: "cold_outbound",
        scriptType: "cold_construction_d10",
        voicemailScript: "Hi {{firstName}}, this is Scott with Liberty Bancard — one more check-in about the free processing review. If the timing's not right, no worries. But if you want to see if you're overpaying on job invoices, just give me a ring or check your email. Thanks!",
        opening: "Hi {{firstName}}, Scott from Liberty Bancard. Last follow-up on the free statement review — is now a better time?",
        close: "I'll make it easy — 10 minutes and you'll know if switching makes sense. Can I send you the upload link?",
      },
    },
    {
      stepOrder: 9,
      actionType: "voicemail_drop",
      delayDays: 0,
      delayHours: 0,
      config: {
        voicemailScript: "Hi {{firstName}}, this is Scott with Liberty Bancard — one more check-in about the free processing review. If the timing's not right, no worries. But if you want to see if you're overpaying on job invoices, just give me a ring or check your email. Thanks!",
        ghlNote: "Upload this voicemail audio to GHL Voicemail Drops library. Add a Voicemail Drop node immediately after the Manual Call node in GHL workflow.",
      },
    },
    {
      stepOrder: 10,
      actionType: "email",
      delayDays: 4,
      delayHours: 0,
      subject: "{{firstName}} — closing the file on {{companyName}}",
      body: "<p>Hi {{firstName}},</p><p>I'll keep this short — this is my last outreach.</p><p>If you ever want a free review of your processing costs on job invoices, we're here. Most construction companies we work with save $300-700/month.</p><p>No pressure. If your setup is solid, we'll tell you that too.</p><p><a href=\"https://api.leadconnectorhq.com/widget/bookings/libertybancard\" style=\"display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;\">Book Anytime</a></p><p>— Scott, Liberty Bancard</p><p style=\"font-size:11px;color:#888;margin-top:24px;\">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>",
    },
    {
      stepOrder: 11,
      actionType: "sms",
      delayDays: 0,
      delayHours: 0,
      body: "{{firstName}}, last message from Liberty Bancard — no pressure at all. If you ever want that free review, I'm here: https://api.leadconnectorhq.com/widget/bookings/libertybancard — Scott",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("[Migration] Starting construction sequences + subject line rewrite...\n");

  let updatedSubjects = 0;
  let skippedSubjects = 0;

  // Step 1: Rewrite subject lines
  console.log("[Migration] Step 1: Rewriting email subject lines...");
  for (const [seqName, stepMap] of Object.entries(SUBJECT_MAP)) {
    const seqs = await db
      .select({ id: followUpSequences.id, name: followUpSequences.name })
      .from(followUpSequences)
      .where(eq(followUpSequences.name, seqName));

    if (seqs.length === 0) {
      console.log(`  [SKIP] Sequence not found: "${seqName}"`);
      skippedSubjects++;
      continue;
    }

    const seqId = seqs[0].id;
    for (const [stepOrderStr, newSubject] of Object.entries(stepMap)) {
      const stepOrder = parseInt(stepOrderStr, 10);
      const result = await db
        .update(sequenceSteps)
        .set({ subject: newSubject })
        .where(
          and(
            eq(sequenceSteps.sequenceId, seqId),
            eq(sequenceSteps.stepOrder, stepOrder)
          )
        );
      updatedSubjects++;
      console.log(`  [OK] "${seqName}" step ${stepOrder} → "${newSubject}"`);
    }
  }

  console.log(`\n[Migration] Subject lines: ${updatedSubjects} updated, ${skippedSubjects} sequences not found.\n`);

  // Step 2: Insert construction sequences if they don't exist
  console.log("[Migration] Step 2: Inserting construction sequences...");

  for (const seqDef of [CONSTRUCTION_PLAYBOOK, CONSTRUCTION_COLD_OUTBOUND]) {
    const existing = await db
      .select({ id: followUpSequences.id })
      .from(followUpSequences)
      .where(eq(followUpSequences.name, seqDef.name));

    if (existing.length > 0) {
      console.log(`  [SKIP] Sequence already exists: "${seqDef.name}"`);
      continue;
    }

    const [created] = await db
      .insert(followUpSequences)
      .values({
        name: seqDef.name,
        description: seqDef.description,
        triggerType: seqDef.triggerType,
        triggerConfig: seqDef.triggerConfig,
        totalSteps: seqDef.totalSteps,
        status: seqDef.status,
      })
      .returning({ id: followUpSequences.id });

    for (const step of seqDef.steps) {
      await db.insert(sequenceSteps).values({
        sequenceId: created.id,
        stepOrder: step.stepOrder,
        actionType: step.actionType,
        delayDays: step.delayDays,
        delayHours: step.delayHours,
        subject: (step as any).subject ?? null,
        body: (step as any).body ?? null,
        config: (step as any).config ?? null,
        templateId: null,
      });
    }

    console.log(`  [OK] Created "${seqDef.name}" (${seqDef.steps.length} steps, id=${created.id})`);
  }

  console.log("\n[Migration] Done.\n");
}

main()
  .catch((err) => {
    console.error("[Migration] Fatal error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
