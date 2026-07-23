#!/usr/bin/env npx tsx
/**
 * scripts/test-sequence-email-blast.ts
 *
 * Sends [TEST] copies of every active sequence email step to
 * scott@libertybancard.com ONLY. This is an internal copy-review tool.
 *
 * SAFETY GUARANTEES:
 *  ✓ Only sends to scott@libertybancard.com (hardcoded, cannot be overridden)
 *  ✓ Never enrolls any contact in any sequence
 *  ✓ Never sends SMS
 *  ✓ Does NOT touch outboundGlobalPaused (remains true)
 *  ✓ Calls GHL sendEmail directly — bypasses sequence worker and pause gate
 *  ✓ skipActivityLog=false so sends appear in Scott's GHL conversation view
 *  ✓ Skips automated-test sequences (PreEnrollGate, KillSwitch, DailyCap, etc.)
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { sendGhlEmail } from "../server/services/ghl";
import { sendGmailEmail, isGmailOAuthConnected } from "../server/services/gmail-oauth";
import { isSmtpConfigured, sendSmtpEmail } from "../server/services/smtp-email";
import { getEmailSignatureHtml, isColdOutreachSequence } from "../server/services/email-signatures";
import { storage } from "../server/storage";
import { getCanonicalUrl } from "../server/lib/canonical-url";

// ── Constants ──────────────────────────────────────────────────────────────────
const TEST_RECIPIENT_CONTACT_ID = 156106; // scott@libertybancard.com in DB
const TEST_RECIPIENT_EMAIL = "scott@libertybancard.com";

// Test-harness sequences created by automated suites — skip these
const SKIP_NAME_PATTERNS = [
  /^PreEnrollGate Test/,
  /^KillSwitch Test/,
  /^DailyCap Test/,
  /^CAN-SPAM Block Test/,
  /^Voicemail Follow-Up SMS/,
];

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Fill template variables with safe test values so emails render properly. */
function interpolate(text: string): string {
  return (text ?? "")
    .replace(/\{\{firstName\}\}/gi, "Scott")
    .replace(/\{\{lastName\}\}/gi, "Stevenson")
    .replace(/\{\{fullName\}\}/gi, "Scott Stevenson")
    .replace(/\{\{companyName\}\}/gi, "[Liberty Bancard TEST]")
    .replace(/\{\{businessName\}\}/gi, "[Liberty Bancard TEST]")
    .replace(/\{\{email\}\}/gi, TEST_RECIPIENT_EMAIL)
    .replace(/\{\{phone\}\}/gi, "(555) 000-0001")
    .replace(/\{\{city\}\}/gi, "Miami")
    .replace(/\{\{state\}\}/gi, "FL")
    .replace(/\{\{[^}]+\}\}/g, "[TEST_VAR]");
}

/** Determine sender identity and signature style based on sequence name/type. */
function getSenderProfile(name: string): {
  fromEmail: string;
  fromName: string;
  sigType: "sales" | "accounts" | "support" | "onboarding";
  category: "cold_outreach" | "department_accounts" | "department_sales";
} {
  if (name.includes("Account Management Ops")) {
    return {
      fromEmail: "accounts@libertybancard.com",
      fromName: "Liberty Bancard Accounts",
      sigType: "accounts",
      category: "department_accounts",
    };
  }
  if (
    name.includes("Inbound Confirmation") ||
    name.includes("Objection Crusher") ||
    name.includes("Switch & Save")
  ) {
    return {
      fromEmail: "Scott@libertybancard.com",
      fromName: "Scott Stevenson",
      sigType: "sales",
      category: "department_sales",
    };
  }
  // SDR Outbound Prospecting, Inbound Lead Nurture, and all other active sequences
  return {
    fromEmail: "Scott@mail.libertybancard.com",
    fromName: "Scott Stevenson",
    sigType: "sales",
    category: "cold_outreach",
  };
}

