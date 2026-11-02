import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { followUpSequences, sequenceSteps } from "../../shared/schema";
import { auditChange } from "./audit-change";
import { lintLinks, lintRules } from "./message-copy-lint";
import { FIRST_PARTY_BOOK_URL, SECURE_UPLOAD_URL, SITE_ORIGIN } from "./message-cta-contract";
import { LINK_RECONCILIATION_STEPS, retargetSalesWidgetLinks, type LinkRetarget } from "./stored-sequence-link-targets";

/**
 * Stage 4C1 stored-copy adoption for installed sequence steps (R04).
 *
 * Seeds and code never rewrite installed rows, so corrected wording for reusable sequence steps has to be adopted
 * through a guarded owner. This is that owner:
 *   - every target is identified by sequence id AND name, step order and channel, never by name alone;
 *   - every edit is an exact-substring replacement, so wording an operator already changed is left untouched and
 *     reported as a conflict, and a second run is a no-op;
 *   - nothing is applied unless the caller supplies the plan hash of the preview it reviewed;
 *   - sequences that are not paused/draft, are retired, or belong to a current SFP package are refused;
 *   - only the step's subject and body change. No status, enrollment, delay or channel is touched, and nothing is
 *     scheduled or sent.
 */

/** `layered` marks an edit that matches wording produced by an earlier edit of the same target (a later review
 *  revision); it is applied after the earlier edits, so both fresh installs and already-adopted rows converge. */
interface Edit { from: string; to: string; layered?: boolean }
interface StepTarget {
  sequenceId: number;
  sequenceName: string;
  stepOrder: number;
  channel: "email" | "sms";
  /** What the CTA does after the edit (documentation for the review map). */
  intent: string;
  subject?: Edit[];
  body: Edit[];
  /** Link-only reconciliation by purpose (see stored-sequence-link-targets.ts); applied after the body edits. */
  retarget?: LinkRetarget;
}

const BTN = "display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;";
const WIDGET = "https://api.leadconnectorhq.com/widget/bookings/libertybancard";
const upload = SECURE_UPLOAD_URL;

