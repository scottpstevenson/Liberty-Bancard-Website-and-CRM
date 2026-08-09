/**
 * ChannelOrchestrator — Provider-neutral outbound channel abstraction.
 *
 * Governing rule: Liberty decides → ChannelOrchestrator routes → Provider executes → Event returns to Liberty.
 *
 * All outbound channel actions pass through this orchestrator's compliance fence:
 * global pause → contactability → DNC → unsubscribe/STOP → consent → channel eligibility
 * → frequency cap → quiet hours → sender policy → idempotency → lifecycle validity.
 *
 * Business code (sequence worker, proposal follow-up, onboarding reminder, etc.)
 * should call this orchestrator rather than GHL functions directly.
 */

import type { ContactabilityChannel } from "./contactability";

// ---------------------------------------------------------------------------
// Transport result
// ---------------------------------------------------------------------------

export interface TransportResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider: string; // "ghl" | "smtp" | "twilio" | etc.
  skipped?: boolean;
  skipReason?: string;
}

// ---------------------------------------------------------------------------
// Transport interfaces — implemented by provider adapters
// ---------------------------------------------------------------------------

export interface EmailSendParams {
  contactId: number;
  dealId?: number;
  subject: string;
  body: string;
  templateId?: number;
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
  skipActivityLog?: boolean;
  category?: string; // sender-policy category; defaults to "outbound_sequence"
}

export interface SmsSendParams {
  contactId: number;
  dealId?: number;
  body: string;
  templateId?: number;
}

export interface RvmSendParams {
  contactId: number;
  dealId?: number;
  scriptText: string;
  audioUrl?: string;
  voicemailWorkflowKey?: string;
}

export interface TransportHealthResult {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  provider: string;
}

export interface EmailTransport {
  readonly name: string;
  send(params: EmailSendParams): Promise<TransportResult>;
  healthCheck(): Promise<TransportHealthResult>;
}

export interface SmsTransport {
  readonly name: string;
  send(params: SmsSendParams): Promise<TransportResult>;
  healthCheck(): Promise<TransportHealthResult>;
}

export interface RvmTransport {
  readonly name: string;
  send(params: RvmSendParams): Promise<TransportResult>;
  healthCheck(): Promise<TransportHealthResult>;
}

// ---------------------------------------------------------------------------
// Compliance check result
// ---------------------------------------------------------------------------

export interface ChannelComplianceResult {
  allowed: boolean;
  reason?: string;
  blockedChannel?: ContactabilityChannel;
}

// ---------------------------------------------------------------------------
// Orchestrator options
// ---------------------------------------------------------------------------

export interface OrchestratorSendOptions {
  /** Channels the send may touch — used for contactability check. Defaults to ["email"]. */
  outboundChannels?: ContactabilityChannel[];
  /** Skip the global-pause check (e.g., transactional system emails). Default false. */
  skipGlobalPauseCheck?: boolean;
  /** Skip the DNC / contactability gate entirely (e.g., legal/compliance notices). Default false. */
  skipContactabilityCheck?: boolean;
}

// ---------------------------------------------------------------------------
// ChannelOrchestrator
// ---------------------------------------------------------------------------

export class ChannelOrchestrator {
  private emailTransport: EmailTransport;
  private smsTransport: SmsTransport;
  private rvmTransport: RvmTransport;

  constructor(opts: {
    email: EmailTransport;
    sms: SmsTransport;
    rvm: RvmTransport;
  }) {
    this.emailTransport = opts.email;
    this.smsTransport = opts.sms;
    this.rvmTransport = opts.rvm;
  }

  // -------------------------------------------------------------------------
  // Compliance fence
  // -------------------------------------------------------------------------

