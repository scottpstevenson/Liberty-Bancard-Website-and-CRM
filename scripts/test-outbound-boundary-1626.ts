#!/usr/bin/env tsx
/**
 * scripts/test-outbound-boundary-1626.ts
 *
 * T-03 (#1626) — Fake-transport pause-denial tests for the paths changed in
 * task #1626. Implementation baseline SHA: 7bcd11543843cd12b2e49db90fc010319ed49458
 *
 * Covers:
 *   1. ghl-form-sync affiliate sync: paused authority → { skipped: true },
 *      real fetch to GHL never invoked (fetch spy).
 *   2. ghl-delete-sync propagateContactDeleteToGhl: paused authority →
 *      { ok: false, reason: "paused" }, no GHL DELETE fetch.
 *   3. smtp-email sendSmtpEmail: paused authority → { success: false } with a
 *      "paused" error (the inbox route maps this to deliveryOutcome "blocked",
 *      never "sent") — mapping asserted here too.
 *   4. outbound-control-service drainInflight: DB query throwing →
 *      { status: "degraded" } (fail-closed), never "drained".
 *   5. sanitizeAuditPayload: strips/redacts to/subject/email/phone/errText.
 *
 * Isolation: pause state is set via direct SQL (setTestPauseState pattern) +
 * invalidatePauseStateCache — NOT applyPauseMutation (which creates
 * coordinator holds and advances the epoch).
 *
 * Exit 0 = all pass; 1 = any fail.
 */

import { pool } from "../server/db";
import { invalidatePauseStateCache } from "../server/services/outbound-pause-authority";

// Exercise configured-provider pause gates without real credentials. The fetch
// spy below rejects every GHL host request, so an ordering regression still
// fails closed and can never reach the provider.
process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "ci-test-ghl-token-unused";
process.env.GHL_LOCATION_ID = "ci-test-ghl-location";

let passed = 0;
let failed = 0;
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
}

async function setTestPauseState(paused: boolean): Promise<void> {
  await pool.query(`UPDATE outbound_pause_control SET state = $1`, [paused ? "paused" : "unpaused"]);
  invalidatePauseStateCache();
}

// ── Fetch spy: counts (and blocks) any call to the GHL API host ─────────────
const realFetch = globalThis.fetch.bind(globalThis);
let ghlFetchCount = 0; // mutation (POST/PUT/PATCH/DELETE) attempts — the kill-line metric
let ghlReadCount = 0;  // reads are never pause-gated; tracked separately
globalThis.fetch = ((input: any, init?: any) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url ?? "";
  if (typeof url === "string" && url.includes("services.leadconnectorhq.com")) {
    const method = (init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) ghlFetchCount++;
    else ghlReadCount++;
    return Promise.reject(new Error("TEST SPY: real GHL call attempted — this is a kill-line failure"));
  }
  return realFetch(input, init);
}) as typeof fetch;