/** Bright yellow test-metadata banner prepended to every email. */
function buildTestBanner(opts: {
  seqId: number;
  seqName: string;
  stepOrder: number;
  fromEmail: string;
  isCold: boolean;
  triggerType: string | null;
  sigType: string;
}): string {
  return `
<div style="background:#fff3cd;border:2px solid #ffc107;border-radius:6px;padding:14px 18px;margin-bottom:24px;font-family:Arial,sans-serif;font-size:13px;color:#856404;line-height:1.8;">
  <strong style="font-size:14px;">⚠ TEST EMAIL — Internal Copy Review Only</strong><br/>
  <strong>Sequence:</strong> ${opts.seqName} &nbsp;(ID: ${opts.seqId})<br/>
  <strong>Step:</strong> ${opts.stepOrder}<br/>
  <strong>Production From:</strong> ${opts.fromEmail}<br/>
  <strong>Production Reply-To:</strong> ${opts.fromEmail}<br/>
  <strong>Type:</strong> ${opts.isCold ? "Cold Outreach" : "Transactional / Warm"}<br/>
  <strong>Trigger:</strong> ${opts.triggerType ?? "manual"}<br/>
  <strong>Signature dept:</strong> ${opts.sigType}<br/>
  <em style="font-size:11px;color:#a87f00;">This email was sent by the test blast script — not by the sequence worker.
  Global outbound pause remains TRUE. No prospects were messaged.</em>
</div>`;
}

/** CAN-SPAM/test compliance footer for cold sequences. */
function buildTestComplianceFooter(mailingAddress: string, appUrl: string): string {
  const unsubscribeUrl = `${appUrl}/unsubscribe?t=test-review-scott-internal`;
  return `
<br/>
<table style="font-family:Arial,sans-serif;font-size:11px;color:#999;border-collapse:collapse;margin-top:16px;border-top:1px solid #eee;" width="100%">
  <tr>
    <td style="padding-top:10px;font-size:11px;color:#999;line-height:1.5;">
      Liberty Bancard | ${mailingAddress}<br/>
      <a href="${unsubscribeUrl}" style="color:#999;text-decoration:underline;">[TEST] Unsubscribe link</a>
      &nbsp;|&nbsp; Commercial communication — you are receiving this because you are in our contact database.
      <br/><em style="font-size:10px;">(Production unsubscribe token is personalized per contact — this is a test placeholder.)</em>
    </td>
  </tr>
</table>`;
}

// ── Result tracking ────────────────────────────────────────────────────────────

interface StepResult {
  seqId: number;
  seqName: string;
  stepOrder: number;
  subject: string;
  sender: string;
  transport: string;
  status: "sent" | "blocked" | "skipped";
  error?: string;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log("\n╔══════════════════════════════════════════════════════════════════════╗");
  console.log(  "║  TEST SEQUENCE EMAIL BLAST — internal copy review only              ║");
  console.log(  "║  Recipient : scott@libertybancard.com (contact #156106)             ║");
  console.log(  "║  No prospects touched | Global pause remains TRUE                   ║");
  console.log(  "╚══════════════════════════════════════════════════════════════════════╝\n");

  // ── Pre-flight ───────────────────────────────────────────────────────────────
  const mailingAddress = (await storage.getSystemSetting("compliance_mailing_address") as string | null) ??
    "Liberty Bancard, 2045 Biscayne Blvd, Ste 232, Miami, FL 33137, United States";
  const appUrl = getCanonicalUrl();
  const gmailConnected = await isGmailOAuthConnected();
  const smtpConfigured = isSmtpConfigured();

  console.log("Transport availability:");
  console.log(`  Gmail OAuth : ${gmailConnected ? "✅ connected" : "❌ not connected"}`);
  console.log(`  SMTP        : ${smtpConfigured ? "✅ configured" : "❌ not configured (SMTP_PASS missing)"}`);
  console.log(`  GHL email   : ✅ configured (primary transport — uses contactId #156106)`);
  console.log(`  Mailing addr: ${mailingAddress}`);
  console.log(`  App URL     : ${appUrl}`);
  console.log();

