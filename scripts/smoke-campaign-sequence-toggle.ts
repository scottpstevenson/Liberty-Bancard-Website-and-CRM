#!/usr/bin/env tsx
/**
 * Task #1962 — Campaign/Sequence Activate-Pause toggle smoke test.
 *
 * Exercises PUT /api/campaigns/:id/toggle-status and
 * PUT /api/sequences/:id/toggle-status end-to-end against a running dev
 * server:
 *   - a draft/unapproved campaign MUST fail closed (409) on activation
 *   - approving the campaign's current revision MUST unblock activation
 *   - activate/pause both flip status correctly and round-trip
 *   - a non-owning manager MUST be denied (403) on both campaigns and sequences
 *   - an unknown id MUST 404
 *
 * Run with the dev server up:
 *   npx tsx scripts/smoke-campaign-sequence-toggle.ts
 *
 * Exits 0 if every assertion holds, 1 otherwise.
 */

import bcrypt from "bcryptjs";
import { db } from "../server/db";
import { users } from "../shared/models/auth";
import { campaigns, campaignSteps, campaignApprovals, followUpSequences } from "../shared/schema";
import crypto from "crypto";
import { eq, and } from "drizzle-orm";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";

const ADMIN_EMAIL = "smoke-toggle-admin@libertybancard.test";
const ADMIN_PASSWORD = "smoke-toggle-admin-Aa1!";
const MANAGER_EMAIL = "smoke-toggle-manager@libertybancard.test";
const MANAGER_PASSWORD = "smoke-toggle-manager-Aa1!";

let failures = 0;

function assert(cond: boolean, message: string) {
  if (cond) {
    console.log(`  \u2713 ${message}`);
  } else {
    console.error(`  \u2717 ${message}`);
    failures++;
  }
}

async function ensureUser(email: string, password: string, role: string, first: string, last: string) {
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await db.select().from(users).where(eq(users.email, email));
  if (existing.length === 0) {
    await db.insert(users).values({
      email, firstName: first, lastName: last, passwordHash, role,
      authProvider: "local", emailVerified: new Date(),
    });
  } else {
    await db.update(users)
      .set({ passwordHash, role, authProvider: "local", emailVerified: new Date() })
      .where(eq(users.email, email));
  }
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${await res.text()}`);
  const rawHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  const setCookieArr: string[] = typeof rawHeaders.getSetCookie === "function"
    ? rawHeaders.getSetCookie()
    : [res.headers.get("set-cookie") ?? ""];
  const cookies = setCookieArr.map((c) => c.split(";")[0].trim()).filter(Boolean);
  if (cookies.length === 0) throw new Error(`No session cookie for ${email}`);
  return cookies.join("; ");
}

async function csrfToken(cookie: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/csrf-token`, { headers: { cookie } });
  const body = await res.json();
  return body.token;
}