async function main() {
  console.log("\n=== #1626 Outbound Boundary Denial Tests ===\n");

  const preState = await pool.query<{ state: string }>(
    `SELECT state FROM outbound_pause_control ORDER BY id LIMIT 1`,
  );
  const preWasPaused = preState.rows[0]?.state !== "unpaused";

  try {
    await setTestPauseState(true);

    // ── 1. ghl-form-sync affiliate sync denial ──────────────────────────────
    console.log("  [1] ghl-form-sync affiliate sync while paused");
    const { syncAffiliateSignupToGhl } = await import("../server/services/ghl-form-sync");
    const affResult = await syncAffiliateSignupToGhl({
      firstName: "Test1626",
      email: `test-1626-${Date.now()}@example.invalid`,
      phone: `+1555${Date.now() % 10000000}`,
      affiliateCode: `T1626-${Date.now() % 100000}`,
    });
    assert("affiliate sync returns skipped (not success)", affResult.success === false && affResult.skipped === true, JSON.stringify(affResult));
    assert("no GHL fetch attempted by affiliate sync", ghlFetchCount === 0, `ghlFetchCount=${ghlFetchCount}`);

    // ── 2. delete propagation denial ────────────────────────────────────────
    console.log("  [2] propagateContactDeleteToGhl while paused");
    const ins = await pool.query<{ id: number }>(
      `INSERT INTO contacts (first_name, last_name, email, phone, ghl_contact_id, do_not_auto_contact)
       VALUES ('QA1626', 'DeleteTest', $1, $2, $3, true) RETURNING id`,
      [`test-1626-del-${Date.now()}@example.invalid`, `+1555${Date.now() % 10000000}`, `test-1626-ghl-${Date.now()}`],
    );
    const testContactId = ins.rows[0].id;
    try {
      const { propagateContactDeleteToGhl } = await import("../server/services/ghl-delete-sync");
      const delResult = await propagateContactDeleteToGhl(testContactId);
      assert("delete propagation returns ok:false (paused)", delResult.ok === false && String(delResult.reason).toLowerCase().includes("paused"), JSON.stringify(delResult));
      assert("no GHL DELETE fetch attempted", ghlFetchCount === 0, `ghlFetchCount=${ghlFetchCount}`);
    } finally {
      await pool.query(`DELETE FROM contacts WHERE id = $1`, [testContactId]);
    }

    // ── 3. SMTP paused → success:false → maps to "blocked", never "sent" ────
    console.log("  [3] sendSmtpEmail while paused");
    const { sendSmtpEmail } = await import("../server/services/smtp-email");
    const smtpResult = await sendSmtpEmail({
      to: "test-1626@example.invalid",
      subject: "T-03 pause denial test",
      html: "<p>test</p>",
      category: "support",
    });
    assert("sendSmtpEmail returns success:false when paused", smtpResult.success === false, JSON.stringify(smtpResult));
    const errLower = (smtpResult.error ?? "").toLowerCase();
    assert("error mentions paused/blocked", errLower.includes("paused") || errLower.includes("blocked"), smtpResult.error);
    // Inbox route mapping: paused/blocked → "blocked" (never "sent")
    const mapped = errLower.includes("paused") || errLower.includes("blocked") ? "blocked"
      : errLower.includes("not configured") ? "not_configured" : "failed";
    assert(`route mapping yields "blocked" not "sent"`, mapped === "blocked", mapped);

    // ── 4. Drain degraded on DB error ────────────────────────────────────────
    console.log("  [4] drainInflight with failing DB query");
    const { drainInflight } = await import("../server/services/outbound-control-service");
    const origQuery = pool.query.bind(pool);
    (pool as any).query = () => Promise.reject(new Error("simulated DB outage (T-03)"));
    let drainResult: { status: string; reason?: string };
    try {
      drainResult = await drainInflight(1000);
    } finally {
      (pool as any).query = origQuery;
    }
    assert("drain returns degraded (fail-closed), not drained", drainResult.status === "degraded", JSON.stringify(drainResult));

    // ── 5. sanitizeAuditPayload redaction ────────────────────────────────────
    console.log("  [5] sanitizeAuditPayload");
    const { sanitizeAuditPayload } = await import("../server/services/audit-sanitizer");
    const dirty = {
      action: "test", to: "person@example.com", subject: "Secret subject",
      nested: { email: "n@example.com", phone: "+15551234567", errText: "raw provider body" },
      safe: 42,
    };
    const clean: any = sanitizeAuditPayload(dirty);
    assert("to redacted", clean.to !== dirty.to && String(clean.to).includes("***"), clean.to);
    assert("subject redacted", clean.subject !== dirty.subject, clean.subject);
    assert("nested email/phone/errText redacted",
      clean.nested.email !== dirty.nested.email && clean.nested.phone !== dirty.nested.phone && clean.nested.errText !== dirty.nested.errText,
      JSON.stringify(clean.nested));
    assert("non-sensitive fields untouched", clean.action === "test" && clean.safe === 42);

    // Provider-style content under the common `error` key must not survive
    const { scrubErrorString, sanitizeEntityKey } = await import("../server/services/audit-sanitizer");
    const providerBody = `{"contact":{"email":"leak@example.com","phone":"+15559998888","name":"Jane Doe"}}`;
    const errClean: any = sanitizeAuditPayload({ error: providerBody });
    assert("provider JSON body under `error` fully redacted",
      !String(errClean.error).includes("leak@example.com") && !String(errClean.error).includes("Jane Doe"),
      errClean.error);
    const errTextClean: any = sanitizeAuditPayload({ error: "SMTP send to leak@example.com failed: call +1 555-123-4567" });
    assert("email/phone inside plain `error` text scrubbed",
      !String(errTextClean.error).includes("leak@example.com") && !String(errTextClean.error).includes("555-123-4567"),
      errTextClean.error);
    const nestedErr: any = sanitizeAuditPayload({ details: { errorMessage: providerBody } });
    assert("nested errorMessage redacted", !JSON.stringify(nestedErr).includes("leak@example.com"), JSON.stringify(nestedErr));
    assert("scrubErrorString truncates long strings", scrubErrorString("x".repeat(500)).length <= 161);
    // entityKey normalization: raw email/phone never persists as entity key
    assert("entityKey email redacted", sanitizeEntityKey("person@example.com") === "per***");
    assert("entityKey phone redacted", String(sanitizeEntityKey("+15551234567")).includes("***"));
    assert("entityKey name passes through", sanitizeEntityKey("Jane Doe Cafe") === "Jane Doe Cafe");
    assert("entityKey null passes through", sanitizeEntityKey(null) === null);

    // ── 6. Interleaving: epoch changes between register and provider I/O ────
    // gatedGhlMutation must run authorize → registerInflight(token, epoch) →
    // recheckEpoch(epoch) → I/O. If the pause epoch advances after registration
    // (a pause transitioning to "activating"), the mutation must be aborted.
    console.log("  [6] gatedGhlMutation interleaving (epoch advances mid-protocol)");
    await setTestPauseState(false); // start unpaused so authorize() grants
    const preEpochRow = await pool.query<{ epoch: number }>(`SELECT epoch FROM outbound_pause_control ORDER BY id LIMIT 1`);
    const preEpoch = preEpochRow.rows[0].epoch;
    try {
      const { gatedGhlMutation } = await import("../server/services/ghl-form-sync");
      let ioCalled = false;
      const interleaved = await gatedGhlMutation(
        "interleave_test",
        async () => { ioCalled = true; return "should_not_run"; },
        {
          afterRegister: async () => {
            // Simulate a pause activating between registration and recheck
            await pool.query(`UPDATE outbound_pause_control SET epoch = epoch + 1, state = 'paused'`);
            invalidatePauseStateCache();
          },
        },
      );
      assert("interleaved mutation is skipped (epoch_changed or paused)",
        interleaved.ok === false, JSON.stringify(interleaved));
      assert("provider I/O never ran after epoch advanced", ioCalled === false);
      assert("no GHL fetch attempted during interleaving test", ghlFetchCount === 0, `ghlFetchCount=${ghlFetchCount}`);
    } finally {
      await pool.query(`UPDATE outbound_pause_control SET epoch = $1`, [preEpoch]);
      await setTestPauseState(true);
    }
    // ── 8. Form-sync underlying mutations denied while paused ───────────────
    // syncFormSubmissionToGhl / support sync run through syncContactToGhl
    // (→ upsertGhlContact) plus updateCustomFields/addTag/addNote in the SDR
    // client. All of these must run the full pause protocol and be denied
    // while paused, with zero GHL fetches.
    console.log("  [8] contact upsert / custom-field / tag / note mutations while paused");
    {
      await setTestPauseState(true);
      const preCount = ghlFetchCount;
      const sdr = await import("../server/services/sdr/ghl-client");
      const denials: Array<[string, () => Promise<unknown>]> = [
        ["upsertContact", () => sdr.upsertContact({ firstName: "T", email: "t-1626@example.invalid" })],
        ["updateCustomFields", () => sdr.updateCustomFields("fake-ghl-id-1626", { lb_vertical: "test" })],
        ["addTag", () => sdr.addTag({ contactId: "fake-ghl-id-1626", tags: ["t-1626"] })],
        ["addNote", () => sdr.addNote({ contactId: "fake-ghl-id-1626", body: "t" })],
        ["removeTag", () => sdr.removeTag({ contactId: "fake-ghl-id-1626", tags: ["t-1626"] })],
        ["manageOpportunity", () => sdr.manageOpportunity({ pipelineId: "p", stageId: "s", contactId: "fake-ghl-id-1626", name: "t" })],
      ];
      for (const [name, fn] of denials) {
        let threwPaused = false;
        try { await fn(); } catch (e: any) {
          threwPaused = /pause|paused|blocked/i.test(String(e?.message));
        }
        assert(`${name} denied while paused`, threwPaused);
      }
      // ghl.ts upsertGhlContact (used by syncContactToGhl → form sync)
      const { upsertGhlContact } = await import("../server/services/ghl");
      let upsertDenied = false;
      try {
        await upsertGhlContact({ firstName: "T1626", email: "t-1626-upsert@example.invalid", phone: "+15550001626" } as any);
      } catch (e: any) {
        upsertDenied = /blocked by pause authority/i.test(String(e?.message));
      }
      assert("upsertGhlContact denied while paused (full protocol)", upsertDenied);
      assert("no GHL fetch attempted by any paused mutation", ghlFetchCount === preCount, `delta=${ghlFetchCount - preCount}`);
      // Pause blocks must be circuit-breaker skips, never counted failures
      const { classifyGhlSyncError } = await import("../server/services/ghl-sync");
      assert("pause-authority block classified as skip (no circuit trip)",
        classifyGhlSyncError("GHL contact upsert blocked by pause authority: global_paused") === "skip");
    }

    // ── 9. Fetch-level pause boundary + archive ordering ────────────────────
    // sdrGhlFetch enforces the full protocol on ANY mutation whose caller did
    // not already gate (AI toggles/DND fallback, conversation create). And
    // contact/deal archive must remain un-archived when propagation is denied.
    console.log("  [9] fetch-level mutation boundary + archive ordering while paused");
    {
      await setTestPauseState(true);
      const preCount = ghlFetchCount;
      const sdr = await import("../server/services/sdr/ghl-client");
      for (const [name, fn] of [
        ["disableConversationAi", () => sdr.disableConversationAi("fake-ghl-id-1626")],
        ["enableConversationAi", () => sdr.enableConversationAi("fake-ghl-id-1626")],
        ["createConversation", () => sdr.createConversation({ contactId: "fake-ghl-id-1626" })],
      ] as Array<[string, () => Promise<unknown>]>) {
        let denied = false;
        try { await fn(); } catch (e: any) { denied = /pause|paused|blocked/i.test(String(e?.message)); }
        assert(`${name} denied at fetch boundary while paused`, denied);
      }
      assert("no GHL fetch attempted by fetch-boundary mutations", ghlFetchCount === preCount, `delta=${ghlFetchCount - preCount}`);

      // Archive ordering: propagation denied → local row must stay unarchived.
      const archIns = await pool.query<{ id: number }>(
        `INSERT INTO contacts (first_name, last_name, email, phone, ghl_contact_id, do_not_auto_contact)
         VALUES ('QA1626', 'ArchiveTest', $1, $2, $3, true) RETURNING id`,
        [`test-1626-arch-${Date.now()}@example.invalid`, `+1555${(Date.now() + 1) % 10000000}`, `test-1626-arch-ghl-${Date.now()}`],
      );
      const archId = archIns.rows[0].id;
      try {
        const { propagateContactDeleteToGhl } = await import("../server/services/ghl-delete-sync");
        const { storage } = await import("../server/storage");
        // Mirror the route: archive only when propagation succeeds.
        const prop = await propagateContactDeleteToGhl(archId);
        if (prop.ok) await storage.archiveContact(archId, { actorType: "system" });
        assert("archive propagation denied while paused", prop.ok === false, JSON.stringify(prop));
        const row = await pool.query(`SELECT archived_at FROM contacts WHERE id = $1`, [archId]);
        assert("contact remains unarchived when propagation denied", row.rows[0]?.archived_at == null, String(row.rows[0]?.archived_at));
      } finally {
        await pool.query(`DELETE FROM contacts WHERE id = $1`, [archId]);
      }
    }

    // ── 10. ghl-sync.ts entity sync paths denied while paused ────────────────
    // syncDealToGhl / syncTaskToGhl / syncTicketToGhl / syncNoteToGhl mutate
    // GHL through ghl-sync.ts's own fetch helper, which now enforces the full
    // pause protocol on mutation methods. All must fail (or skip) with zero
    // GHL fetches while paused, and the errors must classify as skips.
    console.log("  [10] deal/task/ticket/note sync while paused");
    {
      await setTestPauseState(true);
      const preCount = ghlFetchCount;
      const sync = await import("../server/services/ghl-sync");
      // Create a contact with a fake GHL link plus dependent entities so each
      // sync path reaches its provider mutation (and is denied there).
      const cIns = await pool.query<{ id: number }>(
        `INSERT INTO contacts (first_name, last_name, email, phone, ghl_contact_id, do_not_auto_contact)
         VALUES ('QA1626', 'SyncTest', $1, $2, $3, true) RETURNING id`,
        [`test-1626-sync-${Date.now()}@example.invalid`, `+1555${(Date.now() + 2) % 10000000}`, `test-1626-sync-ghl-${Date.now()}`],
      );
      const syncContactId = cIns.rows[0].id;
      let dealId: number | null = null, taskId: number | null = null;
      try {
        const dIns = await pool.query<{ id: number }>(
          `INSERT INTO deals (contact_id, pipeline, stage) VALUES ($1, 'sales', 'New Lead') RETURNING id`,
          [syncContactId],
        );
        dealId = dIns.rows[0].id;
        const tIns = await pool.query<{ id: number }>(
          `INSERT INTO tasks (title, contact_id, status) VALUES ('T1626 task', $1, 'pending') RETURNING id`,
          [syncContactId],
        );
        taskId = tIns.rows[0].id;

        const paths: Array<[string, () => Promise<any>]> = [
          ["syncDealToGhl", () => sync.syncDealToGhl(dealId!)],
          ["syncTaskToGhl", () => sync.syncTaskToGhl(taskId!)],
        ];
        for (const [name, fn] of paths) {
          let deniedOrSkipped = false;
          let detail = "";
          try {
            const r = await fn();
            detail = JSON.stringify(r);
            deniedOrSkipped = r?.success === false || r?.skipped === true;
          } catch (e: any) {
            detail = String(e?.message);
            deniedOrSkipped = /pause|paused|blocked/i.test(detail);
          }
          assert(`${name} denied/skipped while paused`, deniedOrSkipped, detail);
        }
        assert("no GHL fetch attempted by entity sync while paused", ghlFetchCount === preCount, `delta=${ghlFetchCount - preCount}`);
        const { classifyGhlSyncError } = sync;
        assert("fetch-level pause block classified as skip",
          classifyGhlSyncError("GHL mutation blocked by pause authority: global_paused (POST /opportunities/)") === "skip");

        // ghl.ts createGhlTask (public mutation path via its own fetch adapter)
        const preMut = ghlFetchCount;
        const { createGhlTask } = await import("../server/services/ghl");
        let taskDenied = false;
        try {
          // createGhlTask swallows errors and returns { success:false, error }
          const tr = await createGhlTask({ contactId: `test-1626-sync-ghl-x`, title: "T1626", dueDate: new Date() } as any);
          taskDenied = tr.success === false && /pause|paused|blocked/i.test(String(tr.error));
        } catch (e: any) {
          taskDenied = /pause|paused|blocked/i.test(String(e?.message));
        }
        assert("createGhlTask denied at ghl.ts fetch boundary while paused", taskDenied);
        assert("no GHL mutation fetch attempted by createGhlTask", ghlFetchCount === preMut, `delta=${ghlFetchCount - preMut}`);
      } finally {
        if (taskId) await pool.query(`DELETE FROM tasks WHERE id = $1`, [taskId]);
        if (dealId) await pool.query(`DELETE FROM deals WHERE id = $1`, [dealId]);
        await pool.query(`DELETE FROM contacts WHERE id = $1`, [syncContactId]);
      }
    }

    // ── 7. Static gate: every raw audit_logs insert site is sanitized ───────
    // Regression guard for the audit boundary: any `INSERT INTO audit_logs`
    // or `insert(auditLogs)` site anywhere in server/ must reference the
    // canonical sanitizer within a few surrounding lines (or be one of the
    // canonical writer files, which sanitize internally).
    console.log("  [7] static gate: raw audit_logs inserts route through sanitizer");
    {
      const { execSync } = await import("child_process");
      const fs = await import("fs");
      const out = execSync(
        `grep -rn "INSERT INTO audit_logs\\|insert(auditLogs)" server --include=*.ts || true`,
        { encoding: "utf8" },
      );
      const CANONICAL_WRITERS = ["server/storage/audit.ts", "server/services/audit-change.ts"];
      const offenders: string[] = [];
      for (const line of out.split("\n").filter(Boolean)) {
        const [file, lineNoStr] = line.split(":");
        if (CANONICAL_WRITERS.includes(file)) continue;
        const lineNo = parseInt(lineNoStr, 10);
        const src = fs.readFileSync(file, "utf8").split("\n");
        // Window covers payloads built shortly before the insert (e.g. a
        // sanitized `auditDetails` variable) as well as inline payloads.
        const window = src.slice(Math.max(0, lineNo - 20), lineNo + 14).join("\n");
        if (!window.includes("sanitizeAuditPayload") && !window.includes("audit-sanitizer")) {
          offenders.push(`${file}:${lineNo}`);
        }
      }
      assert("every raw audit_logs insert references the sanitizer", offenders.length === 0, offenders.join(", "));
    }
  } finally {
    // Restore original pause state (direct SQL — no coordinator holds)
    await setTestPauseState(preWasPaused);
    globalThis.fetch = realFetch;
  }

  console.log(`\n  Passed: ${passed}  Failed: ${failed}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test run crashed:", err);
  process.exit(1);
});
