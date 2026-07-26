/**
 * Task #1134 — Sequence Copy Rewrite: Snapshot + Claims Audit + Controlled Apply
 *
 * Workflow (mirrors the plan):
 *  1. Snapshot all targeted email steps → docs/copy-snapshots/
 *  2. Apply targeted claims fixes to active sequences (remove prohibited quantitative claims)
 *  3. Rewrite thin paused sequences (seq 2 "New Lead Drip", seq 3 "Statement Review")
 *  4. No CTA URLs changed, no delays changed, no sender routing changed
 *
 * Run with: npx tsx scripts/apply-sequence-copy.ts
 */

import { db } from "../server/db.js";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

// ── Helpers ──────────────────────────────────────────────────────────────────

const BTN = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:#1e3a5f;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;letter-spacing:0.3px">${label}</a>`;

const P = (text: string) =>
  `<p style="font-size:16px;line-height:1.7;color:#2d2d2d;margin:0 0 16px 0;">${text}</p>`;

const UL = (items: string[]) =>
  `<ul style="font-size:16px;line-height:1.7;color:#2d2d2d;padding-left:22px;margin:0 0 16px 0;">${items.map(i => `<li style="margin-bottom:6px;font-size:16px;">${i}</li>`).join("")}</ul>`;

const DISCLAIMER = `<p style="font-size:11px;color:#888;margin-top:24px;">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>`;

const WRAP = (inner: string) =>
  `<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;">${inner}</div>`;

const SIGN = `${P("— Liberty Bancard")}${DISCLAIMER}`;

// ── Proposed copy by step ID ──────────────────────────────────────────────────