export type { Edit as StoredCopyEdit };
export const STORED_SEQUENCE_COPY_TARGETS: readonly StepTarget[] = [
  {
    sequenceId: 36, sequenceName: "20. Free Analysis Follow-Up", stepOrder: 4, channel: "email", intent: "secure statement upload; no savings figure",
    subject: [{ from: "your savings estimate is ready", to: "your free analysis summary" }],
    body: [
      { from: "<li><strong>Estimated Annual Savings:</strong> {{estimatedSavings}}</li>", to: "" },
      {
        from: "These numbers are based on industry averages for your business type. To get an exact breakdown, upload a recent processing statement and we'll show you line by line where you're overpaying.",
        to: "This is a summary of what you told us, not a savings quote. To get an exact breakdown, upload a recent processing statement and we'll show you line by line what you pay today.",
      },
      { from: `"${WIDGET}" style="${BTN}">Upload a Statement for Exact Savings`, to: `"${upload}" style="${BTN}">Upload a Statement for an Exact Breakdown` },
    ],
  },
  {
    sequenceId: 36, sequenceName: "20. Free Analysis Follow-Up", stepOrder: 8, channel: "email", intent: "reply for help; retired /terminals link; no recommendation or equipment-feature claims",
    subject: [{ from: "The right terminal for your business, {{firstName}}", to: "Equipment options for your business, {{firstName}}" }],
    body: [
      { from: "<li>Easy setup — most merchants are live in under an hour</li>", to: "" },
      {
        from: "<p>Right now, qualifying merchants can get a free terminal with signup — no hidden fees, no long-term contracts.</p>",
        to: "<p>Equipment options and any terms depend on your business and are confirmed during your review. Reply to this email and we'll walk through what fits.</p>",
      },
      { from: `<p><a href="${SITE_ORIGIN}/terminals" style="${BTN}">Browse Terminals &amp; Equipment</a></p>`, to: "" },
      // Review revision: no automatic terminal recommendation, feature list or fit claim without an approved source.
      {
        layered: true,
        from: "<p>Based on your business type and volume, we recommend the <strong>{{recommendedTerminal}}</strong>.</p><p>Here's why it's a great fit:</p><ul><li>Optimized for {{industry}} businesses</li><li>Supports tap, chip, swipe, and contactless payments</li><li>Built-in receipt printing and reporting</li></ul><p>Equipment options and any terms depend on your business and are confirmed during your review. Reply to this email and we'll walk through what fits.</p>",
        to: "<p>We can review your payment setup and explain equipment options that fit your requirements. Availability, pricing and terms are confirmed during your review, before you decide. Reply with the question you would like us to cover.</p>",
      },
    ],
  },
  {
    sequenceId: 36, sequenceName: "20. Free Analysis Follow-Up", stepOrder: 9, channel: "email", intent: "sales booking (review call); urgency, pricing and savings claims removed",
    subject: [{ from: "your estimate is about to expire", to: "next steps for your free analysis" }],
    body: [
      {
        from: "<p>Just a heads-up — the savings estimate we prepared for you is based on current interchange rates and our promotional pricing.</p><p>Here's what you get when you complete your application this week:</p><ul><li>Locked-in wholesale rates with no markup surprises</li><li>Free terminal ({{recommendedTerminal}}) with approved application</li><li>Waived setup and activation fees</li><li>Same-day or next-day funding available</li></ul><p>Your estimated annual savings of <strong>{{estimatedSavings}}</strong> is real money back in your pocket — but we can only guarantee this pricing for a limited time.</p>",
        to: "<p>Just following up on your free analysis. The next step is a statement review so we can give you exact numbers. Equipment options and any terms that apply are confirmed during that review.</p>",
      },
      { from: `"${WIDGET}" style="${BTN}">Complete Your Application Now`, to: `"${FIRST_PARTY_BOOK_URL}" style="${BTN}">Choose a Time to Talk` },
    ],
  },
  {
    sequenceId: 84, sequenceName: "Switch & Save (Core Sales)", stepOrder: 2, channel: "sms", intent: "secure statement upload; no savings figure",
    body: [{
      from: `we can usually find {{estimatedSavings}} in savings vs. your current processor. Upload a statement for a free exact breakdown: ${WIDGET}`,
      to: `upload a statement for a free, no-obligation review of what you pay today: ${upload}`,
    }],
  },
  {
    sequenceId: 84, sequenceName: "Switch & Save (Core Sales)", stepOrder: 3, channel: "email", intent: "sales booking; call length not stated",
    body: [
      { from: `"${WIDGET}" style="${BTN}">Book a 10-Minute Call`, to: `"${FIRST_PARTY_BOOK_URL}" style="${BTN}">Book a Call` },
      // Review revision: no go-live promise. Timing depends on the application, underwriting and setup.
      {
        from: "<li>Most merchants are live within 3–5 business days</li>",
        to: "<li>Timing depends on the application, underwriting, processor and setup requirements. We'll confirm the next steps and expected timing for your business.</li>",
      },
    ],
  },
  ...[1, 3, 5].map((stepOrder): StepTarget => ({
    sequenceId: 85, sequenceName: "W6 — Cold Outreach: Email + Manual Call", stepOrder, channel: "email", intent: "secure statement upload",
    body: [{ from: `href="${SITE_ORIGIN}/upload"`, to: `href="${upload}"` }],
  })),
  ...[1, 3].map((stepOrder): StepTarget => ({
    sequenceId: 86, sequenceName: "W6 — Inbound Lead: No PEWC", stepOrder, channel: "email", intent: "secure statement upload",
    body: [{ from: `href="${SITE_ORIGIN}/upload"`, to: `href="${upload}"` }],
  })),
  {
    sequenceId: 91, sequenceName: "W6 — Application Abandoned", stepOrder: 1, channel: "email", intent: "reply for help (no scoped continuation link exists)",
    body: [
      { from: " You're close — most approvals take minutes once submitted.", to: "" },
      { from: ` Reply here or use the link below.</p><p><a href="${SITE_ORIGIN}/apply">Complete My Application</a></p>`, to: " Just reply here and we'll help.</p>" },
    ],
  },
  {
    sequenceId: 91, sequenceName: "W6 — Application Abandoned", stepOrder: 2, channel: "sms", intent: "reply for help (no scoped continuation link exists)",
    body: [{ from: "Happy to help finish it so approval goes fast. Reply HELP or visit libertybancard.com/apply.", to: "Happy to help you finish it. Reply HELP and we'll reach out." }],
  },
  {
    sequenceId: 91, sequenceName: "W6 — Application Abandoned", stepOrder: 4, channel: "email", intent: "reply for help (no scoped continuation link exists)",
    body: [{ from: `<p><a href="${SITE_ORIGIN}/apply">Complete My Application</a></p>`, to: "<p>Reply to this email and we'll get started together.</p>" }],
  },
  {
    sequenceId: 93, sequenceName: "W6 — Merchant Referral Program", stepOrder: 1, channel: "email", intent: "reply for referral-program details (no merchant-referral page exists; no credit promise)",
    body: [
      {
        from: `<p><a href="${SITE_ORIGIN}/refer">Learn About Our Referral Program</a></p>`,
        to: "<p>If someone comes to mind, just reply to this email with their name and we'll take it from there.</p>",
      },
      // Review revision: no referral-credit promise and no request for another person's details before eligibility
      // and terms have been explained.
      {
        layered: true,
        from: " As a thank-you, we offer a referral credit for every merchant who signs on through your recommendation.</p><p>If someone comes to mind, just reply to this email with their name and we'll take it from there.</p>",
        to: "</p><p>Reply for the current referral-program details. We'll explain any eligibility and terms before a referral is submitted.</p>",
      },
    ],
  },
  ...[1, 3].map((stepOrder): StepTarget => ({
    sequenceId: 94, sequenceName: "W6 — Partner Referral Sequence", stepOrder, channel: "email", intent: "partner portal entry",
    body: [{ from: `href="${SITE_ORIGIN}/partners/portal"`, to: `href="${SITE_ORIGIN}/partner-portal"` }],
  })),
];

