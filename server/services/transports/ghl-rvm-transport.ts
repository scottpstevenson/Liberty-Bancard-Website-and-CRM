/**
 * GhlRvmTransport — RvmTransport implementation backed by GoHighLevel voicemail drop.
 *
 * GHL handles ringless voicemail delivery natively via its Voicemail Drop action node.
 * This transport upserts the contact into GHL and triggers the voicemail_drop workflow.
 */

import type { RvmTransport, RvmSendParams, TransportResult, TransportHealthResult } from "../channel-orchestrator";

export class GhlRvmTransport implements RvmTransport {
  readonly name = "ghl";

  async send(params: RvmSendParams): Promise<TransportResult> {
    try {
      const { isGhlConfigured, upsertGhlContact } = await import("../ghl");
      const { storage } = await import("../../storage");
      const { enrollInGhlWorkflow } = await import("../ghl-workflows");

      if (!isGhlConfigured()) {
        return { success: false, error: "GHL not configured — cannot send ringless voicemail", provider: "ghl" };
      }

      const contact = await storage.getContact(params.contactId);
      if (!contact) {
        return { success: false, error: "Contact not found", provider: "ghl" };
      }

      // Ensure the contact has a GHL ID
      let ghlContactId = contact.ghlContactId;
      if (!ghlContactId) {
        try {
          ghlContactId = await upsertGhlContact(contact);
        } catch (err: any) {
          return { success: false, error: `GHL contact upsert failed: ${err.message}`, provider: "ghl" };
        }
      }

      const workflowKey = params.voicemailWorkflowKey ?? "voicemail_drop";
      await enrollInGhlWorkflow({
        workflowKey,
        ghlContactId,
        metadata: { scriptPreview: params.scriptText.substring(0, 200), dealId: params.dealId },
      });

      return { success: true, provider: "ghl" };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message ?? "GHL RVM send threw unexpectedly",
        provider: "ghl",
      };
    }
  }

  async healthCheck(): Promise<TransportHealthResult> {
    const start = Date.now();
    try {
      const { checkGhlHealth } = await import("../ghl");
      const result = await checkGhlHealth();
      return {
        healthy: result.connected,
        latencyMs: result.latencyMs ?? (Date.now() - start),
        error: result.error,
        provider: "ghl",
      };
    } catch (err: any) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: err?.message,
        provider: "ghl",
      };
    }
  }
}
