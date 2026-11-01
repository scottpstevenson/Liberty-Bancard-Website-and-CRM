/**
 * Paired campaign + sequence content publication for a current SFP package.
 *
 * One command rewrites the package's home campaign steps and sequence steps together, in one transaction, and pins a NEW
 * immutable package version (new content hash) in place of the previous current one. It never:
 *   - activates, enrolls, queues, sends or books anything;
 *   - changes a campaign/sequence status or the package's home identity (rows are rewritten in place by step order);
 *   - touches a package whose journeys already started or whose sequence has active enrollments.
 *
 * Safety checks (all under the same locks the staging/preparation lanes use, in the fixed order of
 * lockLivePackageContentRows):
 *   stale hash       the caller names the package version and content hash it edited; any other live state is a 409.
 *   started journeys any enrollment that is not paused-at-step-0 refuses publication (never append to a started journey).
 *   draft/paused     the home campaign must be a draft and the sequence paused, as the other package writers require.
 *   content          3 or 5 touches, relative delays, supported tokens only, no unsupported claims or unsafe/literal links,
 *                    and the shared launch-readiness guard after the write (a failure rolls the transaction back).
 *   replay           identical steps against an already-matching live hash change nothing and report replayed.
 * Content approval is invalidated by bumping content_revision and clearing approved_revision.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { auditChange } from "../audit-change";
import { FIRST_PARTY_BOOK_URL, resolveSalesBooking } from "../message-cta-contract";
import { lintLinks, lintRules } from "../message-copy-lint";
import { claimProblems } from "./sfp-premium-drafts";
import { SFP_PACKAGE_KEYS_V2, computeLivePackageContentHash, lockLivePackageContentRows, type SfpPackageKeyV2 } from "./sfp-campaign-packages";
import { SFP_LAUNCH_CONTENT_VERSION, SFP_SECURE_UPLOAD_URL, checkPackageContentReadiness } from "./sfp-launch-content";
import { SFP_LAUNCH_PRESENTATION_VERSION } from "./sfp-launch-presentation";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

export class PackagePublishError extends Error {
  constructor(public status: number, public code: string, message: string, public detail?: unknown) { super(message); }
}

export interface PackageTouchInput {
  subject: string;
  /** Plain text. May contain the markers [secure_statement_upload] and [sales_booking], resolved here to the approved links. */
  body: string;
  /** Relative delay in days after the previous touch (the first touch is always 0). */
  delayDays: number;
}

export interface PublishPackageInput {
  packageKey: string;
  expectedVersionId: string;
  expectedContentHash: string;
  touches: PackageTouchInput[];
  actorId: string;
}

export const PACKAGE_TOUCH_COUNTS = [3, 5] as const;
const MAX_DELAY_DAYS = 60;
const MARKERS: Record<string, string> = { "[secure_statement_upload]": SFP_SECURE_UPLOAD_URL, "[sales_booking]": FIRST_PARTY_BOOK_URL };

export interface ValidatedTouch { stepOrder: number; touch: "intro" | "follow_up" | "close_loop"; subject: string; body: string; delayDays: number }

/** Pure validation and marker resolution. Returns the exact rows that would be written, or the problems. */
export function validatePackageTouches(
  touches: PackageTouchInput[],
  opts: { bookingAvailable: boolean },
): { ok: true; steps: ValidatedTouch[] } | { ok: false; problems: Array<{ touch: number | null; problem: string }> } {
  const problems: Array<{ touch: number | null; problem: string }> = [];
  const add = (touch: number | null, problem: string) => problems.push({ touch, problem });
  if (!Array.isArray(touches) || !(PACKAGE_TOUCH_COUNTS as readonly number[]).includes(touches.length)) {
    return { ok: false, problems: [{ touch: null, problem: `a package has ${PACKAGE_TOUCH_COUNTS.join(" or ")} touches, got ${Array.isArray(touches) ? touches.length : 0}` }] };
  }
  const steps: ValidatedTouch[] = touches.map((t, i) => {
    const n = i + 1;
    const subject = String(t?.subject ?? "").trim();
    let body = String(t?.body ?? "").replace(/\r\n/g, "\n").trim();
    const delayDays = Number(t?.delayDays);
    if (!subject) add(n, "subject is empty");
    if (subject.length > 200) add(n, "subject is longer than 200 characters");
    if (!body) add(n, "body is empty");
    if (body.length > 8000) add(n, "body is longer than 8000 characters");
    if (!Number.isInteger(delayDays) || delayDays < 0 || delayDays > MAX_DELAY_DAYS) add(n, `relative delay must be a whole number of days from 0 to ${MAX_DELAY_DAYS}`);
    else if (i === 0 && delayDays !== 0) add(n, "the first touch has no delay");
    else if (i > 0 && delayDays < 1) add(n, "each follow-up waits at least one day after the previous touch");
    for (const [marker, url] of Object.entries(MARKERS)) {
      if (!body.includes(marker)) continue;
      if (marker === "[sales_booking]" && !opts.bookingAvailable) add(n, "the sales booking link is not configured, so a booking CTA cannot be published");
      if (i === 0 && marker === "[secure_statement_upload]") add(n, "the first touch asks for a reply; the secure upload link belongs to follow-ups");
      body = body.split(marker).join(url);
    }
    if (/\[[a-z_]+\]/i.test(body)) add(n, "unresolved bracket marker");
    const text = `${subject}\n${body}`;
    for (const f of [...lintRules(text), ...lintLinks(text)]) add(n, `${f.rule}: ${f.match}`);
    for (const label of claimProblems(text)) add(n, `unsupported claim: ${label}`);
    const touch = i === 0 ? "intro" : i === touches.length - 1 ? "close_loop" : "follow_up";
    return { stepOrder: n, touch, subject, body, delayDays: Number.isFinite(delayDays) ? delayDays : 0 } as ValidatedTouch;
  });
  return problems.length ? { ok: false, problems } : { ok: true, steps };
}