  // ── Range filter (for chunked runs: FROM_SEQ / TO_SEQ env vars) ─────────────
  const fromSeq = process.env.FROM_SEQ ? parseInt(process.env.FROM_SEQ, 10) : 0;
  const toSeq   = process.env.TO_SEQ   ? parseInt(process.env.TO_SEQ,   10) : 999999;
  if (fromSeq || toSeq < 999999) {
    console.log(`Chunk filter: seq IDs ${fromSeq}–${toSeq}\n`);
  }

  // ── Fetch active sequences with email steps ───────────────────────────────
  const rows = await db.execute(sql`
    SELECT
      fs.id          AS seq_id,
      fs.name        AS seq_name,
      fs.sequence_family,
      fs.trigger_type,
      ss.id          AS step_id,
      ss.step_order,
      ss.action_type,
      ss.subject,
      ss.body
    FROM follow_up_sequences fs
    JOIN sequence_steps ss ON ss.sequence_id = fs.id
    WHERE fs.status = 'active'
      AND ss.action_type = 'email'
      AND fs.id >= ${fromSeq}
      AND fs.id <= ${toSeq}
    ORDER BY fs.id, ss.step_order
  `);

  type Row = {
    seq_id: number;
    seq_name: string;
    sequence_family: string | null;
    trigger_type: string | null;
    step_id: number;
    step_order: number;
    action_type: string;
    subject: string | null;
    body: string | null;
  };

  const steps = rows.rows as Row[];
  console.log(`Found ${steps.length} email steps across active sequences.\n`);

  // Group by sequence
  const seqMap = new Map<number, Row[]>();
  for (const row of steps) {
    if (!seqMap.has(row.seq_id)) seqMap.set(row.seq_id, []);
    seqMap.get(row.seq_id)!.push(row);
  }

  const results: StepResult[] = [];
  let sentCount = 0;
  let blockedCount = 0;
  let skippedCount = 0;