  async checkCompliance(
    contactId: number,
    channels: ContactabilityChannel[],
    opts: Pick<OrchestratorSendOptions, "skipGlobalPauseCheck" | "skipContactabilityCheck"> = {},
  ): Promise<ChannelComplianceResult> {
    // 1. Global pause check
    if (!opts.skipGlobalPauseCheck) {
      const { storage } = await import("../storage");
      const paused = await storage.getSystemSetting("outboundGlobalPaused");
      if (paused === true || paused === "true") {
        return { allowed: false, reason: "Outbound communications are globally paused" };
      }
    }

    // 2. Communication arbitration — suppress if rep recently touched or auto-send too soon
    if (!opts.skipContactabilityCheck) {
      const { shouldSuppress, logArbitrationSuppression } = await import("./communication-arbitration");
      // Map ContactabilityChannel to arbitration channel string (use first channel for arbitration)
      const arbitrationChannel = channels[0] ?? "email";
      const arbitration = await shouldSuppress(contactId, arbitrationChannel);
      if (arbitration.suppressed) {
        await logArbitrationSuppression(contactId, arbitrationChannel, arbitration);
        return {
          allowed: false,
          reason: arbitration.reason ?? "Communication arbitration suppressed this send",
        };
      }
    }

    // 3. Contactability gate — DNC, consent, PEWC, quiet hours, channel eligibility
    if (!opts.skipContactabilityCheck) {
      const { evaluateContactability } = await import("./contactability");
      for (const ch of channels) {
        const result = await evaluateContactability({
          contactId,
          channel: ch,
          campaignType: "channel_orchestrator",
          mode: "enforcement",
        });
        if (!result.allowed) {
          return {
            allowed: false,
            reason: result.reason ?? `Channel ${ch} blocked by contactability gate`,
            blockedChannel: ch,
          };
        }
      }
    }

    return { allowed: true };
  }

  // -------------------------------------------------------------------------
  // sendEmail
  // -------------------------------------------------------------------------

  async sendEmail(
    params: EmailSendParams,
    opts: OrchestratorSendOptions = {},
  ): Promise<TransportResult> {
    const channels = opts.outboundChannels ?? ["email"];
    const compliance = await this.checkCompliance(params.contactId, channels, opts);

    if (!compliance.allowed) {
      return {
        success: false,
        skipped: true,
        skipReason: compliance.reason,
        provider: this.emailTransport.name,
      };
    }

    return this.emailTransport.send(params);
  }

  // -------------------------------------------------------------------------
  // sendSms
  // -------------------------------------------------------------------------

  async sendSms(
    params: SmsSendParams,
    opts: OrchestratorSendOptions = {},
  ): Promise<TransportResult> {
    const channels = opts.outboundChannels ?? ["sms"];
    const compliance = await this.checkCompliance(params.contactId, channels, opts);

    if (!compliance.allowed) {
      return {
        success: false,
        skipped: true,
        skipReason: compliance.reason,
        provider: this.smsTransport.name,
      };
    }

    return this.smsTransport.send(params);
  }

  // -------------------------------------------------------------------------
  // sendRvm
  // -------------------------------------------------------------------------

  async sendRvm(
    params: RvmSendParams,
    opts: OrchestratorSendOptions = {},
  ): Promise<TransportResult> {
    const channels = opts.outboundChannels ?? ["ringless_vm"];
    const compliance = await this.checkCompliance(params.contactId, channels, opts);

    if (!compliance.allowed) {
      return {
        success: false,
        skipped: true,
        skipReason: compliance.reason,
        provider: this.rvmTransport.name,
      };
    }

    return this.rvmTransport.send(params);
  }

  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------

  async healthCheck(): Promise<{
    email: TransportHealthResult;
    sms: TransportHealthResult;
    rvm: TransportHealthResult;
  }> {
    const [email, sms, rvm] = await Promise.allSettled([
      this.emailTransport.healthCheck(),
      this.smsTransport.healthCheck(),
      this.rvmTransport.healthCheck(),
    ]);

    return {
      email: email.status === "fulfilled"
        ? email.value
        : { healthy: false, error: String((email as PromiseRejectedResult).reason), provider: this.emailTransport.name },
      sms: sms.status === "fulfilled"
        ? sms.value
        : { healthy: false, error: String((sms as PromiseRejectedResult).reason), provider: this.smsTransport.name },
      rvm: rvm.status === "fulfilled"
        ? rvm.value
        : { healthy: false, error: String((rvm as PromiseRejectedResult).reason), provider: this.rvmTransport.name },
    };
  }

  // -------------------------------------------------------------------------
  // Provider names (for logging/audit)
  // -------------------------------------------------------------------------

  get emailProviderName(): string {
    return this.emailTransport.name;
  }

  get smsProviderName(): string {
    return this.smsTransport.name;
  }

  get rvmProviderName(): string {
    return this.rvmTransport.name;
  }
}
