import type { SdrLeadState } from "@shared/schema";

export interface StageDecision {
  nextStage: string;
  nextActionType: string;
  nextActionAt: Date;
  decisionReason: string;
  actionParams?: Record<string, any>;
}

const MINUTES = 60 * 1000;
const HOURS = 60 * MINUTES;
const DAYS = 24 * HOURS;

function futureDate(ms: number): Date {
  return new Date(Date.now() + ms);
}

export function decideNextAction(lead: SdrLeadState, latestEvent?: { eventType: string; metadata?: any }): StageDecision | null {
  const stage = lead.stage;

  switch (stage) {
    case "DISCOVERED":
      return {
        nextStage: "ENRICHED",
        nextActionType: "enrich",
        nextActionAt: futureDate(0),
        decisionReason: "New lead discovered, needs enrichment and dedup",
      };

    case "ENRICHED":
    case "DEDUPED":
    case "CLASSIFIED":
      return {
        nextStage: "QUALIFIED",
        nextActionType: "score",
        nextActionAt: futureDate(0),
        decisionReason: "Lead enriched/classified, scoring for qualification",
      };

    case "QUALIFIED":
      return decideQualifiedNext(lead);

    case "OUTREACH_EMAIL":
      return decideEmailNext(lead, latestEvent);

    case "OUTREACH_SMS":
      return decideSmsNext(lead, latestEvent);

    case "OUTREACH_CALL":
      return decideCallNext(lead, latestEvent);

    case "ENGAGED":
      return {
        nextStage: "MEETING_SET",
        nextActionType: "classify_intent",
        nextActionAt: futureDate(4 * HOURS),
        decisionReason: "Lead engaged, classifying intent for routing (will check again in 4 hours)",
      };

    case "MEETING_SET":
      return {
        nextStage: "MEETING_SET",
        nextActionType: "send_reminder",
        nextActionAt: futureDate(1 * DAYS),
        decisionReason: "Meeting set, pausing outreach and scheduling reminders",
      };

    case "STATEMENT_REQUESTED":
      return {
        nextStage: "STATEMENT_REQUESTED",
        nextActionType: "follow_up_statement",
        nextActionAt: futureDate(2 * DAYS),
        decisionReason: "Statement requested, scheduling follow-up reminder",
      };

    case "STATEMENT_RECEIVED":
      return {
        nextStage: "PROPOSAL_SENT",
        nextActionType: "generate_proposal",
        nextActionAt: futureDate(0),
        decisionReason: "Statement received, generating proposal",
      };

    case "NURTURE":
      return {
        nextStage: "NURTURE",
        nextActionType: "nurture_email",
        nextActionAt: futureDate(14 * DAYS),
        decisionReason: "In nurture, scheduling next touch in 14 days",
      };

    case "DEAD":
    case "CONVERTED":
    case "PROPOSAL_SENT":
      return null;

    default:
      return null;
  }
}

function decideQualifiedNext(lead: SdrLeadState): StageDecision {
  const hasEmail = !!(lead.ownerEmail || lead.email) && lead.consentEmail && !lead.optedOutEmail;
  const hasSms = !!(lead.ownerPhone || lead.phone) && lead.consentSms && !lead.optedOutSms;
  const hasCall = !!(lead.ownerPhone || lead.phone) && lead.consentCall;

  if (lead.priorityBucket === "nurture" || (lead.priorityScore || 0) < 30) {
    return {
      nextStage: "NURTURE",
      nextActionType: "nurture_email",
      nextActionAt: futureDate(7 * DAYS),
      decisionReason: `Low quality lead (priority: ${lead.priorityBucket}, score: ${lead.priorityScore}), moving to nurture`,
    };
  }

  if (hasEmail) {
    return {
      nextStage: "OUTREACH_EMAIL",
      nextActionType: "send_email",
      nextActionAt: futureDate(0),
      decisionReason: "Email available and consented, starting email outreach",
    };
  }

  if (hasSms) {
    return {
      nextStage: "OUTREACH_SMS",
      nextActionType: "send_sms",
      nextActionAt: futureDate(0),
      decisionReason: "No email but SMS available and consented, starting SMS outreach",
    };
  }

  if (hasCall) {
    return {
      nextStage: "OUTREACH_CALL",
      nextActionType: "schedule_call",
      nextActionAt: futureDate(0),
      decisionReason: "No email/SMS but phone available, starting call outreach",
    };
  }

  return {
    nextStage: "NURTURE",
    nextActionType: "nurture_email",
    nextActionAt: futureDate(30 * DAYS),
    decisionReason: "No reachable channels available, moving to nurture",
  };
}

function decideEmailNext(lead: SdrLeadState, latestEvent?: { eventType: string; metadata?: any }): StageDecision {
  if (latestEvent?.eventType === "reply_received") {
    return {
      nextStage: "ENGAGED",
      nextActionType: "classify_intent",
      nextActionAt: futureDate(0),
      decisionReason: "Email reply received, lead is engaged",
    };
  }

  const attempts = lead.emailAttempts || 0;

  if (attempts >= 3) {
    const hasSms = !!(lead.ownerPhone || lead.phone) && lead.consentSms && !lead.optedOutSms;
    if (hasSms) {
      return {
        nextStage: "OUTREACH_SMS",
        nextActionType: "send_sms",
        nextActionAt: futureDate(0),
        decisionReason: `No reply after ${attempts} email attempts, escalating to SMS`,
      };
    }

    const hasCall = !!(lead.ownerPhone || lead.phone) && lead.consentCall;
    if (hasCall) {
      return {
        nextStage: "OUTREACH_CALL",
        nextActionType: "schedule_call",
        nextActionAt: futureDate(0),
        decisionReason: `No reply after ${attempts} email attempts, no SMS consent, escalating to call`,
      };
    }

    return {
      nextStage: "NURTURE",
      nextActionType: "nurture_email",
      nextActionAt: futureDate(30 * DAYS),
      decisionReason: `No reply after ${attempts} email attempts, no other channels, moving to nurture`,
    };
  }

  const openedButNoReply = latestEvent?.eventType === "email_opened";
  const delayDays = openedButNoReply ? 2 : (attempts === 0 ? 0 : attempts === 1 ? 3 : 5);

  return {
    nextStage: "OUTREACH_EMAIL",
    nextActionType: "send_email",
    nextActionAt: futureDate(delayDays * DAYS),
    decisionReason: openedButNoReply
      ? `Email opened but no reply (attempt ${attempts + 1}), sending stronger CTA in ${delayDays} days`
      : `Scheduling email attempt ${attempts + 1} in ${delayDays} days`,
    actionParams: openedButNoReply ? { strongerCta: true } : undefined,
  };
}

