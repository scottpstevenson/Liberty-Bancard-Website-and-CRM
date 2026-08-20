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
 *
 * PAUSE AUTHORITY: The global pause gate is now enforced via OutboundPauseAuthority
 * with fail-closed semantics. The former caller-controlled bypass boolean has been
 * removed. Any caller requiring a narrow exception must use the versioned exception
 * registry in outbound-pause-authority.ts; the authority still evaluates the state.
 */

import type { ContactabilityChannel } from "./contactability";
import type { AuthorizedSendDecision } from "./outbound-pause-authority";
import { authorize, recheckEpoch } from "./outbound-pause-authority";
import { registerInflight, deregisterInflight } from "./outbound-control-service";

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
  /** Epoch at which the authorization was granted. Used for final recheck. */
  pauseDecision?: AuthorizedSendDecision;
}

// ---------------------------------------------------------------------------
// Orchestrator options
// ---------------------------------------------------------------------------

export interface OrchestratorSendOptions {
  /** Channels the send may touch — used for contactability check. Defaults to ["email"]. */
  outboundChannels?: ContactabilityChannel[];
  /**
   * Exception registry key for narrow registered exceptions that must still
   * route through the pause authority (not a bypass). Omit for standard automated sends.
   * The authority evaluates the state; the key is an advisory label only.
   * @see server/services/outbound-pause-authority.ts EXCEPTION_REGISTRY
   */
  pauseExceptionKey?: string;
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
    opts: Pick<OrchestratorSendOptions, "pauseExceptionKey"> = {},
  ): Promise<ChannelComplianceResult> {
    // 1. Global pause check — canonical authority with fail-closed semantics
    const pauseDecision = await authorize({ exceptionKey: opts.pauseExceptionKey });
    if (!pauseDecision.allowed) {
      const reason =
        pauseDecision.reasonCode === "activating"
          ? "Outbound pause activation in progress — all sends blocked"
          : pauseDecision.reasonCode === "safe_default"
          ? "Outbound communications are globally paused (fail-closed default)"
          : "Outbound communications are globally paused";
      return {
        allowed: false,
        reason,
        pauseDecision,
      };
    }

    // 2. Communication arbitration — suppress if rep recently touched or auto-send too soon
    {
      const { shouldSuppress, logArbitrationSuppression } = await import("./communication-arbitration");
      // Map ContactabilityChannel to arbitration channel string (use first channel for arbitration)
      const arbitrationChannel = channels[0] ?? "email";
      const arbitration = await shouldSuppress(contactId, arbitrationChannel);
      if (arbitration.suppressed) {
        await logArbitrationSuppression(contactId, arbitrationChannel, arbitration);
        return {
          allowed: false,
          reason: arbitration.reason ?? "Communication arbitration suppressed this send",
          pauseDecision,
        };
      }
    }

    // 3. Contactability gate — DNC, consent, PEWC, quiet hours, channel eligibility
    {
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
            pauseDecision,
          };
        }
      }
    }

    return { allowed: true, pauseDecision };
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

    // Final epoch recheck immediately before provider I/O
    const decision = compliance.pauseDecision!;
    const token = crypto.randomUUID();
    await registerInflight(token, decision.epoch);
    try {
      const epochOk = await recheckEpoch(decision.epoch);
      if (!epochOk) {
        return {
          success: false,
          skipped: true,
          skipReason: "Outbound paused after authorization — epoch recheck failed",
          provider: this.emailTransport.name,
        };
      }
      return await this.emailTransport.send(params);
    } finally {
      deregisterInflight(token);
    }
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

    const decision = compliance.pauseDecision!;
    const token = crypto.randomUUID();
    await registerInflight(token, decision.epoch);
    try {
      const epochOk = await recheckEpoch(decision.epoch);
      if (!epochOk) {
        return {
          success: false,
          skipped: true,
          skipReason: "Outbound paused after authorization — epoch recheck failed",
          provider: this.smsTransport.name,
        };
      }
      return await this.smsTransport.send(params);
    } finally {
      deregisterInflight(token);
    }
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

    const decision = compliance.pauseDecision!;
    const token = crypto.randomUUID();
    await registerInflight(token, decision.epoch);
    try {
      const epochOk = await recheckEpoch(decision.epoch);
      if (!epochOk) {
        return {
          success: false,
          skipped: true,
          skipReason: "Outbound paused after authorization — epoch recheck failed",
          provider: this.rvmTransport.name,
        };
      }
      return await this.rvmTransport.send(params);
    } finally {
      deregisterInflight(token);
    }
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
