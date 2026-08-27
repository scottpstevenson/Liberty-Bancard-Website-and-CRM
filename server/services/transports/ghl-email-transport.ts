/**
 * GhlEmailTransport — EmailTransport implementation backed by GoHighLevel.
 *
 * Implements the EmailTransport interface from channel-orchestrator.ts.
 * All GHL API calls are isolated here; business code must not import ghl.ts directly
 * for email sends — use ChannelOrchestrator.sendEmail() instead.
 */

import type { EmailTransport, EmailSendParams, TransportResult, TransportHealthResult } from "../channel-orchestrator";

export class GhlEmailTransport implements EmailTransport {
  readonly name = "ghl";

  async send(params: EmailSendParams): Promise<TransportResult> {
    try {
      const { sendGhlEmail } = await import("../ghl");
      const result = await sendGhlEmail({
        contactId: params.contactId,
        dealId: params.dealId,
        subject: params.subject,
        // sendGhlEmail is the sole GHL renderer (including commercial footer).
        body: params.body,
        templateId: params.templateId,
        fromEmail: params.fromEmail,
        fromName: params.fromName,
        replyTo: params.replyTo,
        skipActivityLog: params.skipActivityLog,
        commercialPurpose: params.commercialPurpose ?? "marketing_outreach",
      });
      return {
        success: result.success,
        messageId: result.messageId,
        error: result.error,
        provider: "ghl",
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message ?? "GHL email send threw unexpectedly",
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
