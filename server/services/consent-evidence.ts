/**
 * Wave 2 — Consent Evidence Service
 *
 * recordPewcDecision() is the single write path for PEWC audit evidence.
 * Call it from every public form endpoint that shows the PewcCheckbox.
 *
 * No-downgrade rule: once a contact reaches pewc_full_automation the tier
 * is never lowered. If checked=false and the contact is already at
 * pewc_full_automation, we write a pewc_declined audit row (for evidence)
 * but skip the contact-tier update.
 */

import crypto from "crypto";
import { db } from "../db";
import { contacts } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  PEWC_DISCLOSURE_TEXT,
  PEWC_DISCLOSURE_VERSION,
  PEWC_CHANNELS_COVERED,
} from "@shared/consent-disclosures";
import { recordAnalyticsEvent } from "./analytics-events";
import {
  applyConsentCommand,
  disclosureHash,
  normalizeConsentPhone,
} from "./consent-authority";

export async function recordPewcDecision(opts: {
  contactId: number;
  checked: boolean;
  source: string;
  ipAddress: string;
  userAgent: string;
  disclosureVersion?: string;
  eventKey?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  const { contactId, checked, source, ipAddress, userAgent, details = {} } = opts;
  const disclosureVersion = opts.disclosureVersion ?? PEWC_DISCLOSURE_VERSION;

  if (checked) {
    const [contact] = await db
      .select({ phone: contacts.phone })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);
    const consentedPhone = typeof details.consentedPhone === "string"
      ? details.consentedPhone
      : contact?.phone;
    if (!normalizeConsentPhone(consentedPhone)) {
      throw new Error("PEWC capture requires the current phone number");
    }
    const baseCommand = {
      subject: { type: "contact", id: contactId },
      kind: "pewc_opt_in",
      purpose: "outreach",
      eventNamespace: "pewc",
      source,
      ipAddress,
      userAgent,
      evidence: {
        ...details,
        consentedPhone,
        normalizedConsentedPhone: normalizeConsentPhone(consentedPhone),
        disclosureVersion,
        disclosureHash: disclosureHash(PEWC_DISCLOSURE_TEXT),
        channelsCovered: PEWC_CHANNELS_COVERED,
      },
      details: {
        ...details,
        disclosureVersion,
        channelsCovered: PEWC_CHANNELS_COVERED,
      },
    } as const;
    const eventBase = opts.eventKey ?? `${source}:${contactId}:${String(details.submissionId ?? crypto.randomUUID())}`;
    // The reducer projects both PEWC-covered automated channels in one
    // transaction so a process crash cannot leave a partially authorized tier.
    await applyConsentCommand({ ...baseCommand, channel: "sms", eventKey: `${eventBase}:pewc` });
  }

  await recordAnalyticsEvent({
    eventName: "pewc_captured",
    contactId,
    consentTier: checked ? "pewc_full_automation" : "standard",
    sourceCategory: source,
    channel: "sms",
    metadata: { checked, disclosureVersion },
  });
}