/** Cumulative send day for each relative delay (day 0, 3, 8 for delays 0, 3, 5). Scheduling windows still apply at send time. */
export function cumulativeDays(delays: number[]): number[] {
  let total = 0;
  return delays.map((d, i) => (i === 0 ? 0 : (total += d)));
}

export interface PackageEditState {
  packageKey: string; versionId: string; contentHash: string; vertical: string;
  campaignId: number; sequenceId: number; campaignStatus: string; sequenceStatus: string;
  startedJourneys: number; activeEnrollments: number;
  editable: boolean; refusals: string[];
  steps: Array<{ stepOrder: number; subject: string; body: string; delayDays: number; cumulativeDay: number }>;
}

const isKey = (k: string): k is SfpPackageKeyV2 => (SFP_PACKAGE_KEYS_V2 as string[]).includes(k);

/** Read-only: the current version a draft would be published against, plus every reason publication would be refused now. */
export async function getPackageEditState(packageKey: string): Promise<PackageEditState | null> {
  if (!isKey(packageKey)) return null;
  const pkg = rows(await db.execute(sql`
    SELECT id::text AS id, vertical, campaign_id, sequence_id, content_hash FROM sfp_campaign_package_versions
     WHERE package_key=${packageKey} AND lifecycle_state='current' LIMIT 1`))[0];
  if (!pkg) return null;
  const campaignId = Number(pkg.campaign_id), sequenceId = Number(pkg.sequence_id);
  const camp = rows(await db.execute(sql`SELECT status FROM campaigns WHERE id=${campaignId}`))[0];
  const seq = rows(await db.execute(sql`SELECT status FROM follow_up_sequences WHERE id=${sequenceId}`))[0];
  const enr = rows(await db.execute(sql`
    SELECT count(*) FILTER (WHERE status<>'paused' OR coalesce(current_step,0)<>0)::int AS started,
           count(*) FILTER (WHERE status='active')::int AS active
      FROM sequence_enrollments WHERE sequence_id=${sequenceId}`))[0];
  const steps = rows(await db.execute(sql`SELECT step_order, subject, body, delay_days FROM sequence_steps WHERE sequence_id=${sequenceId} ORDER BY step_order`));
  const days = cumulativeDays(steps.map((s) => Number(s.delay_days ?? 0)));
  const refusals: string[] = [];
  if (camp?.status !== "draft") refusals.push(`campaign is ${camp?.status ?? "missing"}, not draft`);
  if (seq?.status !== "paused") refusals.push(`sequence is ${seq?.status ?? "missing"}, not paused`);
  if (Number(enr?.started ?? 0) > 0) refusals.push(`${enr.started} journey(s) already started`);
  if (Number(enr?.active ?? 0) > 0) refusals.push(`${enr.active} active enrollment(s)`);
  return {
    packageKey, versionId: String(pkg.id), contentHash: String(pkg.content_hash), vertical: String(pkg.vertical), campaignId, sequenceId,
    campaignStatus: String(camp?.status ?? ""), sequenceStatus: String(seq?.status ?? ""),
    startedJourneys: Number(enr?.started ?? 0), activeEnrollments: Number(enr?.active ?? 0),
    editable: refusals.length === 0, refusals,
    steps: steps.map((s, i) => ({ stepOrder: Number(s.step_order), subject: String(s.subject ?? ""), body: String(s.body ?? ""), delayDays: Number(s.delay_days ?? 0), cumulativeDay: days[i] })),
  };
}

