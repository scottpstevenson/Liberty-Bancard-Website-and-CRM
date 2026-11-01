/**
 * Transport-aware final previews for sequence/campaign email steps.
 *
 * Each transport runs the composers the real send path uses, on sample data with reserved `.example` personas:
 *  - sfp_smtp       SFP launch renderer (plain-text step -> escaped HTML, one signature, logo) + the SMTP composer
 *                   (html AND text parts, sender-policy From/Reply-To, List-Unsubscribe headers).
 *  - gmail_non_cold sequence interpolation + one signature + the Gmail footer composer (HTML only, no text part).
 *  - ghl_conversations (stored templates / workflow steps) stays in message-template-versions.buildFinalEmailPreview.
 *
 * These are simulations: nothing is sent, stored, enqueued or booked, and the unsubscribe link is a sample.
 */
import { imagesOffHtml, type FinalMessagePreview } from "./message-template-versions";

export type StepPreviewTransport = "sfp_smtp" | "gmail_non_cold";
/** The asset's reviewed purpose picks the signature the send path appends: sales content signs as sales, account-management content as accounts. */
export type StepPreviewPurpose = "sales" | "account_management";

const SAMPLE = { firstName: "Alex", lastName: "Sample", companyName: "Sample Business LLC", email: "alex@sample-business.example" };

export interface StepPreviewResult {
  ok: boolean;
  /** Rendering/composition failure the real path would also raise; `final` is null then. */
  error: { code: string; detail: string } | null;
  final: FinalMessagePreview | null;
}


type ComplianceLoader = () => Promise<{ ok: true; mailingAddress: string; unsubscribeUrl: string } | { ok: false; [k: string]: unknown }>;

/** The SMTP transport's composition of an already-rendered HTML body: footer, text part, sender policy, headers. */
async function composeSmtpFinal(subject: string, bodyHtml: string, name: "sfp_smtp" | "legacy_smtp", loader: ComplianceLoader, extraNote?: string): Promise<StepPreviewResult> {
  const { renderEmailPartsForPurpose } = await import("./can-spam-footer");
  const { inspectPresentation } = await import("./email-presentation");
  const { resolvePolicy } = await import("./sender-policy");
  const policy = resolvePolicy("cold_outreach");
  let html = bodyHtml, text = "";
  let footer: FinalMessagePreview["footer"] = { state: "applied" };
  let note = "Simulation: sample recipient, sample unsubscribe link. Nothing is sent or stored.";
  try {
    const parts = await renderEmailPartsForPurpose({ html: bodyHtml, purpose: "marketing_outreach", complianceLoader: loader as any });
    html = parts.html; text = parts.text;
  } catch (err) {
    footer = { state: "unavailable", reason: err instanceof Error ? err.message : "COMPLIANCE_CONFIGURATION_UNAVAILABLE" };
    note = "The required compliance footer cannot be built, so a real send would fail until that is configured.";
  }
  if (extraNote) note = `${note} ${extraNote}`;
  const facts = inspectPresentation(html);
  return {
    ok: true, error: null,
    final: {
      channel: "email", subject, html, text, htmlImagesOff: imagesOffHtml(html), simulation: true,
      sender: { mode: "sender_policy", address: policy.from, name: policy.displayName, note: "From comes from the cold-outreach sender policy." },
      replyTo: { mode: "sender_policy", address: policy.replyTo, note: "Reply-To comes from the cold-outreach sender policy." },
      transport: {
        name, payloadFields: ["from", "to", "subject", "html", "text", "replyTo", "headers"], textTransmitted: true,
        note: "SMTP carries an HTML part and a plain-text part, with signed List-Unsubscribe and one-click headers.",
      },
      logoCount: facts.logoCount, signaturePresent: facts.signatureCount > 0, signatureCount: facts.signatureCount, footerCount: facts.footerCount,
      footer, note,
    },
  };
}

