/**
 * One-time script: send test email to scott@libertybancard.com and
 * test SMS to 3032465711.
 * Run: npx tsx scripts/send-test-comms.ts
 */
import {
  sendSmsReply,
  sendEmailReply,
} from "../server/services/sdr/ghl-client";

// GHL contact for scott@libertybancard.com / 3032465711
// (resolved from previous upsert + duplicate-400 response)
const GHL_CONTACT_ID = "G40aC2tyURzNts67ZHQs";

async function main() {
  // ── Test Email ─────────────────────────────────────────────────────────
  console.log(`\n[Email] Sending test email (GHL contactId=${GHL_CONTACT_ID})...`);
  try {
    const emailResult = await sendEmailReply({
      contactId: GHL_CONTACT_ID,
      subject:   "Liberty Bancard — System Test Email",
      htmlBody: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#1a3a5c;">Liberty Bancard System Test</h2>
          <p>This is a live system test from the Liberty Bancard AI Business Operating System.</p>
          <p>Email channel is working correctly. No action required.</p>
          <hr/>
          <p style="color:#666;font-size:12px;">Sent ${new Date().toISOString()} · Liberty Bancard Internal</p>
        </div>
      `,
    });
    const id = (emailResult as any)?.messageId ?? (emailResult as any)?.id ?? (emailResult as any)?.conversationId;
    if (id) {
      console.log(`[Email] ✅  Sent — messageId: ${id}`);
    } else {
      console.log(`[Email] ⚠️  Response (may have sent):`, JSON.stringify(emailResult));
    }
  } catch (err: any) {
    console.error(`[Email] ❌  Failed: ${err.message}`);
  }

  // ── Test SMS ───────────────────────────────────────────────────────────
  console.log(`\n[SMS] Sending test SMS (GHL contactId=${GHL_CONTACT_ID})...`);
  try {
    const smsResult = await sendSmsReply({
      contactId: GHL_CONTACT_ID,
      message: "Liberty Bancard system test SMS — please ignore. Your messaging channel is working correctly.",
    });
    const id = (smsResult as any)?.messageId ?? (smsResult as any)?.id ?? (smsResult as any)?.conversationId;
    if (id) {
      console.log(`[SMS] ✅  Sent — messageId: ${id}`);
    } else {
      console.log(`[SMS] ⚠️  Response (may have sent):`, JSON.stringify(smsResult));
    }
  } catch (err: any) {
    console.error(`[SMS] ❌  Failed: ${err.message}`);
  }

  console.log("\n✅  Test comms complete.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
