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

const SAMPLE = { firstName: "Alex", lastName: "Sample", companyName: "Sample Business LLC", email: "alex@sample-business.example" };

export interface StepPreviewResult {
  ok: boolean;
  /** Rendering/composition failure the real path would also raise; `final` is null then. */
  error: { code: string; detail: string } | null;
  final: FinalMessagePreview | null;
}

export async function previewStepForTransport(input: { subject: string | null; body: string; transport: StepPreviewTransport }): Promise<StepPreviewResult> {
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
    const policy = resolvePolicy("cold_outreach");
    let html = bodyHtml, text = "";
    let footer: FinalMessagePreview["footer"] = { state: "applied" };
    let note = "Simulation: sample recipient, sample unsubscribe link. Nothing is sent or stored.";
    try {
      const parts = await renderEmailPartsForPurpose({ html: bodyHtml, purpose: "marketing_outreach", complianceLoader: loader });
      html = parts.html; text = parts.text;
    } catch (err) {
      footer = { state: "unavailable", reason: err instanceof Error ? err.message : "COMPLIANCE_CONFIGURATION_UNAVAILABLE" };
      note = "The required compliance footer cannot be built, so a real send would fail until that is configured.";
    }
    const facts = inspectPresentation(html);
    return {
      ok: true, error: null,
      final: {
        channel: "email", subject, html, text, htmlImagesOff: imagesOffHtml(html), simulation: true,
        sender: { mode: "sender_policy", address: policy.from, name: policy.displayName, note: "From comes from the cold-outreach sender policy." },
        replyTo: { mode: "sender_policy", address: policy.replyTo, note: "Reply-To comes from the cold-outreach sender policy." },
        transport: {
          name: "sfp_smtp", payloadFields: ["from", "to", "subject", "html", "text", "replyTo", "headers"], textTransmitted: true,
          note: "SMTP carries an HTML part and a plain-text part, with signed List-Unsubscribe and one-click headers.",
        },
        logoCount: facts.logoCount, signaturePresent: facts.signatureCount > 0, signatureCount: facts.signatureCount, footerCount: facts.footerCount,
        footer, note,
      },
    };
  }

  // gmail_non_cold: the worker interpolates, appends one account-relationship signature, and Gmail composes the footer.
  const { previewMessage } = await import("./message-token-registry");
  const { getEmailSignatureHtml } = await import("./email-signatures");
  const preview = previewMessage("template", { subject: input.subject, body: input.body }, "html");
  if (preview.renderError) return fail(preview.renderError.code, preview.renderError.detail.join(", "));
  const withSignature = `${preview.body}${getEmailSignatureHtml("accounts")}`;
  let html = withSignature;
  let footer: FinalMessagePreview["footer"] = { state: "applied" };
  let note = "Simulation: sample recipient, sample unsubscribe link. Nothing is sent or stored.";
  try {
    const { collapseDuplicateSignatures } = await import("./email-presentation");
    const parts = await renderEmailHtmlForPurpose({ html: collapseDuplicateSignatures(withSignature), purpose: "marketing_outreach", complianceLoader: loader });
    html = parts;
  } catch (err) {
    footer = { state: "unavailable", reason: err instanceof Error ? err.message : "COMPLIANCE_CONFIGURATION_UNAVAILABLE" };
    note = "The required compliance footer cannot be built, so a real send would fail until that is configured.";
  }
  const facts = inspectPresentation(html);
  return {
    ok: true, error: null,
    final: {
      channel: "email", subject: preview.subject, html, text: "", htmlImagesOff: imagesOffHtml(html), simulation: true,
      sender: { mode: "unknown", address: null, name: null, note: "Non-cold sends use the connected Gmail mailbox; its address is chosen by the sender policy for the department at send time and is not known to this preview." },
      replyTo: { mode: "unknown", address: null, note: "Reply-To comes from the department sender policy at send time." },
      transport: { name: "gmail_non_cold", payloadFields: ["to", "subject", "html"], textTransmitted: false, note: "The Gmail send carries HTML only; no separate plain-text part is built." },
      logoCount: facts.logoCount, signaturePresent: facts.signatureCount > 0, signatureCount: facts.signatureCount, footerCount: facts.footerCount,
      footer, note,
    },
  };
}
