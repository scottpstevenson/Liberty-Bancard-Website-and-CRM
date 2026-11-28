import { pool } from "../db";
import type { QualifiedReadyHeldRecipient } from "./sfp-launch-inventory";
import { verifyRecipientBinding } from "./sfp-launch-inventory";
import { previewSfpStepForRecipient, type StepPreviewResult } from "./message-final-preview";
import { resolveSalesBooking } from "./message-cta-contract";
import { PREMIUM_SFP_DRAFTS, resolveDraftBody } from "./cro03/sfp-premium-drafts";
import { SFP_LAUNCH_SEQUENCE_FAMILY_PREFIX } from "./cro03/sfp-launch-content";

export type ReleaseReviewCopy = "current" | "premium_draft";

export interface ReleaseReviewRecipient {
  enrollmentId: number;
  bindingHash: string;
  currentStep: number;
  name: string | null;
  email: string;
  business: string;
  county: string | null;
  vertical: string | null;
  sequence: string;
  kind: QualifiedReadyHeldRecipient["kind"];
}

export interface ReleaseReviewMessage extends StepPreviewResult {
  to: string;
  copy: ReleaseReviewCopy;
  stepOrder: number;
  steps: Array<{ stepOrder: number; day: number }>;
}

export class ReleaseReviewChangedError extends Error {
  constructor() {
    super("Recipient or sequence details changed. Preview the release again.");
  }
}

interface ReviewRow {
  enrollment_id: number;
  current_step: number;
  contact_id: number;
  sequence_id: number;
  intent_id: string;
  business_id: number;
  package_key: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  email: string;
  email_hash: string;
  email_generation: number | null;
  canonical_name: string;
  sequence_name: string;
  sequence_family: string | null;
}

async function readReviewRows(enrollmentIds: number[]): Promise<ReviewRow[]> {
  if (enrollmentIds.length === 0) return [];
  const { rows } = await pool.query<ReviewRow>(`
    SELECT e.id AS enrollment_id, coalesce(e.current_step, 0) AS current_step,
           i.id::text AS intent_id, i.contact_id, i.business_id, i.sequence_id,
           c.first_name, c.last_name, c.company_name, c.email, c.email_mutation_generation AS email_generation,
           encode(sha256(convert_to(lower(trim(c.email)), 'UTF8')), 'hex') AS email_hash,
           b.canonical_name, s.name AS sequence_name, s.sequence_family, pkg.package_key
      FROM sequence_enrollments e
      JOIN cr04_enrollment_intents i ON i.enrollment_id = e.id
        AND e.metadata->>'canonicalPreparationId' = i.id::text
        AND i.contact_id = e.contact_id AND i.sequence_id = e.sequence_id
      JOIN contacts c ON c.id = i.contact_id AND c.business_id = i.business_id
      JOIN businesses b ON b.id = i.business_id
      JOIN follow_up_sequences s ON s.id = i.sequence_id
      LEFT JOIN sfp_campaign_package_versions pkg ON pkg.sequence_id = i.sequence_id
        AND pkg.id::text = i.preparation_snapshot->>'packageVersionId' AND pkg.lifecycle_state = 'current'
     WHERE e.id = ANY($1::int[]) AND e.status = 'paused' AND i.preparation_state = 'ready_held'
  `, [enrollmentIds]);
  return rows;
}

/** In selection order, with only the details an administrator needs to review before release. */
export async function readReleaseReviewRecipients(chosen: QualifiedReadyHeldRecipient[]): Promise<ReleaseReviewRecipient[]> {
  const byId = new Map((await readReviewRows(chosen.map(r => r.enrollmentId))).map(row => [row.enrollment_id, row]));
  return chosen.map(r => {
    const row = byId.get(r.enrollmentId);
    if (!row || row.intent_id !== r.intentId || row.email_hash !== r.emailHash ||
        row.current_step !== r.currentStep || row.email_generation !== r.binding.emailGeneration ||
        row.contact_id !== r.contactId || row.business_id !== r.businessId || row.sequence_id !== r.sequenceId) {
      throw new ReleaseReviewChangedError();
    }
    return {
      enrollmentId: r.enrollmentId, bindingHash: r.bindingHash, currentStep: r.currentStep,
      name: [row.first_name?.trim(), row.last_name?.trim()].filter(Boolean).join(" ") || null,
      email: row.email, business: row.canonical_name, county: r.county, vertical: r.vertical,
      sequence: row.sequence_name, kind: r.kind,
    };
  });
}

