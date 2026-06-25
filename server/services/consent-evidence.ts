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

import { storage } from "../storage";
import { db } from "../db";
import { contacts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { PEWC_DISCLOSURE_VERSION, PEWC_CHANNELS_COVERED } from "@shared/consent-disclosures";

export async function recordPewcDecision(opts: {
  contactId: number;
  checked: boolean;
  source: string;
  ipAddress: string;
  userAgent: string;
  disclosureVersion?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  const { contactId, checked, source, ipAddress, userAgent, details = {} } = opts;
  const disclosureVersion = opts.disclosureVersion ?? PEWC_DISCLOSURE_VERSION;

  const [row] = await db
    .select({ consentTier: contacts.consentTier })
    .from(contacts)
    .where(eq(contacts.id, contactId));

  const currentTier = row?.consentTier ?? "cold_no_consent";
  const alreadyFull = currentTier === "pewc_full_automation";

  if (checked) {
    await storage.createConsentAuditLog({
      contactId,
      channel: "sms",
      action: "pewc_opt_in",
      consented: true,
      consentType: "express_written",
      source,
      ipAddress,
      userAgent,
      details: {
        ...details,
        disclosureVersion,
        channelsCovered: PEWC_CHANNELS_COVERED,
      },
    });

    if (!alreadyFull) {
      await db
        .update(contacts)
        .set({ consentTier: "pewc_full_automation" })
        .where(eq(contacts.id, contactId));
    }
  } else if (alreadyFull) {
    await storage.createConsentAuditLog({
      contactId,
      channel: "sms",
      action: "pewc_declined",
      consented: false,
      consentType: "express_written",
      source,
      ipAddress,
      userAgent,
      details: {
        ...details,
        disclosureVersion,
        noDowngradeApplied: true,
      },
    });
  }
}