export type PublishPackageResult =
  | { status: "published"; packageVersionId: string; supersededVersionId: string; contentHash: string; touches: number }
  | { status: "replayed"; packageVersionId: string; contentHash: string; touches: number };

export async function publishPackageContent(input: PublishPackageInput): Promise<PublishPackageResult> {
  if (!isKey(input.packageKey)) throw new PackagePublishError(404, "PACKAGE_UNKNOWN", "Unknown package");
  const bookingAvailable = resolveSalesBooking(process.env as Record<string, string | undefined>).available;
  const checked = validatePackageTouches(input.touches, { bookingAvailable });
  if (!checked.ok) throw new PackagePublishError(422, "PACKAGE_CONTENT_INVALID", "The draft did not pass the content checks", checked.problems);
  const drafts = checked.steps;
  const packageKey = input.packageKey;

  return db.transaction(async (tx) => {
    const pkg = rows(await tx.execute(sql`
      SELECT id::text AS id, vertical, campaign_id, sequence_id, sequence_family, content_hash, notes
        FROM sfp_campaign_package_versions WHERE package_key=${packageKey} AND lifecycle_state='current' FOR UPDATE`))[0];
    // Under READ COMMITTED a publish that waited on this row sees it superseded and gets no row back: the version it
    // edited is gone, which is the same stale condition as a hash mismatch.
    if (!pkg) throw new PackagePublishError(409, "PACKAGE_STALE", "The package changed after this draft was started (its version is no longer current). Reload it before publishing.");
    if (String(pkg.id) !== input.expectedVersionId || String(pkg.content_hash) !== input.expectedContentHash) {
      throw new PackagePublishError(409, "PACKAGE_STALE", "The package changed after this draft was started. Reload it before publishing.",
        { currentVersionId: String(pkg.id), currentContentHash: String(pkg.content_hash) });
    }
    const home = rows(await tx.execute(sql`
      SELECT campaign_id,campaign_name,sequence_id,sequence_name FROM sfp_campaign_package_versions
       WHERE package_key=${packageKey} ORDER BY created_at ASC, id ASC LIMIT 1`))[0];
    const campaignId = Number(home.campaign_id), sequenceId = Number(home.sequence_id);
    if (Number(pkg.campaign_id) !== campaignId || Number(pkg.sequence_id) !== sequenceId) {
      throw new PackagePublishError(409, "PACKAGE_NOT_AT_HOME", "The package is pinned to a copy of its home campaign/sequence; return it home before editing");
    }
    const { campaign, sequence } = await lockLivePackageContentRows(tx, campaignId, sequenceId);
    if (campaign.status !== "draft") throw new PackagePublishError(409, "CAMPAIGN_NOT_DRAFT", `Campaign is ${campaign.status}, not draft`);
    if (sequence.status !== "paused") throw new PackagePublishError(409, "SEQUENCE_NOT_PAUSED", `Sequence is ${sequence.status}, not paused`);
    const started = Number(rows(await tx.execute(sql`
      SELECT count(*)::int n FROM sequence_enrollments WHERE sequence_id=${sequenceId} AND (status<>'paused' OR coalesce(current_step,0)<>0)`))[0]?.n ?? 0);
    if (started > 0) throw new PackagePublishError(409, "PACKAGE_HAS_STARTED_JOURNEYS", `${started} journey(s) already started on this sequence; steps are never changed under them`, { started });

    const liveHash = await computeLivePackageContentHash(tx, campaignId, sequenceId);
    if (liveHash !== String(pkg.content_hash)) {
      throw new PackagePublishError(409, "PACKAGE_LIVE_DRIFT", "Live steps differ from the pinned version (an edit nobody published). Review before publishing.", { currentContentHash: liveHash });
    }

    const existing = rows(await tx.execute(sql`SELECT step_order,action_type,subject,body,delay_days,delay_hours FROM sequence_steps WHERE sequence_id=${sequenceId} ORDER BY step_order`));
    const same = existing.length === drafts.length && drafts.every((d, i) =>
      existing[i].subject === d.subject && existing[i].body === d.body && Number(existing[i].delay_days) === d.delayDays && existing[i].action_type === "email");
    if (same) return { status: "replayed" as const, packageVersionId: String(pkg.id), contentHash: String(pkg.content_hash), touches: drafts.length };

    const campaignSteps = rows(await tx.execute(sql`SELECT step_order FROM campaign_steps WHERE campaign_id=${campaignId}`)).map((r) => Number(r.step_order));
    for (const d of drafts) {
      const stepType = d.touch === "intro" ? "initial_outreach" : d.touch === "follow_up" ? "follow_up" : "breakup";
      if (campaignSteps.includes(d.stepOrder)) {
        await tx.execute(sql`UPDATE campaign_steps SET step_type=${stepType},delay_days=${d.delayDays},subject=${d.subject},body_template=${d.body},use_ai_personalization=FALSE,channel='email'
          WHERE campaign_id=${campaignId} AND step_order=${d.stepOrder}`);
      } else {
        await tx.execute(sql`INSERT INTO campaign_steps (campaign_id,step_order,step_type,delay_days,subject,body_template,use_ai_personalization,channel)
          VALUES (${campaignId},${d.stepOrder},${stepType},${d.delayDays},${d.subject},${d.body},FALSE,'email')`);
      }
      const config = JSON.stringify({ format: "plain_text", contentVersion: SFP_LAUNCH_CONTENT_VERSION, presentationVersion: SFP_LAUNCH_PRESENTATION_VERSION, touch: d.touch, source: { operatorPublished: true } });
      if (existing.some((e) => Number(e.step_order) === d.stepOrder)) {
        await tx.execute(sql`UPDATE sequence_steps SET action_type='email',delay_days=${d.delayDays},delay_hours=0,subject=${d.subject},body=${d.body},config=${config}::jsonb
          WHERE sequence_id=${sequenceId} AND step_order=${d.stepOrder}`);
      } else {
        await tx.execute(sql`INSERT INTO sequence_steps (sequence_id,step_order,action_type,delay_days,delay_hours,subject,body,config)
          VALUES (${sequenceId},${d.stepOrder},'email',${d.delayDays},0,${d.subject},${d.body},${config}::jsonb)`);
      }
    }
    // Shortening (five to three touches) is safe only because no journey has started: nothing references the removed steps.
    await tx.execute(sql`DELETE FROM campaign_steps WHERE campaign_id=${campaignId} AND step_order>${drafts.length}`);
    await tx.execute(sql`DELETE FROM sequence_steps WHERE sequence_id=${sequenceId} AND step_order>${drafts.length}`);
    await tx.execute(sql`UPDATE campaigns SET total_steps=${drafts.length}, content_revision=COALESCE(content_revision,1)+1, approved_revision=NULL, updated_at=NOW() WHERE id=${campaignId}`);
    await tx.execute(sql`UPDATE follow_up_sequences SET total_steps=${drafts.length} WHERE id=${sequenceId}`);

    const after = await checkPackageContentReadiness(tx, campaignId, sequenceId);
    if (!after.ok) throw new PackagePublishError(422, "PACKAGE_NOT_READY", "The published steps did not pass the launch-readiness guard", after.issues);

    const contentHash = await computeLivePackageContentHash(tx, campaignId, sequenceId);
    await tx.execute(sql`UPDATE sfp_campaign_package_versions SET lifecycle_state='superseded',superseded_at=NOW(),updated_at=NOW() WHERE id=${String(pkg.id)}::uuid`);
    const inserted = rows(await tx.execute(sql`
      INSERT INTO sfp_campaign_package_versions
        (package_key,vertical,campaign_id,campaign_name,sequence_id,sequence_name,sequence_family,content_hash,lifecycle_state,effective_at,actor_id,notes)
      VALUES (${packageKey},${pkg.vertical},${campaignId},${String(home.campaign_name)},${sequenceId},${String(home.sequence_name)},${pkg.sequence_family},${contentHash},
              'current',NOW(),${input.actorId},${JSON.stringify({
                // Same content version as the launch populator so it treats these steps as drift and never overwrites them.
                contentVersion: SFP_LAUNCH_CONTENT_VERSION, presentationVersion: SFP_LAUNCH_PRESENTATION_VERSION,
                operatorPublished: true, supersedes: String(pkg.id), touches: drafts.length, delays: drafts.map((d) => d.delayDays),
              })})
      RETURNING id::text AS id`))[0];
    await auditChange({
      userId: input.actorId, action: "sfp_package_content_published", entityType: "sfp_campaign_package", entityId: campaignId, entityKey: packageKey,
      before: { versionId: String(pkg.id), contentHash: String(pkg.content_hash), touches: existing.length },
      after: { versionId: String(inserted.id), contentHash, touches: drafts.length },
      details: { campaignId, sequenceId, delays: drafts.map((d) => d.delayDays), contentApprovalInvalidated: true, sendOrActivationEffect: false },
    }, tx);
    return { status: "published" as const, packageVersionId: String(inserted.id), supersededVersionId: String(pkg.id), contentHash, touches: drafts.length };
  });
}