const REWRITES: Record<number, { subject?: string; body: string }> = {

  // ════════════════════════════════════════════════════════════════════════
  // BATCH A — Transactional (seq 82: Inbound Confirmation — ACTIVE)
  //   Copy standard: clear, expected, no sales pressure
  // ════════════════════════════════════════════════════════════════════════

  19001: {
    subject: "We received your request — Liberty Bancard",
    body: WRAP(
      P("Hi {{firstName}},") +
      P("Thanks for reaching out — we got your information and someone from our team will follow up shortly.") +
      P("In the meantime, if you'd like to move faster, uploading a recent processing statement is the quickest way for us to give you a real comparison — not estimates.") +
      BTN("https://libertybancard.com/upload-statement", "Upload Your Statement") +
      SIGN
    ),
  },

  // ════════════════════════════════════════════════════════════════════════
  // THIN SEQUENCE REWRITES
  // Seq 2 (New Lead Drip Campaign) — steps 1, 3
  // Seq 3 (Statement Review Follow-up) — steps 1, 3
  // ════════════════════════════════════════════════════════════════════════

  // Seq 2, step 1 (ID 1)
  1: {
    subject: "Your request is in — here's what happens next",
    body: WRAP(
      P("Hi {{firstName}},") +
      P("Thanks for reaching out to Liberty Bancard — we received your information.") +
      P("Here's what to expect:") +
      UL([
        "If you uploaded a statement, we'll review it and send you a cost breakdown within one business day",
        "If you have questions, reply to this email — you'll hear back from a real person",
        "If you haven't uploaded a statement yet, it takes about two minutes below",
      ]) +
      P("Most merchants find their processing costs are higher than they need to be — not because their processor is dishonest, but because the pricing structure is designed to be difficult to read. We'll translate yours at no charge.") +
      BTN("https://libertybancard.com/upload-statement", "Upload Your Statement") +
      SIGN
    ),
  },

  // Seq 2, step 3 (ID 3)
  3: {
    subject: "One thing worth checking on your statement, {{firstName}}",
    body: WRAP(
      P("Hi {{firstName}},") +
      P("If you haven't uploaded your statement yet, here's what you'll get back when you do:") +
      UL([
        "Your current effective rate — what you're actually paying, all fees included",
        "The specific fee categories driving your cost up",
        "A comparison against interchange-plus pricing for your transaction type",
      ]) +
      P("No obligation to switch. We just think you should know the number.") +
      BTN("https://libertybancard.com/upload-statement", "Upload Statement — Takes 2 Minutes") +
      SIGN
    ),
  },

  // Seq 3, step 1 (ID 4)
  4: {
    subject: "Your statement review is ready, {{firstName}}",
    body: WRAP(
      P("Hi {{firstName}},") +
      P("We've finished reviewing {{companyName}}'s processing statement.") +
      P("Here's a summary of what we found:") +
      UL([
        "Your current effective rate and how it's structured",
        "The fee categories where your cost is highest relative to interchange",
        "A recommended pricing path for your transaction mix",
      ]) +
      P("Reply to this email or click below to walk through the numbers — it takes about 10 minutes.") +
      BTN("{{calendarLink}}", "Book a 10-Minute Review Call") +
      SIGN
    ),
  },

  // Seq 3, step 3 (ID 6)
  6: {
    subject: "Following up on your statement review, {{firstName}}",
    body: WRAP(
      P("Hi {{firstName}},") +
      P("Following up on the statement review we completed for {{companyName}}.") +
      P("We identified specific line items where your costs are higher than they need to be — and we want to make sure those findings reach you before they go stale.") +
      P("If you have 10 minutes this week, a quick call is the fastest way to walk through what we found.") +
      BTN("{{calendarLink}}", "Schedule 10 Minutes") +
      SIGN
    ),
  },

  // ════════════════════════════════════════════════════════════════════════
  // BATCH C — Claims fixes: active sequences with prohibited quantitative claims
  // Replace just the prohibited sentence/phrase; preserve everything else
  // ════════════════════════════════════════════════════════════════════════

  // V-Med Spa SDR step 1 (ID 15698) — remove "20-35%"
  15698: {
    body: WRAP(
      P("Hi {{firstName}},") +
      P("I work with med spas and aesthetic clinics across Florida that were overpaying on card processing before they switched to interchange-plus pricing.") +
      P("Med spas have a unique payment mix: high-ticket treatments like Botox and laser services, recurring membership payments, HSA/FSA cards, and sometimes financing programs. Generic processors bundle all of this into one flat rate.") +
      P("We structure pricing around your actual transaction mix — which can meaningfully reduce your monthly processing cost compared to flat-rate pricing.") +
      P("Worth a quick 10-minute call to see if {{companyName}} could be paying less?") +
      BTN("https://api.leadconnectorhq.com/widget/bookings/libertybancard", "Book a Free Analysis Call") +
      SIGN
    ),
  },

  // V-Med Spa SDR step 6 (ID 15703) — remove "client savings" claim
  15703: {
    body: WRAP(
      P("Hi {{firstName}},") +
      P("Last message from me — I don't want to keep filling your inbox.") +
      P("If {{companyName}} ever wants a free review of your processing costs — especially on memberships, HSA/FSA transactions, or high-ticket services — we're here.") +
      BTN("https://libertybancard.com/free-analysis", "Get My Free Analysis") +
      SIGN
    ),
  },

  // V-Auto Repair SDR step 6 (ID 15750) — remove "$200-$600/month" client savings claim
  15750: {
    body: WRAP(
      P("Hi {{firstName}},") +
      P("Last message from me. I'll leave you alone after this.") +
      P("If you ever want a free review of {{companyName}}'s processing costs — especially on fleet cards or large repair invoices — we're here. No pressure, no obligation.") +
      BTN("https://libertybancard.com/free-analysis", "Get My Free Analysis") +
      SIGN
    ),
  },

  // V-Construction SDR step 1 (ID 15868) — remove "20-35%" savings claim
  15868: {
    body: WRAP(
      P("Hi {{firstName}},") +
      P("General contractors and trade businesses have a specific problem with payment processing: large B2B transactions. When a client pays a $50,000 project invoice by business card, a flat 2.7% rate costs you $1,350 in fees alone.") +
      P("We help contractors structure their merchant accounts to capture commercial and purchasing card interchange rates — which are significantly lower for properly qualified B2B transactions. Combined with interchange-plus pricing, this can substantially reduce what you're paying on large invoices.") +
      P("Worth a quick call to see if {{companyName}} qualifies?") +
      BTN("https://api.leadconnectorhq.com/widget/bookings/libertybancard", "Book a Free Analysis") +
      SIGN
    ),
  },

  // V-Gym Account Mgmt step 3 (ID 15817) — remove "20-30% increase in add-on sales" claim
  15817: {
    body: WRAP(
      P("Hi {{firstName}},") +
      P("Beyond memberships, class packs, personal training sessions, retail supplements, and branded merchandise are significant revenue opportunities — but only if checkout is frictionless.") +
      P("Gyms that add text-to-pay for class packs and one-time purchases report that it meaningfully reduces checkout friction for add-on purchases compared to requiring card-present or cash payments.") +
      P("Want to explore what additional revenue tools might make sense for {{companyName}}?") +
      BTN("https://api.leadconnectorhq.com/widget/booking/kBRoNz5XoTpddupMQg0c", "Explore Revenue Tools") +
      SIGN
    ),
  },

  // V-Gym Inbound Nurture step 3 (ID 15806) — need to fix pct-range claim
  // (Will apply targeted replacement below since we need the full body)

  // V-Salon SDR step 1 (ID 15768) — remove savings % range claim
  // (Will apply targeted replacement below)

};

