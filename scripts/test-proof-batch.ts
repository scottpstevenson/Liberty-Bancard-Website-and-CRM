/**
 * scripts/test-proof-batch.ts
 * Sends 4 test emails to scott@libertybancard.com ONLY.
 * Bypasses global pause (direct GHL call, not sequence worker).
 * No prospects, no SMS, no enrollments.
 */
import { sendGhlEmail } from "../server/services/ghl";
import { getEmailSignatureHtml } from "../server/services/email-signatures";

const SCOTT_CONTACT_ID = 156106;

const PROOFS = [
  {
    label:     "Cold Outreach / Sales",
    fromEmail: "Scott@mail.libertybancard.com",
    fromName:  "Scott Stevenson",
    sigType:   "sales" as const,
    subject:   "[TEST PROOF 1/4] Cold Outreach sender — Scott@mail.libertybancard.com",
  },
  {
    label:     "Support",
    fromEmail: "support@libertybancard.com",
    fromName:  "Liberty Bancard Support",
    sigType:   "support" as const,
    subject:   "[TEST PROOF 2/4] Support sender — support@libertybancard.com",
  },
  {
    label:     "Onboarding",
    fromEmail: "onboarding@libertybancard.com",
    fromName:  "Liberty Bancard Onboarding",
    sigType:   "onboarding" as const,
    subject:   "[TEST PROOF 3/4] Onboarding sender — onboarding@libertybancard.com",
  },
  {
    label:     "Accounts",
    fromEmail: "accounts@libertybancard.com",
    fromName:  "Liberty Bancard Accounts",
    sigType:   "accounts" as const,
    subject:   "[TEST PROOF 4/4] Accounts sender — accounts@libertybancard.com",
  },
];

async function run() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log(  "║  PROOF BATCH — 4 internal test emails to scott@lb.com   ║");
  console.log(  "║  Global pause: untouched (TRUE). No prospects. No SMS.  ║");
  console.log(  "╚══════════════════════════════════════════════════════════╝\n");

  let sent = 0, failed = 0;

  for (const p of PROOFS) {
    const sig  = getEmailSignatureHtml(p.sigType);
    const body = `
<div style="background:#e8f4fd;border:2px solid #1a56db;border-radius:6px;padding:14px 18px;margin-bottom:20px;font-family:Arial,sans-serif;font-size:13px;color:#1e3a5f;">
  <strong>⚠ INTERNAL TEST EMAIL — copy review only</strong><br/>
  <strong>Label:</strong> ${p.label}<br/>
  <strong>From (production):</strong> ${p.fromEmail}<br/>
  <strong>Reply-To (production):</strong> ${p.fromEmail}<br/>
  <em style="font-size:11px;">Global outbound pause remains TRUE. This was sent via direct GHL call, not the sequence worker.</em>
</div>
<p style="font-family:Arial,sans-serif;font-size:14px;">
  This is proof email <strong>${p.subject.match(/\d\/4/)?.[0] ?? ""}</strong>.<br/><br/>
  If you can see this, the <strong>${p.label}</strong> sender channel is working correctly
  and future sequence emails from <code>${p.fromEmail}</code> will reach your inbox.
</p>
${sig}`;

    process.stdout.write(`  ${p.label.padEnd(28)} → `);
    try {
      const result = await sendGhlEmail({
        contactId:        SCOTT_CONTACT_ID,
        subject:          p.subject,
        body,
        fromEmail:        p.fromEmail,
        fromName:         p.fromName,
        skipActivityLog:  false,
      });
      if (result.success) {
        console.log(`✅ sent  | msgId: ${result.messageId ?? "—"}`);
        sent++;
      } else {
        console.log(`❌ blocked | ${result.error}`);
        failed++;
      }
    } catch (err: any) {
      console.log(`❌ error   | ${err.message}`);
      failed++;
    }

    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`\n  Sent: ${sent}  |  Failed: ${failed}`);
  console.log("  outboundGlobalPaused: NOT changed (remains TRUE)");
  console.log("  Prospects messaged: 0  |  SMS sent: 0\n");
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error("[FATAL]", err); process.exit(1); });