function decideSmsNext(lead: SdrLeadState, latestEvent?: { eventType: string; metadata?: any }): StageDecision {
  if (latestEvent?.eventType === "reply_received") {
    return {
      nextStage: "ENGAGED",
      nextActionType: "classify_intent",
      nextActionAt: futureDate(0),
      decisionReason: "SMS reply received, lead is engaged",
    };
  }

  const attempts = lead.smsAttempts || 0;

  if (attempts >= 2) {
    const hasCall = !!(lead.ownerPhone || lead.phone) && lead.consentCall;
    if (hasCall) {
      return {
        nextStage: "OUTREACH_CALL",
        nextActionType: "schedule_call",
        nextActionAt: futureDate(0),
        decisionReason: `No reply after ${attempts} SMS attempts, escalating to call`,
      };
    }

    return {
      nextStage: "NURTURE",
      nextActionType: "nurture_email",
      nextActionAt: futureDate(30 * DAYS),
      decisionReason: `No reply after ${attempts} SMS attempts, no call consent, moving to nurture`,
    };
  }

  const delayDays = attempts === 0 ? 0 : 2;

  return {
    nextStage: "OUTREACH_SMS",
    nextActionType: "send_sms",
    nextActionAt: futureDate(delayDays * DAYS),
    decisionReason: `Scheduling SMS attempt ${attempts + 1} in ${delayDays} days`,
  };
}

function decideCallNext(lead: SdrLeadState, latestEvent?: { eventType: string; metadata?: any }): StageDecision {
  if (latestEvent?.eventType === "call_interested" || latestEvent?.eventType === "call_booked") {
    return {
      nextStage: latestEvent.eventType === "call_booked" ? "MEETING_SET" : "ENGAGED",
      nextActionType: latestEvent.eventType === "call_booked" ? "send_reminder" : "classify_intent",
      nextActionAt: futureDate(0),
      decisionReason: latestEvent.eventType === "call_booked" ? "Meeting booked from call" : "Interest expressed on call",
    };
  }

  const attempts = lead.callAttempts || 0;

  if (attempts >= 3) {
    return {
      nextStage: "NURTURE",
      nextActionType: "nurture_email",
      nextActionAt: futureDate(30 * DAYS),
      decisionReason: `No answer after ${attempts} call attempts, moving to nurture`,
    };
  }

  const delayDays = attempts === 0 ? 0 : 1;

  return {
    nextStage: "OUTREACH_CALL",
    nextActionType: "schedule_call",
    nextActionAt: futureDate(delayDays * DAYS),
    decisionReason: `Scheduling call attempt ${attempts + 1} in ${delayDays} days`,
  };
}

export function getAllowedTransitions(stage: string): string[] {
  const transitions: Record<string, string[]> = {
    "DISCOVERED": ["ENRICHED", "DEAD"],
    "ENRICHED": ["DEDUPED", "CLASSIFIED", "QUALIFIED", "DEAD"],
    "DEDUPED": ["CLASSIFIED", "QUALIFIED", "DEAD"],
    "CLASSIFIED": ["QUALIFIED", "NURTURE", "DEAD"],
    "QUALIFIED": ["OUTREACH_EMAIL", "OUTREACH_SMS", "OUTREACH_CALL", "OUTREACH_CHAT", "NURTURE", "DEAD"],
    "OUTREACH_EMAIL": ["OUTREACH_SMS", "OUTREACH_CALL", "OUTREACH_CHAT", "ENGAGED", "NURTURE", "DEAD"],
    "OUTREACH_SMS": ["OUTREACH_CALL", "OUTREACH_CHAT", "ENGAGED", "NURTURE", "DEAD"],
    "OUTREACH_CALL": ["OUTREACH_CHAT", "ENGAGED", "MEETING_SET", "NURTURE", "DEAD"],
    "OUTREACH_CHAT": ["ENGAGED", "MEETING_SET", "NURTURE", "DEAD"],
    "ENGAGED": ["MEETING_SET", "STATEMENT_REQUESTED", "PROPOSAL_SENT", "CONVERTED", "NURTURE", "DEAD"],
    "MEETING_SET": ["STATEMENT_REQUESTED", "PROPOSAL_SENT", "CONVERTED", "NURTURE", "DEAD"],
    "STATEMENT_REQUESTED": ["STATEMENT_RECEIVED", "NURTURE", "DEAD"],
    "STATEMENT_RECEIVED": ["PROPOSAL_SENT", "CONVERTED", "DEAD"],
    "PROPOSAL_SENT": ["CONVERTED", "NURTURE", "DEAD"],
    "NURTURE": ["OUTREACH_EMAIL", "OUTREACH_SMS", "OUTREACH_CALL", "DEAD"],
    "DEAD": [],
    "CONVERTED": [],
  };
  return transitions[stage] || [];
}