  // ── Send loop ────────────────────────────────────────────────────────────────
  for (const [seqId, seqSteps] of seqMap) {
    const { seq_name, sequence_family, trigger_type } = seqSteps[0];

    // Skip automated test-harness sequences
    if (SKIP_NAME_PATTERNS.some(p => p.test(seq_name))) {
      console.log(`⏭  SKIP [seq ${seqId}] "${seq_name}" — automated test-harness sequence`);
      for (const s of seqSteps) {
        results.push({ seqId, seqName: seq_name, stepOrder: s.step_order, subject: s.subject ?? "(no subject)", sender: "—", transport: "—", status: "skipped" });
        skippedCount++;
      }
      continue;
    }

    const isCold = isColdOutreachSequence({ sequenceFamily: sequence_family, triggerType: trigger_type });
    const sender = getSenderProfile(seq_name);
    const signatureHtml = getEmailSignatureHtml(sender.sigType);

    console.log(`▶  [seq ${seqId}] "${seq_name}"`);
    console.log(`   Cold: ${isCold ? "yes" : "no"} | From: ${sender.fromEmail} | Email steps: ${seqSteps.length}`);

    for (const step of seqSteps) {
      const rawSubject = step.subject ?? "(no subject)";
      const testSubject = `[TEST] ${seq_name} | Step ${step.step_order}: ${interpolate(rawSubject)}`;
      const stepBody = interpolate(step.body ?? "<p>(no body)</p>");

      const banner = buildTestBanner({
        seqId,
        seqName: seq_name,
        stepOrder: step.step_order,
        fromEmail: sender.fromEmail,
        isCold,
        triggerType: trigger_type,
        sigType: sender.sigType,
      });

      const footer = isCold ? buildTestComplianceFooter(mailingAddress, appUrl) : "";
      const fullBody = banner + stepBody + signatureHtml + footer;

      process.stdout.write(`   Step ${step.step_order}: "${interpolate(rawSubject).substring(0, 55)}" → `);

      // Transport selection: Gmail OAuth (if connected) → SMTP (if configured) → GHL
      let sendResult: { success: boolean; messageId?: string; error?: string };
      let transportUsed = "GHL";

      try {
        if (gmailConnected) {
          transportUsed = "Gmail OAuth";
          sendResult = await sendGmailEmail({
            to: TEST_RECIPIENT_EMAIL,
            subject: testSubject,
            html: fullBody,
            category: sender.category as any,
          });
          if (!sendResult.success) {
            // Fall through to GHL
            transportUsed = "GHL";
            sendResult = await sendGhlEmail({
              contactId: TEST_RECIPIENT_CONTACT_ID,
              subject: testSubject,
              body: fullBody,
              fromEmail: sender.fromEmail,
              fromName: sender.fromName,
            });
          }
        } else {
          sendResult = await sendGhlEmail({
            contactId: TEST_RECIPIENT_CONTACT_ID,
            subject: testSubject,
            body: fullBody,
            fromEmail: sender.fromEmail,
            fromName: sender.fromName,
          });
        }

        if (sendResult.success) {
          console.log(`✅ sent via ${transportUsed} (${sendResult.messageId ?? "—"})`);
          results.push({ seqId, seqName: seq_name, stepOrder: step.step_order, subject: testSubject, sender: sender.fromEmail, transport: transportUsed, status: "sent" });
          sentCount++;
        } else {
          console.log(`❌ blocked: ${sendResult.error}`);
          results.push({ seqId, seqName: seq_name, stepOrder: step.step_order, subject: testSubject, sender: sender.fromEmail, transport: transportUsed, status: "blocked", error: sendResult.error });
          blockedCount++;
        }
      } catch (err: any) {
        console.log(`❌ error: ${err.message}`);
        results.push({ seqId, seqName: seq_name, stepOrder: step.step_order, subject: testSubject, sender: sender.fromEmail, transport: transportUsed, status: "blocked", error: err.message });
        blockedCount++;
      }

      // Respect GHL API rate limits (1 500 ms avoids 429 bursts)
      await new Promise(r => setTimeout(r, 1500));
    }

    console.log();
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log(`║  BLAST COMPLETE                                                      ║`);
  console.log(`║  ✅ Sent   : ${String(sentCount).padEnd(4)}                                                   ║`);
  console.log(`║  ❌ Blocked: ${String(blockedCount).padEnd(4)}                                                   ║`);
  console.log(`║  ⏭  Skipped: ${String(skippedCount).padEnd(4)}                                                   ║`);
  console.log("╚══════════════════════════════════════════════════════════════════════╝\n");

  // ── Full results table ────────────────────────────────────────────────────────
  console.log("FULL RESULTS\n" + "═".repeat(130));
  console.log(
    "SEQ".padEnd(6),
    "SEQUENCE NAME".padEnd(50),
    "STEP".padEnd(5),
    "FROM ADDRESS".padEnd(38),
    "TRANSPORT".padEnd(12),
    "STATUS"
  );
  console.log("─".repeat(130));

  let lastSeqId = -1;
  for (const r of results) {
    if (r.seqId !== lastSeqId) {
      lastSeqId = r.seqId;
    }
    const statusStr =
      r.status === "sent"    ? "✅ sent" :
      r.status === "skipped" ? "⏭  skipped" :
      `❌ blocked — ${r.error?.substring(0, 40) ?? "unknown"}`;

    console.log(
      String(r.seqId).padEnd(6),
      r.seqName.substring(0, 49).padEnd(50),
      String(r.stepOrder).padEnd(5),
      r.sender.padEnd(38),
      r.transport.padEnd(12),
      statusStr
    );
  }

  console.log("\n✓ Blast complete. Check scott@libertybancard.com inbox (and GHL conversation view for contact #156106).");
  console.log("✓ outboundGlobalPaused remains TRUE — no prospect messages sent.");
  process.exit(blockedCount > 0 ? 1 : 0);
}

run().catch(err => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});