async function api(method: string, path: string, cookie: string, csrf: string, body?: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      cookie,
      "x-csrf-token": csrf,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

async function main() {
  console.log("Setting up smoke-test users...");
  await ensureUser(ADMIN_EMAIL, ADMIN_PASSWORD, "admin", "Smoke", "Admin");
  await ensureUser(MANAGER_EMAIL, MANAGER_PASSWORD, "manager", "Smoke", "Manager");

  const adminCookie = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const adminCsrf = await csrfToken(adminCookie);
  const managerCookie = await login(MANAGER_EMAIL, MANAGER_PASSWORD);
  const managerCsrf = await csrfToken(managerCookie);

  const fixtureName = `smoke-toggle-${Date.now()}`;
  let campaignId: number | undefined;
  let sequenceId: number | undefined;

  try {
    // ── Campaigns ──────────────────────────────────────────────────────
    console.log("\nCampaign toggle-status:");
    const createRes = await api("POST", "/api/campaigns", adminCookie, adminCsrf, { name: `${fixtureName}-camp` });
    assert(createRes.status === 201, `create draft campaign -> 201 (got ${createRes.status})`);
    campaignId = createRes.json?.id;
    assert(createRes.json?.status === "draft", `new campaign starts as draft (got ${createRes.json?.status})`);

    const activateUnapproved = await api("PUT", `/api/campaigns/${campaignId}/toggle-status`, adminCookie, adminCsrf, {});
    assert(activateUnapproved.status === 409, `activate WITHOUT approval -> 409 fail-closed (got ${activateUnapproved.status})`);

    const approveRes = await api("POST", `/api/campaigns/${campaignId}/approve`, adminCookie, adminCsrf, { confirm: "APPROVE CAMPAIGN LAUNCH" });
    assert(approveRes.status === 200, `admin approve -> 200 (got ${approveRes.status})`);

    const activateApproved = await api("PUT", `/api/campaigns/${campaignId}/toggle-status`, adminCookie, adminCsrf, {});
    assert(activateApproved.status === 200 && activateApproved.json?.status === "active", `activate AFTER approval -> active (got ${activateApproved.status}/${activateApproved.json?.status})`);

    const pauseRes = await api("PUT", `/api/campaigns/${campaignId}/toggle-status`, adminCookie, adminCsrf, {});
    assert(pauseRes.status === 200 && pauseRes.json?.status === "paused", `toggle again -> paused (got ${pauseRes.status}/${pauseRes.json?.status})`);

    const reactivateRes = await api("PUT", `/api/campaigns/${campaignId}/toggle-status`, adminCookie, adminCsrf, {});
    assert(reactivateRes.status === 200 && reactivateRes.json?.status === "active", `resume from paused (already-approved revision) -> active (got ${reactivateRes.status}/${reactivateRes.json?.status})`);

    const managerToggleForbidden = await api("PUT", `/api/campaigns/${campaignId}/toggle-status`, managerCookie, managerCsrf, {});
    assert(managerToggleForbidden.status === 403, `non-owning manager toggling admin's campaign -> 403 (got ${managerToggleForbidden.status})`);

    const notFound = await api("PUT", "/api/campaigns/999999999/toggle-status", adminCookie, adminCsrf, {});
    assert(notFound.status === 404, `toggle unknown campaign id -> 404 (got ${notFound.status})`);

    // Pause back to draft-equivalent state for the stale-approval race check below.
    // (campaign is currently "active" from the resume step above — pause it so
    // step edits are allowed again, matching the "still draft" edit gate.)
    await api("PUT", `/api/campaigns/${campaignId}/toggle-status`, adminCookie, adminCsrf, {});
    // campaign is now "paused" — not "draft" — so step routes will correctly 409.
    // Create a FRESH draft campaign to test the stale-approval-after-edit race,
    // since steps can only be added/edited while status === "draft".
    const raceRes = await api("POST", "/api/campaigns", adminCookie, adminCsrf, { name: `${fixtureName}-race-camp` });
    const raceCampaignId: number = raceRes.json?.id;
    const raceApprove = await api("POST", `/api/campaigns/${raceCampaignId}/approve`, adminCookie, adminCsrf, { confirm: "APPROVE CAMPAIGN LAUNCH" });
    assert(raceApprove.status === 200, `race-campaign approve -> 200 (got ${raceApprove.status})`);

    const addStep = await api("POST", `/api/campaigns/${raceCampaignId}/steps`, adminCookie, adminCsrf, {
      stepOrder: 1, stepType: "initial_outreach", delayDays: 0, channel: "email", subject: "hi", bodyTemplate: "hello",
    });
    assert(addStep.status === 201, `add step to approved draft -> 201 (got ${addStep.status})`);
    const stepId: number = addStep.json?.id;

    const activateAfterStepAdd = await api("PUT", `/api/campaigns/${raceCampaignId}/toggle-status`, adminCookie, adminCsrf, {});
    assert(activateAfterStepAdd.status === 409, `activate REJECTED after adding a step post-approval (stale approval) -> 409 (got ${activateAfterStepAdd.status})`);

    const reApprove1 = await api("POST", `/api/campaigns/${raceCampaignId}/approve`, adminCookie, adminCsrf, { confirm: "APPROVE CAMPAIGN LAUNCH" });
    assert(reApprove1.status === 200, `re-approve after step add -> 200 (got ${reApprove1.status})`);

    const editStep = await api("PUT", `/api/campaign-steps/${stepId}`, adminCookie, adminCsrf, { subject: "changed" });
    assert(editStep.status === 200, `edit step -> 200 (got ${editStep.status})`);
    const activateAfterStepEdit = await api("PUT", `/api/campaigns/${raceCampaignId}/toggle-status`, adminCookie, adminCsrf, {});
    assert(activateAfterStepEdit.status === 409, `activate REJECTED after editing a step post-approval (stale approval) -> 409 (got ${activateAfterStepEdit.status})`);

    const reApprove2 = await api("POST", `/api/campaigns/${raceCampaignId}/approve`, adminCookie, adminCsrf, { confirm: "APPROVE CAMPAIGN LAUNCH" });
    assert(reApprove2.status === 200, `re-approve after step edit -> 200 (got ${reApprove2.status})`);

    const deleteStep = await api("DELETE", `/api/campaign-steps/${stepId}`, adminCookie, adminCsrf);
    assert(deleteStep.status === 200, `delete step -> 200 (got ${deleteStep.status})`);
    const activateAfterStepDelete = await api("PUT", `/api/campaigns/${raceCampaignId}/toggle-status`, adminCookie, adminCsrf, {});
    assert(activateAfterStepDelete.status === 409, `activate REJECTED after deleting a step post-approval (stale approval) -> 409 (got ${activateAfterStepDelete.status})`);

    await db.delete(campaigns).where(eq(campaigns.id, raceCampaignId));

    // Deterministic concurrency check: fire a real concurrent step-edit and
    // activation request at the same approved campaign. Both routes lock the
    // campaign row (SELECT ... FOR UPDATE inside one transaction), so the
    // database must serialize them — one commits first and the other either
    // succeeds against the resulting state or is rejected by it. The
    // invariant that must never be violated: if the campaign ends up
    // "active", its approvedRevision must equal its contentRevision (i.e.
    // activation never wins against, or is invisible to, a concurrent edit
    // that invalidates approval). Run several trials since race outcomes are
    // timing-dependent.
    console.log("\nCampaign concurrency (step-edit vs activate race):");
    for (let trial = 0; trial < 8; trial++) {
      const concCreate = await api("POST", "/api/campaigns", adminCookie, adminCsrf, { name: `${fixtureName}-conc-${trial}` });
      const concCampaignId: number = concCreate.json.id;
      const concStep = await api("POST", `/api/campaigns/${concCampaignId}/steps`, adminCookie, adminCsrf, {
        stepOrder: 1, stepType: "initial_outreach", delayDays: 0, channel: "email", subject: "hi", bodyTemplate: "hello",
      });
      const concStepId: number = concStep.json.id;
      await api("POST", `/api/campaigns/${concCampaignId}/approve`, adminCookie, adminCsrf, { confirm: "APPROVE CAMPAIGN LAUNCH" });

      const [editResult, activateResult] = await Promise.all([
        api("PUT", `/api/campaign-steps/${concStepId}`, adminCookie, adminCsrf, { subject: `raced-${trial}` }),
        api("PUT", `/api/campaigns/${concCampaignId}/toggle-status`, adminCookie, adminCsrf, {}),
      ]);

      const [finalRow] = await db.select().from(campaigns).where(eq(campaigns.id, concCampaignId));
      const invariantHolds = finalRow.status !== "active" || finalRow.approvedRevision === finalRow.contentRevision;
      assert(
        invariantHolds,
        `trial ${trial}: no active-with-unapproved-revision (status=${finalRow.status}, contentRevision=${finalRow.contentRevision}, approvedRevision=${finalRow.approvedRevision}, edit=${editResult.status}, activate=${activateResult.status})`
      );
      // Both requests must still get a well-formed, non-crashing response
      // (200 or the expected 409/edit-blocked outcome) — never a 500 from a
      // deadlock or unhandled transaction error.
      assert(
        [200, 409].includes(editResult.status) && [200, 409].includes(activateResult.status),
        `trial ${trial}: both concurrent requests resolved cleanly (edit=${editResult.status}, activate=${activateResult.status})`
      );

      await db.delete(campaignSteps).where(eq(campaignSteps.campaignId, concCampaignId));
      await db.delete(campaigns).where(eq(campaigns.id, concCampaignId));
    }

    // Deterministic concurrency check #2: fire a real concurrent campaign
    // edit and approve request. The approve route must compute its scope
    // hash from the row read under its own lock, not from an earlier
    // unlocked read — otherwise a concurrent edit racing the approval could
    // get its approval fingerprinted against stale (pre-edit) content. Assert
    // that whichever approval record actually gets persisted has a scope
    // hash matching the campaign's real content for that exact revision at
    // the time the transaction ran (recomputed against the DB values that
    // must have been visible at approval time).
    console.log("\nCampaign concurrency (edit vs approve scope-hash race):");
    for (let trial = 0; trial < 5; trial++) {
      const hashCreate = await api("POST", "/api/campaigns", adminCookie, adminCsrf, { name: `${fixtureName}-hash-${trial}`, dailySendLimit: 100 });
      const hashCampaignId: number = hashCreate.json.id;

      const [editResult, approveResult] = await Promise.all([
        api("PUT", `/api/campaigns/${hashCampaignId}`, adminCookie, adminCsrf, { name: `${fixtureName}-hash-${trial}-edited`, dailySendLimit: 250 }),
        api("POST", `/api/campaigns/${hashCampaignId}/approve`, adminCookie, adminCsrf, { confirm: "APPROVE CAMPAIGN LAUNCH" }),
      ]);
      assert(
        [200].includes(editResult.status) && [200].includes(approveResult.status),
        `trial ${trial}: concurrent edit + approve both resolved 200 (edit=${editResult.status}, approve=${approveResult.status})`
      );

      const approvedRevision: number = approveResult.json.revision;
      const [finalRow] = await db.select().from(campaigns).where(eq(campaigns.id, hashCampaignId));
      const [approvalRow] = await db.select().from(campaignApprovals)
        .where(and(eq(campaignApprovals.campaignId, hashCampaignId), eq(campaignApprovals.revision, approvedRevision)));

      // Whichever content the campaign actually held at the exact revision
      // this approval targeted, the stored scope hash must match it — proof
      // the hash was computed from the locked snapshot, not a stale read.
      // If the edit committed first (approvedRevision === current content
      // revision), the hash must reflect the EDITED fields; if the approval
      // won the race against the still-unbumped revision, it must reflect
      // the ORIGINAL fields.
      const editWonFirst = approvedRevision === finalRow.contentRevision && finalRow.name.endsWith("-edited");
      const scopeSource = JSON.stringify({
        targetVerticals: editWonFirst ? finalRow.targetVerticals : null,
        filterCriteria: editWonFirst ? finalRow.filterCriteria : null,
        dailySendLimit: editWonFirst ? finalRow.dailySendLimit : 100,
        readinessThreshold: editWonFirst ? finalRow.readinessThreshold : null,
        name: editWonFirst ? finalRow.name : `${fixtureName}-hash-${trial}`,
      });
      const expectedHash = crypto.createHash("sha256").update(scopeSource).digest("hex").slice(0, 16);
      assert(
        approvalRow?.scopeHash === expectedHash,
        `trial ${trial}: stored scope hash matches content at the approved revision (editWonFirst=${editWonFirst}, stored=${approvalRow?.scopeHash}, expected=${expectedHash})`
      );

      await db.delete(campaigns).where(eq(campaigns.id, hashCampaignId));
    }

    // Legacy-data regression: a campaign that predates the approval system
    // (or was paused before ever passing through it) has approvedRevision =
    // NULL while status = "paused". It must still be re-approvable and
    // reactivatable — there is no route back to "draft", so approval must be
    // allowed directly from "paused".
    console.log("\nLegacy paused campaign (no prior approval) can still be approved + reactivated:");
    const [legacyPaused] = await db.insert(campaigns).values({
      name: `${fixtureName}-legacy-paused`, status: "paused", contentRevision: 1, approvedRevision: null,
    }).returning();
    const legacyApprove = await api("POST", `/api/campaigns/${legacyPaused.id}/approve`, adminCookie, adminCsrf, { confirm: "APPROVE CAMPAIGN LAUNCH" });
    assert(legacyApprove.status === 200, `approve a legacy paused (never-approved) campaign -> 200 (got ${legacyApprove.status})`);
    const legacyActivate = await api("PUT", `/api/campaigns/${legacyPaused.id}/toggle-status`, adminCookie, adminCsrf, {});
    assert(legacyActivate.status === 200 && legacyActivate.json?.status === "active", `reactivate legacy paused campaign after approval -> active (got ${legacyActivate.status}/${legacyActivate.json?.status})`);
    await db.delete(campaigns).where(eq(campaigns.id, legacyPaused.id));

    // ── Sequences ──────────────────────────────────────────────────────
    console.log("\nSequence toggle-status:");
    const createSeqRes = await api("POST", "/api/sequences", adminCookie, adminCsrf, { name: `${fixtureName}-seq`, triggerType: "manual" });
    assert(createSeqRes.status === 201, `create sequence -> 201 (got ${createSeqRes.status})`);
    sequenceId = createSeqRes.json?.id;
    assert(createSeqRes.json?.status === "paused", `new sequence starts paused (got ${createSeqRes.json?.status})`);

    const seqActivate = await api("PUT", `/api/sequences/${sequenceId}/toggle-status`, adminCookie, adminCsrf, {});
    assert(seqActivate.status === 200 && seqActivate.json?.status === "active", `activate paused sequence -> active (got ${seqActivate.status}/${seqActivate.json?.status})`);

    const seqPause = await api("PUT", `/api/sequences/${sequenceId}/toggle-status`, adminCookie, adminCsrf, {});
    assert(seqPause.status === 200 && seqPause.json?.status === "paused", `pause active sequence -> paused (got ${seqPause.status}/${seqPause.json?.status})`);

    const seqManagerForbidden = await api("PUT", `/api/sequences/${sequenceId}/toggle-status`, managerCookie, managerCsrf, {});
    assert(seqManagerForbidden.status === 403, `non-owning manager toggling admin's sequence -> 403 (got ${seqManagerForbidden.status})`);

    const seqNotFound = await api("PUT", "/api/sequences/999999999/toggle-status", adminCookie, adminCsrf, {});
    assert(seqNotFound.status === 404, `toggle unknown sequence id -> 404 (got ${seqNotFound.status})`);
  } finally {
    if (sequenceId) await db.delete(followUpSequences).where(eq(followUpSequences.id, sequenceId));
    if (campaignId) await db.delete(campaigns).where(eq(campaigns.id, campaignId));
  }

  console.log(failures === 0 ? "\n\u2713 All campaign/sequence toggle-status assertions passed" : `\n\u2717 ${failures} assertion(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