/** Booking-widget links reconciled by step purpose. Only the address changes; the plan row reports no wording findings. */
export const STORED_SEQUENCE_LINK_TARGETS: readonly StepTarget[] = LINK_RECONCILIATION_STEPS.flatMap(([sequenceId, sequenceName, steps]) =>
  steps.map(([stepOrder, channel, retarget]): StepTarget => ({
    sequenceId, sequenceName, stepOrder, channel, retarget, body: [],
    intent: retarget === "book" ? "sales calendar: sales widget address -> first-party /book (shared sales resolver)" : "secure statement upload (the label said upload; the link opened the sales calendar)",
  })));

export const ALL_STORED_SEQUENCE_TARGETS: readonly StepTarget[] = [...STORED_SEQUENCE_COPY_TARGETS, ...STORED_SEQUENCE_LINK_TARGETS];

export type StepAdoptionStatus = "ready" | "already_current" | "conflict" | "missing" | "blocked";

export interface StepPlanRow {
  key: string;
  sequenceId: number;
  sequenceName: string;
  stepOrder: number;
  channel: string;
  stepId?: number;
  status: StepAdoptionStatus;
  reason?: string;
  intent: string;
  oldHash?: string;
  newHash?: string;
  remainingFindings: string[];
}

export interface StepAdoptionPlan {
  rows: StepPlanRow[];
  counts: Record<StepAdoptionStatus, number>;
  planHash: string;
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

function editText(text: string, edits: Edit[]): string {
  let out = text;
  for (const e of edits) if (e.from && out.includes(e.from)) out = out.split(e.from).join(e.to);
  return out;
}

export function planStepCopy(target: StepTarget, current: { subject: string | null; body: string | null }): {
  subject: string | null; body: string | null; changed: boolean; allApplied: boolean;
} {
  const edited = editText(current.body ?? "", target.body);
  const body = target.retarget ? retargetSalesWidgetLinks(edited, target.channel, target.retarget) : edited;
  const subject = target.subject ? editText(current.subject ?? "", target.subject) : current.subject;
  const changed = body !== (current.body ?? "") || subject !== current.subject;
  return { subject, body, changed, allApplied: !target.body.some((e) => (current.body ?? "").includes(e.from)) || changed };
}

function findings(subject: string | null, body: string | null): string[] {
  const text = `${subject ?? ""}\n${body ?? ""}`;
  return [...new Set([...lintRules(text), ...lintLinks(text)].map((f) => f.rule))];
}

const targetKey = (t: StepTarget) => `${t.sequenceId}:${t.stepOrder}:${t.channel}`;

async function pinnedSequenceIds(client: { execute: typeof db.execute }): Promise<Set<number>> {
  const r: any = await client.execute(sql`SELECT sequence_id FROM sfp_campaign_package_versions WHERE lifecycle_state='current' AND sequence_id IS NOT NULL`);
  return new Set(((r?.rows ?? r ?? []) as Array<{ sequence_id: number }>).map((x) => Number(x.sequence_id)));
}

/** Read-only. Produces the exact per-step plan and a hash that binds an apply to what was reviewed. */
export async function previewStoredSequenceCopyAdoption(): Promise<StepAdoptionPlan> {
  const ids = [...new Set(ALL_STORED_SEQUENCE_TARGETS.map((t) => t.sequenceId))];
  const rows: StepPlanRow[] = [];
  const pinned = await pinnedSequenceIds(db);
  const sequences = new Map<number, typeof followUpSequences.$inferSelect>();
  const steps: Array<typeof sequenceSteps.$inferSelect> = [];
  for (const id of ids) {
    const [seq] = await db.select().from(followUpSequences).where(eq(followUpSequences.id, id));
    if (seq) sequences.set(id, seq);
    steps.push(...await db.select().from(sequenceSteps).where(eq(sequenceSteps.sequenceId, id)));
  }
  for (const target of ALL_STORED_SEQUENCE_TARGETS) {
    const base = { key: targetKey(target), sequenceId: target.sequenceId, sequenceName: target.sequenceName, stepOrder: target.stepOrder, channel: target.channel, intent: target.intent };
    const seq = sequences.get(target.sequenceId);
    if (!seq || seq.name !== target.sequenceName) { rows.push({ ...base, status: "missing", reason: seq ? "Sequence id exists under a different name; not touched" : "Sequence not found", remainingFindings: [] }); continue; }
    const step = steps.find((s) => s.sequenceId === target.sequenceId && s.stepOrder === target.stepOrder && s.actionType === target.channel);
    if (!step) { rows.push({ ...base, status: "missing", reason: "Step not found at this order and channel", remainingFindings: [] }); continue; }
    const plan = planStepCopy(target, step);
    const oldHash = sha(`${step.subject ?? ""}\n${step.body ?? ""}`);
    if (!plan.changed) {
      const remaining = target.retarget ? [] : findings(step.subject, step.body);
      rows.push({ ...base, stepId: step.id, oldHash, status: remaining.length ? "conflict" : "already_current", reason: remaining.length ? "Live wording differs from the reviewed baseline and still has audited findings; not overwritten" : undefined, remainingFindings: remaining });
      continue;
    }
    const remaining = target.retarget ? [] : findings(plan.subject, plan.body);
    let blocked: string | undefined;
    if (seq.retiredAt) blocked = "Sequence is retired";
    else if (!["paused", "draft"].includes(seq.status ?? "")) blocked = `Sequence is ${seq.status}; pause it before its steps can change`;
    else if (pinned.has(seq.id)) blocked = "Sequence belongs to a current SFP package; use package publication";
    rows.push({ ...base, stepId: step.id, oldHash, newHash: sha(`${plan.subject ?? ""}\n${plan.body ?? ""}`), status: blocked ? "blocked" : "ready", reason: blocked, remainingFindings: remaining });
  }
  const counts = { ready: 0, already_current: 0, conflict: 0, missing: 0, blocked: 0 } as Record<StepAdoptionStatus, number>;
  for (const r of rows) counts[r.status]++;
  const planHash = sha(JSON.stringify(rows.map((r) => [r.key, r.status, r.oldHash ?? "", r.newHash ?? ""])));
  return { rows, counts, planHash };
}

export class SequenceCopyAdoptionError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export interface StepAdoptionResult { applied: string[]; skipped: Array<{ key: string; reason: string }>; plan: StepAdoptionPlan }

/**
 * Applies only the rows that were `ready` in the reviewed preview. Each step is re-read under its sequence lock and
 * its wording must still match the reviewed hash; anything that moved is skipped and reported, never overwritten.
 */
export async function applyStoredSequenceCopyAdoption(expectedPlanHash: string, actorId: string): Promise<StepAdoptionResult> {
  const plan = await previewStoredSequenceCopyAdoption();
  if (!expectedPlanHash || plan.planHash !== expectedPlanHash) {
    throw new SequenceCopyAdoptionError(409, "PLAN_STALE", "The stored wording changed since this plan was previewed. Preview again and review it.");
  }
  const applied: string[] = [];
  const skipped: Array<{ key: string; reason: string }> = [];
  let failure: unknown;
  for (const row of plan.rows) {
    if (row.status !== "ready" || !row.stepId) { if (row.status !== "already_current") skipped.push({ key: row.key, reason: row.reason ?? row.status }); continue; }
    const target = ALL_STORED_SEQUENCE_TARGETS.find((t) => targetKey(t) === row.key)!;
    try {
      await db.transaction(async (tx) => {
        const [seq] = await tx.select().from(followUpSequences).where(eq(followUpSequences.id, row.sequenceId)).for("update");
        if (!seq || seq.name !== row.sequenceName || seq.retiredAt || !["paused", "draft"].includes(seq.status ?? "")) {
          throw new SequenceCopyAdoptionError(409, "SEQUENCE_STATE", "Sequence is no longer a paused/draft sequence");
        }
        if ((await pinnedSequenceIds(tx)).has(seq.id)) throw new SequenceCopyAdoptionError(409, "PINNED", "Sequence belongs to a current SFP package");
        const [step] = await tx.select().from(sequenceSteps).where(and(eq(sequenceSteps.id, row.stepId!), eq(sequenceSteps.sequenceId, seq.id))).for("update");
        if (!step || sha(`${step.subject ?? ""}\n${step.body ?? ""}`) !== row.oldHash) throw new SequenceCopyAdoptionError(409, "STEP_CHANGED", "Step wording changed after the preview");
        const next = planStepCopy(target, step);
        if (!next.changed || sha(`${next.subject ?? ""}\n${next.body ?? ""}`) !== row.newHash) throw new SequenceCopyAdoptionError(409, "STEP_CHANGED", "Step no longer produces the reviewed wording");
        await tx.update(sequenceSteps).set({ subject: next.subject, body: next.body }).where(eq(sequenceSteps.id, step.id));
        await tx.update(followUpSequences).set({ version: seq.version + 1, updatedAt: new Date() }).where(eq(followUpSequences.id, seq.id));
        // The receipt commits or rolls back with the wording and version change, so no step can change without its
        // own durable record (and a failed receipt leaves this step exactly as it was).
        await auditChange({
          actorType: "user", actorId, action: "stored_sequence_step_copy_adopted", entityType: "sequence_step", entityId: step.id,
          entityKey: row.key,
          before: { wordingDigest: row.oldHash, sequenceVersion: seq.version },
          after: { wordingDigest: row.newHash, sequenceVersion: seq.version + 1 },
          details: {
            planHash: plan.planHash, key: row.key, sequenceId: seq.id, sequenceName: seq.name, stepOrder: row.stepOrder, channel: row.channel,
            intent: row.intent, source: "Stage 4C1 reviewed stored-copy adoption", notes: "Subject/body only; no status, enrollment or send change.",
          },
        }, tx);
      });
      applied.push(row.key);
    } catch (err: any) {
      if (err instanceof SequenceCopyAdoptionError) { skipped.push({ key: row.key, reason: err.message }); continue; }
      // Anything else (for example a receipt that could not be written) rolled this step back. Stop here: steps already
      // applied keep their own receipts, the rest are untouched, and a fresh preview reports exactly which is which.
      failure = err;
      break;
    }
  }
  if (applied.length) {
    // Batch summary only; the per-step receipts above are the durable evidence, so a failure here is not fatal.
    try {
      await auditChange({
        actorType: "user", actorId, action: "stored_sequence_copy_adoption", entityType: "message_copy",
        details: { planHash: plan.planHash, applied, skipped, interrupted: failure !== undefined, source: "Stage 4C1 R04 reviewed stored-copy adoption", notes: "Subject/body only; no status, enrollment or send change." },
      });
    } catch (summaryErr) {
      console.error("[stored-sequence-copy-adoption] batch summary audit failed; per-step receipts are durable", summaryErr);
    }
  }
  if (failure !== undefined) throw failure;
  return { applied, skipped, plan };
}