export async function readReleaseReviewMessage(input: {
  enrollmentId: number; bindingHash: string; currentStep: number; copy: ReleaseReviewCopy; stepOrder?: number;
}): Promise<ReleaseReviewMessage> {
  const [initial] = await readReviewRows([input.enrollmentId]);
  if (!initial || initial.current_step !== input.currentStep) throw new ReleaseReviewChangedError();
  const { ok, binding } = await verifyRecipientBinding(initial.intent_id, input.bindingHash);
  const [row] = await readReviewRows([input.enrollmentId]);
  if (!ok || !binding || !row || row.intent_id !== binding.intentId ||
      row.email_hash !== binding.emailHash || row.email_generation !== binding.emailGeneration ||
      row.contact_id !== binding.contactId || row.business_id !== binding.businessId ||
      row.sequence_id !== binding.sequenceId || row.current_step !== input.currentStep) {
    throw new ReleaseReviewChangedError();
  }
  const stepOrder = input.stepOrder ?? row.current_step + 1;
  const result = (steps: ReleaseReviewMessage["steps"], preview: StepPreviewResult): ReleaseReviewMessage =>
    ({ to: row.email, copy: input.copy, stepOrder, steps, ...preview });
  const unavailable = (steps: ReleaseReviewMessage["steps"], detail: string) =>
    result(steps, { ok: false, final: null, error: { code: "RELEASE_MESSAGE_UNAVAILABLE", detail } });
  const recipient = { firstName: row.first_name, lastName: row.last_name, companyName: row.company_name, email: row.email };
  if (input.copy === "premium_draft") {
    const drafts = PREMIUM_SFP_DRAFTS.filter(d => d.family === row.package_key);
    const steps = drafts.map(d => ({ stepOrder: d.touch, day: d.day }));
    const draft = drafts.find(d => d.touch === stepOrder);
    if (!draft) return unavailable(steps, "A premium draft is unavailable for this sequence touch.");
    const resolved = resolveDraftBody(draft, { salesBooking: resolveSalesBooking(process.env) });
    if (resolved.body === null) return unavailable(steps, resolved.reason ?? "The draft link is unavailable.");
    return result(steps, await previewSfpStepForRecipient(draft.subject, resolved.body, recipient));
  }
  const current = await pool.query<{
    step_order: number; action_type: string; subject: string | null; body: string | null;
    delay_days: number | null; delay_hours: number | null; config: { format?: string } | null;
  }>(`SELECT step_order, action_type, subject, body, delay_days, delay_hours, config
         FROM sequence_steps WHERE sequence_id = $1 ORDER BY step_order, id`, [row.sequence_id]);
  let elapsedHours = 0;
  const steps = current.rows.map((s) => {
    elapsedHours += (s.delay_days ?? 0) * 24 + (s.delay_hours ?? 0);
    return { stepOrder: s.step_order, day: elapsedHours / 24 };
  });
  const step = current.rows.find(s => s.step_order === stepOrder);
  if (!step || step.action_type !== "email" || step.config?.format !== "plain_text" ||
      !row.sequence_family?.startsWith(SFP_LAUNCH_SEQUENCE_FAMILY_PREFIX)) {
    return unavailable(steps, "This sequence touch does not use the SFP email renderer.");
  }
  return result(steps, await previewSfpStepForRecipient(step.subject, step.body ?? "", recipient));
}
