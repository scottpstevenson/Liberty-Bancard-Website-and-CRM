/**
 * GhlSmsTransport — SmsTransport implementation backed by GoHighLevel.
 *
 * Implements the SmsTransport interface from channel-orchestrator.ts.
 * All GHL SMS API calls are isolated here; business code must use
 * ChannelOrchestrator.sendSms() rather than calling ghl.ts directly.
 */

import type { SmsTransport, SmsSendParams, TransportResult, TransportHealthResult } from "../channel-orchestrator";

export class GhlSmsTransport implements SmsTransport {
  readonly name = "ghl";

  async send(params: SmsSendParams): Promise<TransportResult> {
    try {
      const { sendGhlSms } = await import("../ghl");
      const result = await sendGhlSms({
        contactId: params.contactId,
        dealId: params.dealId,
        body: params.body,
        templateId: params.templateId,
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
        error: err?.message ?? "GHL SMS send threw unexpectedly",
        provider: "ghl",
      };
    }
  }

  async healthCheck(): Promise<TransportHealthResult> {
    const start = Date.now();
    try {
      // GHL SMS health proxied through the same API health check
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