async function complianceLoader(): ReturnType<ComplianceLoader> {
  const { getCommercialComplianceConfig } = await import("./can-spam-footer");
  const real = await getCommercialComplianceConfig();
  return real.ok ? { ok: true as const, mailingAddress: real.mailingAddress, unsubscribeUrl: "https://libertybancard.com/unsubscribe?t=SAMPLE-TOKEN" } : (real as any);
}

/** The Gmail non-cold composition of an already-rendered, already-signed HTML body: duplicate-signature collapse, footer, HTML only. */
async function composeGmailFinal(subject: string | null, withSignature: string, loader: ComplianceLoader): Promise<StepPreviewResult> {
  const { renderEmailHtmlForPurpose } = await import("./can-spam-footer");
  const { inspectPresentation } = await import("./email-presentation");
  let html = withSignature;
  let footer: FinalMessagePreview["footer"] = { state: "applied" };
  let note = "Simulation: sample recipient, sample unsubscribe link. Nothing is sent or stored.";
  try {
    const { collapseDuplicateSignatures } = await import("./email-presentation");
    const parts = await renderEmailHtmlForPurpose({ html: collapseDuplicateSignatures(withSignature), purpose: "marketing_outreach", complianceLoader: loader as any });
    html = parts;
  } catch (err) {
    footer = { state: "unavailable", reason: err instanceof Error ? err.message : "COMPLIANCE_CONFIGURATION_UNAVAILABLE" };
    note = "The required compliance footer cannot be built, so a real send would fail until that is configured.";
  }
  const facts = inspectPresentation(html);
  return {
    ok: true, error: null,
    final: {
      channel: "email", subject: subject, html, text: "", htmlImagesOff: imagesOffHtml(html), simulation: true,
      sender: { mode: "unknown", address: null, name: null, note: "Non-cold sends use the connected Gmail mailbox; its address is chosen by the sender policy for the department at send time and is not known to this preview." },
      replyTo: { mode: "unknown", address: null, note: "Reply-To comes from the department sender policy at send time." },
      transport: { name: "gmail_non_cold", payloadFields: ["to", "subject", "html"], textTransmitted: false, note: "The Gmail send carries HTML only; no separate plain-text part is built." },
      logoCount: facts.logoCount, signaturePresent: facts.signatureCount > 0, signatureCount: facts.signatureCount, footerCount: facts.footerCount,
      footer, note,
    },
  };
}

export async function previewStepForTransport(input: { subject: string | null; body: string; transport: StepPreviewTransport; purpose?: StepPreviewPurpose }): Promise<StepPreviewResult> {
  const { renderEmailPartsForPurpose, renderEmailHtmlForPurpose } = await import("./can-spam-footer");
  const { inspectPresentation } = await import("./email-presentation");
  const { getCommercialComplianceConfig } = await import("./can-spam-footer");
  const loader = async () => {
    const real = await getCommercialComplianceConfig();
    return real.ok ? { ok: true as const, mailingAddress: real.mailingAddress, unsubscribeUrl: "https://libertybancard.com/unsubscribe?t=SAMPLE-TOKEN" } : real;
  };
  const fail = (code: string, detail: string): StepPreviewResult => ({ ok: false, error: { code, detail }, final: null });

  if (input.transport === "sfp_smtp") {
    const { sfpLaunchRenderContext, renderSfpLaunchSubject, renderSfpLaunchBodyHtml } = await import("./sfp-launch-render");
    const { resolvePolicy } = await import("./sender-policy");
    const { RenderError } = await import("./message-render");
    let subject: string, bodyHtml: string;
    try {
      const ctx = sfpLaunchRenderContext(SAMPLE);
      subject = renderSfpLaunchSubject(input.subject, ctx);
      bodyHtml = renderSfpLaunchBodyHtml(input.body, ctx);
    } catch (err) {
      if (err instanceof RenderError) return fail(err.code, err.detail.join(", "));
      throw err;
    }
    return composeSmtpFinal(subject, bodyHtml, "sfp_smtp", loader);
  }

  // gmail_non_cold: the worker interpolates, appends one account-relationship signature, and Gmail composes the footer.
  const { previewMessage } = await import("./message-token-registry");
  const { getEmailSignatureHtml } = await import("./email-signatures");
  const preview = previewMessage("template", { subject: input.subject, body: input.body }, "html");
  if (preview.renderError) return fail(preview.renderError.code, preview.renderError.detail.join(", "));
  const withSignature = `${preview.body}${getEmailSignatureHtml(input.purpose === "sales" ? "sales" : "accounts")}`;
  return composeGmailFinal(preview.subject, withSignature, loader);
}