// ── Targeted body replacements (for steps where full body is mostly good) ────

interface Replacement {
  find: string | RegExp;
  replace: string;
}

const TARGETED_FIXES: Record<number, Replacement[]> = {
  // V-Retail SDR step 4 (ID 108, PAUSED) — remove "15-30%" and "No hidden fees"
  108: [
    {
      find: '<li style="margin-bottom:6px;font-size:16px;">Average savings: 15-30% on monthly processing costs</li>',
      replace: '<li style="margin-bottom:6px;font-size:16px;">Better pricing structure optimized for your actual card mix</li>',
    },
    {
      find: "No long-term contracts. No hidden fees. Just transparent pricing.",
      replace: "No long-term contracts. Transparent, interchange-plus pricing.",
    },
  ],

  // W6 Cold Outreach step 1 (ID 19010, PAUSED) — remove "10–30%"
  19010: [
    {
      find: /We help merchants find hidden fees in their processing statements — most find 10[–-]30% in unnecessary costs\. If you'd like a free, no-obligation review, reply or upload a recent statement\./,
      replace: "We help merchants find unnecessary fees in their processing statements. If you'd like a free, no-obligation review, reply or upload a recent statement.",
    },
  ],

  // 1. Switch & Save step 4 (ID 18908, PAUSED) — pct-range claim
  18908: [
    {
      find: /\d+[–-]\d+%/g,
      replace: "a meaningful amount",
    },
  ],

  // 4. Trust Builder step 1 (ID 20, PAUSED) — "guaranteed"
  20: [
    {
      find: /guaranteed/gi,
      replace: "expected",
    },
  ],

  // 20. Free Analysis Follow-Up step 8 (ID 18920, PAUSED) — "no hidden fees"
  18920: [
    {
      find: /[Nn]o hidden fees?\.?/g,
      replace: "transparent pricing.",
    },
  ],

  // SDR: Statement Chase step 5 (ID 18966, PAUSED) — pct-range
  18966: [
    {
      find: /\d+[–-]\d+%/g,
      replace: "a meaningful reduction",
    },
  ],

  // V-Medical SDR step 1 (ID 126, PAUSED) — "no hidden fees"
  126: [
    {
      find: /[Nn]o hidden fees?\.?/g,
      replace: "transparent pricing.",
    },
  ],

  // V-Medical Inbound Nurture step 1 (ID 131, PAUSED) — "no hidden fees"
  131: [
    {
      find: /[Nn]o hidden fees?\.?/g,
      replace: "transparent pricing.",
    },
  ],

  // V-Medical Account Mgmt step 1 (ID 134, PAUSED) — "no hidden fees"
  134: [
    {
      find: /[Nn]o hidden fees?\.?/g,
      replace: "transparent pricing.",
    },
  ],

  // Post-Call Review Follow-Up step 1 (ID 155) — "no hidden fees"
  155: [
    {
      find: /[Nn]o hidden fees?\.?/g,
      replace: "transparent pricing.",
    },
  ],

  // V-Gym Inbound Nurture step 3 (ID 15806, ACTIVE)
  15806: [
    {
      find: /\d+[–-]\d+%/g,
      replace: "a meaningful amount",
    },
  ],

  // V-Salon SDR step 1 (ID 15768, ACTIVE)
  15768: [
    {
      find: /save[ds]?\s+\d+[–-]\d+%[^<]*/gi,
      replace: "reduce processing costs",
    },
    {
      find: /\d+[–-]\d+%\s+(on|of|in)[^<]*/gi,
      replace: "a meaningful amount ",
    },
  ],
};

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Task #1134 — Sequence Copy Apply\n");

  // 1. Pull all targeted email steps
  const result = await db.execute(sql`
    SELECT ss.id, s.id as seq_id, s.name as seq_name, s.status,
      ss.step_order, ss.subject, ss.body, ss.variant_b_body
    FROM sequence_steps ss
    JOIN follow_up_sequences s ON s.id = ss.sequence_id
    WHERE ss.action_type = 'email'
      AND s.id NOT IN (101, 102, 103, 104, 242, 243, 244, 245, 246)
    ORDER BY s.id, ss.step_order
  `);
  const rows = result.rows as Array<{
    id: number;
    seq_id: number;
    seq_name: string;
    status: string;
    step_order: number;
    subject: string | null;
    body: string | null;
    variant_b_body: string | null;
  }>;

  console.log(`📦 Loaded ${rows.length} targeted email steps.\n`);

  // 2. Snapshot — write before any mutations
  const snapshotDir = "docs/copy-snapshots";
  fs.mkdirSync(snapshotDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotPath = path.join(snapshotDir, `batch-all-${ts}.json`);
  const snapshot = rows.map(r => ({
    stepId: r.id,
    seqId: r.seq_id,
    seqName: r.seq_name,
    status: r.status,
    stepOrder: r.step_order,
    subject: r.subject,
    body: r.body,
    variantBBody: r.variant_b_body,
  }));
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  console.log(`✅ Snapshot written → ${snapshotPath}\n`);

  // 3. Apply rewrites and targeted fixes
  let fullRewrites = 0;
  let targetedFixes = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      let newSubject = row.subject;
      let newBody = row.body;

      // Full rewrite takes precedence
      if (REWRITES[row.id]) {
        const rw = REWRITES[row.id];
        if (rw.subject !== undefined) newSubject = rw.subject;
        newBody = rw.body;
        fullRewrites++;
      } else if (TARGETED_FIXES[row.id] && row.body) {
        // Targeted replacement — only modify specific strings
        let patched = row.body;
        for (const fix of TARGETED_FIXES[row.id]) {
          patched = patched.replace(fix.find as any, fix.replace);
        }
        if (patched !== row.body) {
          newBody = patched;
          targetedFixes++;
        }
      }

      // Skip if nothing changed
      if (newSubject === row.subject && newBody === row.body) continue;

      await db.execute(sql`
        UPDATE sequence_steps
        SET subject = ${newSubject}, body = ${newBody}
        WHERE id = ${row.id}
      `);

      const tag = REWRITES[row.id] ? "[FULL REWRITE]" : "[CLAIMS FIX]";
      console.log(`  ${tag} Step ${row.id} | seq="${row.seq_name}" step=${row.step_order}`);
    } catch (err) {
      errors++;
      console.error(`  ✗ Step ${row.id} ERROR:`, (err as Error).message);
    }
  }

  console.log(`\n📊 Results:`);
  console.log(`   Full rewrites:   ${fullRewrites}`);
  console.log(`   Targeted fixes:  ${targetedFixes}`);
  console.log(`   Errors:          ${errors}`);

  // 4. Claims audit report — scan remaining flagged patterns
  console.log("\n🔍 Post-apply claims audit...");
  const claimsResult = await db.execute(sql`
    SELECT ss.id, s.name, ss.step_order, s.status,
      SUBSTRING(ss.body, 1, 200) as snippet
    FROM sequence_steps ss
    JOIN follow_up_sequences s ON s.id = ss.sequence_id
    WHERE ss.action_type = 'email'
      AND s.id NOT IN (101, 102, 103, 104, 242, 243, 244, 245, 246)
      AND (
        ss.body ~* 'save[ds]?\s+\d+[–\-]\d+%'
        OR ss.body ~* '\d+[–\-]\d+%\s+(on|of|in)'
        OR ss.body ~* 'no hidden fee'
        OR ss.body ~* 'lowest rate'
        OR ss.body ~* 'guaranteed'
        OR ss.body ~* 'client.{0,10}save[ds]?\s+\$'
      )
    ORDER BY s.status DESC, s.name, ss.step_order
  `);

  if (claimsResult.rows.length === 0) {
    console.log("   ✅ No prohibited claims found.\n");
  } else {
    console.log(`   ⚠️  ${claimsResult.rows.length} remaining flagged steps:`);
    for (const r of claimsResult.rows as any[]) {
      console.log(`      Step ${r.id} | ${r.name} step=${r.step_order} [${r.status}]`);
      console.log(`      ${r.snippet.slice(0, 100)}...\n`);
    }
  }

  if (errors > 0) {
    console.error("❌ Some steps failed. See errors above.");
    process.exit(1);
  }
  console.log("✅ Copy apply complete.");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