export interface AssetStepPreviewInput {
  assetType: "sequence" | "campaign";
  assetId: number;
  stepId: number;
  /** Unsaved editor text; when omitted the stored step is previewed. */
  draft?: { subject: string | null; body: string };
}

export interface AssetStepPreviewResult extends StepPreviewResult {
  /** What was resolved from the asset itself (never from the caller): shown so the reviewer knows which path was simulated. */
  asset: { assetType: "sequence" | "campaign"; assetId: number; assetName: string; stepId: number; stepOrder: number; path: string; signature: string | null; aiPersonalization?: boolean } | null;
  /** Wording the real path would not resolve or would reject, in plain words. */
  warnings: string[];
}

const SAMPLE_VALUES = {
  firstName: "Alex", lastName: "Sample", companyName: "Sample Business LLC", email: "alex@sample-business.example",
  industry: "retail", monthlyVolume: "$50,000", currentProcessor: "your current processor", recommendedProgram: "Wholesale",
  recommendedTerminal: "Clover Flex 3", serviceType: "retail", estimatedVolume: "$50,000",
  agentName: "Liberty Bancard", agentEmail: "Scott@mail.libertybancard.com", agentPhone: "954-266-8214", businessName: "Sample Business LLC",
};

/**
 * Preview of one stored (or in-editor) step addressed by its asset identity. The transport, the signature and the
 * substitution are taken from the asset and run through the same code the worker/engine uses, not chosen by the caller:
 *  - SFP launch sequence step (family + plain_text)  -> SFP renderer + SMTP composer
 *  - cold legacy sequence                            -> sequence interpolation + category signature + SMTP composer
 *  - non-cold legacy sequence                        -> sequence interpolation + category signature + Gmail composer
 *  - legacy campaign                                 -> campaign merge fields + sales signature + SMTP composer (AI rewrite not simulated)
 * Simulation only: nothing is sent, stored, enqueued or booked.
 */
export async function previewAssetStep(input: AssetStepPreviewInput): Promise<AssetStepPreviewResult> {
  const { storage } = await import("../storage");
  const none = (code: string, detail: string): AssetStepPreviewResult => ({ ok: false, error: { code, detail }, final: null, asset: null, warnings: [] });

  if (input.assetType === "campaign") {
    const campaign = await storage.getCampaign(input.assetId);
    if (!campaign) return none("ASSET_NOT_FOUND", "Campaign not found");
    const step = (await storage.getCampaignSteps(campaign.id)).find((s) => s.id === input.stepId);
    if (!step) return none("STEP_NOT_FOUND", "Step not found in this campaign");
    if ((step.channel ?? "email") !== "email") return none("UNSUPPORTED_CHANNEL", "Only email steps have an email composition to preview");
    const { applyCampaignMergeFields, campaignMergeFields, leftoverTokens } = await import("./campaign-merge-fields");
    const { getEmailSignatureHtml, getStoredSignature } = await import("./email-signatures");
    const fields = campaignMergeFields({ ownerFirstName: "Alex", ownerLastName: "Sample", companyName: "Sample Business LLC", vertical: "retail", city: "Miami", state: "FL" });
    const subject = applyCampaignMergeFields(input.draft ? input.draft.subject ?? "" : step.subject ?? "", fields);
    const body = applyCampaignMergeFields(input.draft ? input.draft.body : step.bodyTemplate ?? "", fields);
    const warnings = leftoverTokens(`${subject}\n${body}`).map((t) => `${t} is not a campaign merge field. The campaign send path does not block it, so it would be delivered literally.`);
    if (campaign.aiPersonalization) warnings.push("AI personalization is on for this campaign: the sent wording may be rewritten at send time. This preview shows the wording that is given to it (and what is sent if it is flagged or fails).");
    const html = body + getEmailSignatureHtml("sales", await getStoredSignature("sales"));
    const result = await composeSmtpFinal(subject, html, "legacy_smtp", complianceLoader);
    return { ...result, asset: { assetType: "campaign", assetId: campaign.id, assetName: campaign.name, stepId: step.id, stepOrder: step.stepOrder, path: "campaign engine: merge fields, sales signature, SMTP", signature: "sales", aiPersonalization: !!campaign.aiPersonalization }, warnings };
  }

  const sequence = await storage.getFollowUpSequence(input.assetId);
  if (!sequence) return none("ASSET_NOT_FOUND", "Sequence not found");
  const step = (await storage.getSequenceSteps(sequence.id)).find((s) => s.id === input.stepId);
  if (!step) return none("STEP_NOT_FOUND", "Step not found in this sequence");
  if (step.actionType !== "email") return none("UNSUPPORTED_CHANNEL", "Only email steps have an email composition to preview");
  const subject = input.draft ? input.draft.subject : step.subject;
  const body = input.draft ? input.draft.body : step.body ?? "";

  const { SFP_LAUNCH_SEQUENCE_FAMILY_PREFIX } = await import("./cro03/sfp-launch-content");
  const { isColdOutreachSequence, getEmailSignatureHtml } = await import("./email-signatures");
  const { resolveSignatureType } = await import("./sequence-worker");
  const sfp = String(sequence.sequenceFamily ?? "").startsWith(SFP_LAUNCH_SEQUENCE_FAMILY_PREFIX) && (step.config as Record<string, unknown> | null)?.format === "plain_text";
  const meta = { assetType: "sequence" as const, assetId: sequence.id, assetName: sequence.name, stepId: step.id, stepOrder: step.stepOrder ?? 0 };
  if (sfp) {
    const r = await previewStepForTransport({ subject, body, transport: "sfp_smtp" });
    return { ...r, asset: { ...meta, path: "SFP launch renderer, SMTP", signature: null }, warnings: [] };
  }

  const { interpolateSequenceText } = await import("./sequence-step-interpolation");
  const { resolveSalesBooking, FIRST_PARTY_BOOK_URL } = await import("./message-cta-contract");
  const booking = resolveSalesBooking(process.env);
  const values = { ...SAMPLE_VALUES, calendarLink: booking.available ? FIRST_PARTY_BOOK_URL : null };
  const where = `sequence ${sequence.id} step ${meta.stepOrder} (preview)`;
  const warnings: string[] = [];
  let renderedSubject: string, renderedBody: string;
  try {
    // The worker interpolates subject then body; the first failure blocks the real send, so it blocks the preview too.
    renderedSubject = interpolateSequenceText(subject, values, where);
    renderedBody = interpolateSequenceText(body, values, where);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (/calendarLink|booking_link/.test(detail)) warnings.push("Sales booking is not configured in this environment, so a real send of this step would be blocked.");
    return { ok: false, error: { code: "WORKER_WOULD_BLOCK", detail }, final: null, asset: { ...meta, path: "sequence worker interpolation", signature: null }, warnings };
  }
  const sigType = resolveSignatureType((sequence.triggerConfig as Record<string, unknown>) || {});
  const withSignature = renderedBody + getEmailSignatureHtml(sigType);
  if (isColdOutreachSequence(sequence)) {
    const r = await composeSmtpFinal(renderedSubject ?? "", withSignature, "legacy_smtp", complianceLoader, "Cold sequences send through SMTP when it is configured; the GoHighLevel fallback is not simulated.");
    return { ...r, asset: { ...meta, path: "sequence worker: interpolation, category signature, SMTP", signature: sigType }, warnings };
  }
  // Non-cold: reuse the Gmail composition, with the already-interpolated wording.
  const r = await composeGmailFinal(renderedSubject, withSignature, complianceLoader);
  return { ...r, asset: { ...meta, path: "sequence worker: interpolation, category signature, Gmail", signature: sigType }, warnings };
}
