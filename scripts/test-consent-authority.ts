/**
 * BT-04A reducer acceptance suite.
 *
 * Requires an isolated, non-production Postgres database with the normal
 * DATABASE_URL configured. It intentionally never deletes canonical evidence;
 * CI isolation is supplied by the shared BT-04 runner.
 */
import crypto from "crypto";
import { db } from "../server/db";
import {
  contacts,
  consentAuditLogs,
  consentSubjects,
  consentSubjectChannelStates,
  consentSubjectGlobalSuppressions,
  consentSubjectReachability,
  sdrLeadState,
  sdrMerchants,
} from "../shared/schema";
import { and, eq } from "drizzle-orm";
import {
  applyConsentCommand,
  recordReachabilityObservation,
} from "../server/services/consent-authority";
import { handleEmailBounce } from "../server/services/sdr/webhook-handlers";
import { handleGhlWebhook } from "../server/services/ghl";
import { stripContactAuthorityFields } from "../server/services/contact-writer";
import { evaluateContactability } from "../server/services/contactability";
import { onOptOut } from "../server/services/sdr/ghl-sync-rules";
import { generateUnsubscribeToken, verifyUnsubscribeToken } from "../server/services/unsubscribe-token";
import { sql } from "drizzle-orm";

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to run consent authority tests against production");
}

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  PASS ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}`);
  }
}

async function createContact(label: string, phone = "3055550101") {
  const nonce = crypto.randomUUID();
  const [contact] = await db.insert(contacts).values({
    firstName: "BT04",
    lastName: label,
    email: `bt04-${label}-${nonce}@test.invalid`,
    phone,
    status: "New",
  }).returning();
  return contact;
}

async function main() {
  const contact = await createContact("race");
  const equalTime = new Date();
  const base = {
    subject: { type: "contact" as const, id: contact.id },
    purpose: "outreach",
    source: "bt04_test",
    evidence: { test: true },
    effectiveAt: equalTime,
  };

  const [optIn, optOut] = await Promise.all([
    applyConsentCommand({
      ...base,
      kind: "opt_in",
      channel: "email",
      eventNamespace: "bt04_test",
      eventKey: `${contact.id}:equal:opt-in`,
    }),
    applyConsentCommand({
      ...base,
      kind: "opt_out",
      channel: "email",
      eventNamespace: "bt04_test",
      eventKey: `${contact.id}:equal:opt-out`,
    }),
  ]);
  assert(optIn.applied || optOut.applied, "conflicting commands complete under concurrent transactions");

  const [optOutEvent] = await db.select({ id: consentAuditLogs.id }).from(consentAuditLogs).where(and(
    eq(consentAuditLogs.eventNamespace, "bt04_test"),
    eq(consentAuditLogs.eventKey, `${contact.id}:equal:opt-out`),
  ));
  const [state] = await db.select().from(consentSubjectChannelStates)
    .where(eq(consentSubjectChannelStates.sourceEventId, optOutEvent!.id))
    .limit(1);
  assert(state?.permissionState === "withdrawn", "equal-time restriction deterministically wins");

  const duplicateCommand = {
    ...base,
    kind: "opt_out" as const,
    channel: "sms" as const,
    eventNamespace: "bt04_test",
    eventKey: `${contact.id}:duplicate:sms`,
  };
  const [first, replay] = await Promise.all([
    applyConsentCommand(duplicateCommand),
    applyConsentCommand(duplicateCommand),
  ]);
  assert(first.duplicate !== replay.duplicate, "duplicate event key yields one logical canonical event");
  const canonicalRows = await db.select().from(consentAuditLogs).where(and(
    eq(consentAuditLogs.eventNamespace, "bt04_test"),
    eq(consentAuditLogs.eventKey, duplicateCommand.eventKey),
    eq(consentAuditLogs.recordKind, "canonical_fact"),
  ));
  assert(canonicalRows.length === 1, "canonical event uniqueness is database-enforced");
  let appendOnlyRejected = false;
  try {
    await db.execute(sql`UPDATE consent_audit_logs SET source = 'tampered' WHERE id = ${canonicalRows[0].id}`);
  } catch (error: any) {
    appendOnlyRejected = error?.code === "42501";
  }
  assert(appendOnlyRejected, "runtime SQL cannot update canonical consent evidence");

  const second = await createContact("reachability");
  await applyConsentCommand({
    subject: { type: "contact", id: second.id },
    kind: "opt_in",
    channel: "email",
    purpose: "outreach",
    eventNamespace: "bt04_test",
    eventKey: `${second.id}:email:opt-in`,
    source: "bt04_test",
    evidence: { test: true },
  });
  await recordReachabilityObservation({
    subject: { type: "contact", id: second.id },
    channel: "email",
    state: "bounced",
    eventNamespace: "bt04_test",
    eventKey: `${second.id}:email:bounced`,
    source: "bt04_test",
  });
  const [fresh] = await db.select().from(contacts).where(eq(contacts.id, second.id));
  assert(fresh?.consentEmail === true, "delivery bounce does not erase compatibility consent");

  const third = await createContact("stale-ordering");
  const newerOptIn = await applyConsentCommand({
    subject: { type: "contact", id: third.id },
    kind: "opt_in",
    channel: "email",
    purpose: "outreach",
    eventNamespace: "bt04_test",
    eventKey: `${third.id}:newer-opt-in`,
    source: "bt04_test",
    effectiveAt: new Date(),
    evidence: { test: true },
  });
  const staleOptOut = await applyConsentCommand({
    subject: { type: "contact", id: third.id },
    kind: "opt_out",
    channel: "email",
    purpose: "outreach",
    eventNamespace: "bt04_test",
    eventKey: `${third.id}:older-opt-out`,
    source: "bt04_test",
    effectiveAt: new Date(Date.now() - 60_000),
    evidence: { test: true },
  });
  const [newerState] = await db.select().from(consentSubjectChannelStates)
    .where(eq(consentSubjectChannelStates.sourceEventId, newerOptIn.eventId))
    .limit(1);
  assert(staleOptOut.applied === false && newerState?.permissionState === "permitted",
    "stale restrictive event cannot overwrite newer channel permission");

  const fourth = await createContact("pewc-atomic");
  const phoneWithdrawal = await applyConsentCommand({
    subject: { type: "contact", id: fourth.id },
    kind: "opt_out",
    channel: "automated_phone",
    purpose: "outreach",
    eventNamespace: "bt04_test",
    eventKey: `${fourth.id}:phone-withdrawal`,
    source: "bt04_test",
    effectiveAt: new Date(),
    evidence: { test: true },
  });
  const stalePewc = await applyConsentCommand({
    subject: { type: "contact", id: fourth.id },
    kind: "pewc_opt_in",
    channel: "sms",
    purpose: "outreach",
    eventNamespace: "bt04_test",
    eventKey: `${fourth.id}:stale-pewc`,
    source: "bt04_test",
    effectiveAt: new Date(Date.now() - 60_000),
    evidence: { consentedPhone: fourth.phone, disclosureVersion: "test-v1", disclosureHash: "test-hash" },
  });
  const [phoneState] = await db.select().from(consentSubjectChannelStates)
    .where(eq(consentSubjectChannelStates.sourceEventId, phoneWithdrawal.eventId))
    .limit(1);
  assert(stalePewc.applied === false && phoneState?.permissionState === "withdrawn",
    "stale PEWC grant cannot partially override a newer automated-phone withdrawal");

  const fifth = await createContact("stale-reachability");
  const latestObservation = new Date();
  await recordReachabilityObservation({
    subject: { type: "contact", id: fifth.id },
    channel: "email",
    state: "bounced",
    eventNamespace: "bt04_test",
    eventKey: `${fifth.id}:latest-bounce`,
    source: "bt04_test",
    observedAt: latestObservation,
  });
  await recordReachabilityObservation({
    subject: { type: "contact", id: fifth.id },
    channel: "email",
    state: "reachable",
    eventNamespace: "bt04_test",
    eventKey: `${fifth.id}:stale-reachable`,
    source: "bt04_test",
    observedAt: new Date(latestObservation.getTime() - 60_000),
  });
  const [reachability] = await db.select({ state: consentSubjectReachability.reachabilityState })
    .from(consentSubjectReachability)
    .innerJoin(consentSubjects, eq(consentSubjects.id, consentSubjectReachability.subjectId))
    .where(and(eq(consentSubjects.subjectType, "contact"), eq(consentSubjects.subjectRecordId, fifth.id)))
    .limit(1);
  assert(reachability?.state === "bounced", "stale reachability observation cannot overwrite a newer state");

  const replayContact = await createContact("reachability-replay");
  const replayObservedAt = new Date(Date.now() + 1_000);
  await recordReachabilityObservation({
    subject: { type: "contact", id: replayContact.id },
    channel: "email", state: "bounced", eventNamespace: "bt04_test",
    eventKey: `${replayContact.id}:immutable-reachability`, source: "bt04_test",
    observedAt: replayObservedAt,
  });
  await recordReachabilityObservation({
    subject: { type: "contact", id: replayContact.id },
    channel: "email", state: "reachable", eventNamespace: "bt04_test",
    eventKey: `${replayContact.id}:immutable-reachability`, source: "bt04_test",
    observedAt: new Date(replayObservedAt.getTime() + 60_000),
  });
  const [replayedReachability] = await db.select({ state: consentSubjectReachability.reachabilityState })
    .from(consentSubjectReachability)
    .innerJoin(consentSubjects, eq(consentSubjects.id, consentSubjectReachability.subjectId))
    .where(and(eq(consentSubjects.subjectType, "contact"), eq(consentSubjects.subjectRecordId, replayContact.id)))
    .limit(1);
  assert(replayedReachability?.state === "bounced", "duplicate reachability key cannot alter the existing projection");

  const channelContact = await createContact("channel-reconsent");
  await applyConsentCommand({
    subject: { type: "contact", id: channelContact.id }, kind: "opt_out", channel: "email",
    purpose: "outreach", eventNamespace: "bt04_test", eventKey: `${channelContact.id}:email-withdraw`,
    source: "bt04_test", evidence: { reason: "email opt-out" },
  });
  await applyConsentCommand({
    subject: { type: "contact", id: channelContact.id }, kind: "opt_in", channel: "email",
    purpose: "outreach", eventNamespace: "bt04_test", eventKey: `${channelContact.id}:email-reconsent`,
    source: "bt04_test", effectiveAt: new Date(Date.now() + 1), evidence: { reason: "written re-consent" },
  });
  const [reconsentedContact] = await db.select().from(contacts).where(eq(contacts.id, channelContact.id));
  assert(reconsentedContact?.consentEmail === true && reconsentedContact?.emailStatus === "active" &&
    reconsentedContact?.doNotAutoContact !== true && reconsentedContact?.smsStatus !== "opted_out",
    "email re-consent restores only email compatibility without suppressing SMS");

  const splitChannelContact = await createContact("split-channel", "3055550199");
  await applyConsentCommand({
    subject: { type: "contact", id: splitChannelContact.id }, kind: "pewc_opt_in", channel: "sms",
    purpose: "outreach", eventNamespace: "bt04_test", eventKey: `${splitChannelContact.id}:pewc`,
    source: "bt04_test",
    evidence: { consentedPhone: splitChannelContact.phone, disclosureVersion: "test-v1", disclosureHash: "test-hash" },
  });
  await applyConsentCommand({
    subject: { type: "contact", id: splitChannelContact.id }, kind: "opt_out", channel: "automated_phone",
    purpose: "outreach", eventNamespace: "bt04_test", eventKey: `${splitChannelContact.id}:phone-withdraw`,
    source: "bt04_test", evidence: { reason: "automated phone withdrawal" },
  });
  await applyConsentCommand({
    subject: { type: "contact", id: splitChannelContact.id }, kind: "opt_in", channel: "sms",
    purpose: "outreach", eventNamespace: "bt04_test", eventKey: `${splitChannelContact.id}:sms-reconsent`,
    source: "bt04_test", effectiveAt: new Date(Date.now() + 1), evidence: { reason: "SMS-only re-consent" },
  });
  const voiceAfterSmsReconsent = await evaluateContactability({
    contactId: splitChannelContact.id, channel: "voice_ai", mode: "dryRun",
  });
  const smsAfterPhoneWithdrawal = await evaluateContactability({
    contactId: splitChannelContact.id, channel: "sms", mode: "dryRun",
  });
  assert(!voiceAfterSmsReconsent.allowed && voiceAfterSmsReconsent.reason.includes("Canonical automated_phone"),
    "SMS-only re-consent cannot reopen a withdrawn automated-phone channel");
  assert(!smsAfterPhoneWithdrawal.reason.includes("Canonical sms permission is withdrawn"),
    "automated-phone withdrawal does not become an SMS withdrawal");

  const phoneRotationContact = await createContact("pewc-phone-rotation", "3055550188");
  await applyConsentCommand({
    subject: { type: "contact", id: phoneRotationContact.id }, kind: "pewc_opt_in", channel: "sms",
    purpose: "outreach", eventNamespace: "pewc", eventKey: `${phoneRotationContact.id}:old-phone-pewc`,
    source: "test", evidence: {
      consentedPhone: phoneRotationContact.phone, disclosureVersion: "test-v1", disclosureHash: "test-hash",
    },
  });
  await db.update(contacts).set({ phone: "3055550189" }).where(eq(contacts.id, phoneRotationContact.id));
  const rotatedSms = await evaluateContactability({ contactId: phoneRotationContact.id, channel: "sms", mode: "dryRun" });
  const rotatedVoice = await evaluateContactability({ contactId: phoneRotationContact.id, channel: "voice_ai", mode: "dryRun" });
  const rotatedRingless = await evaluateContactability({ contactId: phoneRotationContact.id, channel: "ringless_vm", mode: "dryRun" });
  assert(!rotatedSms.allowed && !rotatedVoice.allowed && !rotatedRingless.allowed,
    "a phone change invalidates PEWC for SMS, AI voice, and ringless until fresh evidence is recorded");

  const sixth = await createContact("sdr-ghl-bounce");
  const ghlContactId = `bt04-ghl-bounce-${sixth.id}`;
  await db.update(contacts).set({ ghlContactId }).where(eq(contacts.id, sixth.id));
  await handleEmailBounce({
    contactId: ghlContactId,
    email: sixth.email!,
    messageId: `bt04-message-${sixth.id}`,
    status: "bounced",
  });
  const [sdrBounceFact] = await db.select({ recordKind: consentAuditLogs.recordKind })
    .from(consentAuditLogs)
    .where(and(
      eq(consentAuditLogs.eventNamespace, "sdr_ghl_webhook"),
      eq(consentAuditLogs.eventKey, `email_bounce:bt04-message-${sixth.id}`),
    ))
    .limit(1);
  const [sdrBounceReachability] = await db.select({ state: consentSubjectReachability.reachabilityState })
    .from(consentSubjectReachability)
    .innerJoin(consentSubjects, eq(consentSubjects.id, consentSubjectReachability.subjectId))
    .where(and(eq(consentSubjects.subjectType, "contact"), eq(consentSubjects.subjectRecordId, sixth.id)))
    .limit(1);
  assert(sdrBounceFact?.recordKind === "reachability_fact" && sdrBounceReachability?.state === "bounced",
    "SDR GHL bounce writes canonical reachability fact and projection");

  const seventh = await createContact("global-dnc");
  const globalDnc = await applyConsentCommand({
    subject: { type: "contact", id: seventh.id },
    kind: "global_dnc",
    purpose: "outreach",
    eventNamespace: "contacts_mark_dnc",
    eventKey: `${seventh.id}:mark-dnc:test`,
    source: "manual_crm",
    evidence: { reason: "test global suppression" },
  });
  const [globalProjection] = await db.select({ suppressed: consentSubjectGlobalSuppressions.isSuppressed })
    .from(consentSubjectGlobalSuppressions)
    .innerJoin(consentSubjects, eq(consentSubjects.id, consentSubjectGlobalSuppressions.subjectId))
    .where(and(eq(consentSubjects.subjectType, "contact"), eq(consentSubjects.subjectRecordId, seventh.id)))
    .limit(1);
  const [globalFact] = await db.select({ recordKind: consentAuditLogs.recordKind })
    .from(consentAuditLogs)
    .where(eq(consentAuditLogs.id, globalDnc.eventId))
    .limit(1);
  assert(globalProjection?.suppressed === true && globalFact?.recordKind === "canonical_fact",
    "dashboard global DNC command writes canonical event and suppression projection");

  const genericMutation = stripContactAuthorityFields({
    firstName: "BT04", lastName: "generic-create",
    email: `bt04-generic-${crypto.randomUUID()}@test.invalid`, phone: "3055550101",
    consentEmail: true, consentSms: true, doNotContact: true, consentTier: "pewc_full_automation",
  });
  assert(!("consentEmail" in genericMutation) && !("consentSms" in genericMutation) &&
    !("doNotContact" in genericMutation) && !("consentTier" in genericMutation),
    "generic contact creation strips authority-owned affirmative projections before every sink");

  const [merchant] = await db.insert(sdrMerchants).values({
    businessName: `BT04 SDR ${crypto.randomUUID()}`,
  }).returning();
  const [sdrLead] = await db.insert(sdrLeadState).values({
    merchantId: merchant.id,
    companyName: merchant.businessName,
    phone: "3055550101",
    consentCall: true,
  }).returning();
  await applyConsentCommand({
    subject: { type: "sdr_lead_state", id: sdrLead.id },
    kind: "opt_out",
    channel: "automated_phone",
    purpose: "outreach",
    eventNamespace: "bt04_test",
    eventKey: `${sdrLead.id}:operator-call-withdraw`,
    source: "sdr_operator_edit",
    evidence: { operatorEvidence: "withdraw call authorization" },
  });
  const [withdrawnSdrLead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, sdrLead.id));
  assert(withdrawnSdrLead?.consentCall === false,
    "SDR automated-phone withdrawal disables legacy stage-rule call eligibility");
  await applyConsentCommand({
    subject: { type: "sdr_lead_state", id: sdrLead.id },
    kind: "opt_in",
    channel: "automated_phone",
    purpose: "outreach",
    eventNamespace: "bt04_test",
    eventKey: `${sdrLead.id}:operator-call-grant`,
    source: "sdr_operator_edit",
    effectiveAt: new Date(Date.now() + 1),
    evidence: { operatorEvidence: "written call authorization" },
  });
  const [grantedSdrLead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, sdrLead.id));
  assert(grantedSdrLead?.consentCall === true,
    "SDR automated-phone grant restores legacy stage-rule call eligibility");
  await onOptOut(merchant.id, "call", "provider-occurrence-one");
  await applyConsentCommand({
    subject: { type: "sdr_lead_state", id: sdrLead.id },
    kind: "opt_in", channel: "automated_phone", purpose: "outreach",
    eventNamespace: "bt04_test", eventKey: `${sdrLead.id}:reconsent-after-provider-withdrawal`,
    source: "sdr_operator_edit", effectiveAt: new Date(Date.now() + 2),
    evidence: { operatorEvidence: "written call authorization" },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await onOptOut(merchant.id, "call", "provider-occurrence-two");
  const [sdrFinalState] = await db.select({ state: consentSubjectChannelStates.permissionState })
    .from(consentSubjectChannelStates)
    .innerJoin(consentSubjects, eq(consentSubjects.id, consentSubjectChannelStates.subjectId))
    .where(and(
      eq(consentSubjects.subjectType, "sdr_lead_state"),
      eq(consentSubjects.subjectRecordId, sdrLead.id),
      eq(consentSubjectChannelStates.channel, "automated_phone"),
    ))
    .limit(1);
  assert(sdrFinalState?.state === "withdrawn",
    "a later SDR provider opt-out after re-consent withdraws the channel again");

  const csvLifecycle = await createContact("csv-opt-out-lifecycle");
  const applyCsvWithdrawal = (executionId: number, effectiveAt?: Date) => applyConsentCommand({
    subject: { type: "contact", id: csvLifecycle.id }, kind: "opt_out", channel: "email",
    purpose: "outreach", eventNamespace: "csv_import",
    eventKey: `execution:${executionId}:row:0:restrict`, source: "csv_import",
    ...(effectiveAt ? { effectiveAt } : {}),
    evidence: { csvEmailStatus: "opted_out", importExecutionId: executionId },
  });
  const csvExecutionOne = csvLifecycle.id * 10 + 1;
  const csvExecutionTwo = csvLifecycle.id * 10 + 2;
  await applyCsvWithdrawal(csvExecutionOne);
  await applyConsentCommand({
    subject: { type: "contact", id: csvLifecycle.id }, kind: "opt_in", channel: "email",
    purpose: "outreach", eventNamespace: "bt04_test", eventKey: `${csvLifecycle.id}:csv-reconsent`,
    source: "manual_crm", effectiveAt: new Date(Date.now() + 3),
    evidence: { operatorEvidence: "written email authorization" },
  });
  await applyCsvWithdrawal(csvExecutionTwo, new Date(Date.now() + 10_000));
  const [csvFinalState] = await db.select({ state: consentSubjectChannelStates.permissionState })
    .from(consentSubjectChannelStates)
    .innerJoin(consentSubjects, eq(consentSubjects.id, consentSubjectChannelStates.subjectId))
    .where(and(
      eq(consentSubjects.subjectType, "contact"),
      eq(consentSubjects.subjectRecordId, csvLifecycle.id),
      eq(consentSubjectChannelStates.channel, "email"),
    ))
    .limit(1);
  assert(csvFinalState?.state === "withdrawn",
    "a later CSV import occurrence after re-consent withdraws email again");

  const unsubscribeLifecycle = await createContact("public-unsubscribe-lifecycle");
  const firstUnsubscribe = verifyUnsubscribeToken(generateUnsubscribeToken(unsubscribeLifecycle.id));
  const secondUnsubscribe = verifyUnsubscribeToken(generateUnsubscribeToken(unsubscribeLifecycle.id));
  assert(firstUnsubscribe.valid && secondUnsubscribe.valid &&
    firstUnsubscribe.occurrenceId !== secondUnsubscribe.occurrenceId,
    "each public unsubscribe message has a distinct signed occurrence identity");
  if (firstUnsubscribe.valid && secondUnsubscribe.valid) {
    await applyConsentCommand({
      subject: { type: "contact", id: unsubscribeLifecycle.id }, kind: "opt_out", channel: "email",
      purpose: "outreach", eventNamespace: "public_unsubscribe",
      eventKey: `contact:${unsubscribeLifecycle.id}:occurrence:${firstUnsubscribe.occurrenceId}`,
      source: "campaign_unsubscribe", evidence: { tokenVerified: true },
    });
    await applyConsentCommand({
      subject: { type: "contact", id: unsubscribeLifecycle.id }, kind: "opt_in", channel: "email",
      purpose: "outreach", eventNamespace: "bt04_test", eventKey: `${unsubscribeLifecycle.id}:public-reconsent`,
      source: "manual_crm", effectiveAt: new Date(Date.now() + 3),
      evidence: { operatorEvidence: "written email authorization" },
    });
    await applyConsentCommand({
      subject: { type: "contact", id: unsubscribeLifecycle.id }, kind: "opt_out", channel: "email",
      purpose: "outreach", eventNamespace: "public_unsubscribe",
      eventKey: `contact:${unsubscribeLifecycle.id}:occurrence:${secondUnsubscribe.occurrenceId}`,
      source: "campaign_unsubscribe", effectiveAt: new Date(Date.now() + 10_000),
      evidence: { tokenVerified: true },
    });
    const [unsubscribeFinalState] = await db.select({ state: consentSubjectChannelStates.permissionState })
      .from(consentSubjectChannelStates)
      .innerJoin(consentSubjects, eq(consentSubjects.id, consentSubjectChannelStates.subjectId))
      .where(and(
        eq(consentSubjects.subjectType, "contact"),
        eq(consentSubjects.subjectRecordId, unsubscribeLifecycle.id),
        eq(consentSubjectChannelStates.channel, "email"),
      ))
      .limit(1);
    assert(unsubscribeFinalState?.state === "withdrawn",
      "a later public unsubscribe after re-consent withdraws email again");
  }

  const providerChannelLifecycle = await createContact("provider-channel-occurrence-lifecycle");
  const applyProviderChannelWithdrawal = (occurrenceId: string, effectiveAt?: Date) =>
    applyConsentCommand({
      subject: { type: "contact", id: providerChannelLifecycle.id }, kind: "opt_out", channel: "email",
      purpose: "outreach", eventNamespace: "ghl_inbound_unsubscribe",
      eventKey: `${providerChannelLifecycle.id}:unsubscribe:${occurrenceId}`, source: "provider_test",
      ...(effectiveAt ? { effectiveAt } : {}),
      evidence: { providerOccurrenceId: occurrenceId },
    });
  await applyProviderChannelWithdrawal("ghl-occurrence-one");
  await applyConsentCommand({
    subject: { type: "contact", id: providerChannelLifecycle.id }, kind: "opt_in", channel: "email",
    purpose: "outreach", eventNamespace: "bt04_test", eventKey: `${providerChannelLifecycle.id}:provider-reconsent`,
    source: "manual_crm", effectiveAt: new Date(Date.now() + 4),
    evidence: { operatorEvidence: "written email authorization" },
  });
  await applyProviderChannelWithdrawal("ghl-occurrence-two", new Date(Date.now() + 10_000));
  const [providerFinalState] = await db.select({ state: consentSubjectChannelStates.permissionState })
    .from(consentSubjectChannelStates)
    .innerJoin(consentSubjects, eq(consentSubjects.id, consentSubjectChannelStates.subjectId))
    .where(and(
      eq(consentSubjects.subjectType, "contact"),
      eq(consentSubjects.subjectRecordId, providerChannelLifecycle.id),
      eq(consentSubjectChannelStates.channel, "email"),
    ))
    .limit(1);
  assert(providerFinalState?.state === "withdrawn",
    "a later GHL/workflow occurrence after re-consent withdraws the channel again");

  const noProviderIdLifecycle = await createContact("ghl-no-provider-id-lifecycle");
  const applyNoIdMessageWithdrawal = (activityId: number, effectiveAt?: Date) => applyConsentCommand({
    subject: { type: "contact", id: noProviderIdLifecycle.id }, kind: "opt_out", channel: "sms",
    purpose: "outreach", eventNamespace: "ghl_inbound_message",
    eventKey: `${noProviderIdLifecycle.id}:sms:activity:${activityId}`,
    source: "ghl_inbound_message", ...(effectiveAt ? { effectiveAt } : {}),
    evidence: { inboundOccurrenceId: `activity:${activityId}`, messageId: null },
  });
  await applyNoIdMessageWithdrawal(noProviderIdLifecycle.id * 10 + 1);
  await applyConsentCommand({
    subject: { type: "contact", id: noProviderIdLifecycle.id }, kind: "opt_in", channel: "sms",
    purpose: "outreach", eventNamespace: "bt04_test", eventKey: `${noProviderIdLifecycle.id}:sms-reconsent`,
    source: "manual_crm", effectiveAt: new Date(Date.now() + 5),
    evidence: { operatorEvidence: "written SMS authorization" },
  });
  await applyNoIdMessageWithdrawal(noProviderIdLifecycle.id * 10 + 2, new Date(Date.now() + 10_000));
  const [noProviderIdFinalState] = await db.select({ state: consentSubjectChannelStates.permissionState })
    .from(consentSubjectChannelStates)
    .innerJoin(consentSubjects, eq(consentSubjects.id, consentSubjectChannelStates.subjectId))
    .where(and(
      eq(consentSubjects.subjectType, "contact"),
      eq(consentSubjects.subjectRecordId, noProviderIdLifecycle.id),
      eq(consentSubjectChannelStates.channel, "sms"),
    ))
    .limit(1);
  assert(noProviderIdFinalState?.state === "withdrawn",
    "repeated no-ID GHL unsubscribe messages use distinct persisted occurrences");

  const rejectedReplayContact = await createContact("rejected-replay");
  const rejectedReplayKey = `${rejectedReplayContact.id}:rejected-grant`;
  const rejectedReplayBase = new Date(Date.now() - 60_000);
  await applyConsentCommand({
    subject: { type: "contact", id: rejectedReplayContact.id }, kind: "opt_out", channel: "email",
    purpose: "outreach", eventNamespace: "bt04_test",
    eventKey: `${rejectedReplayContact.id}:initial-withdrawal`, source: "test",
    effectiveAt: new Date(rejectedReplayBase.getTime() + 20_000),
    evidence: { providerOccurrenceId: "initial-withdrawal" },
  });
  const rejectedGrant = await applyConsentCommand({
    subject: { type: "contact", id: rejectedReplayContact.id }, kind: "opt_in", channel: "email",
    purpose: "outreach", eventNamespace: "bt04_test", eventKey: rejectedReplayKey, source: "test",
    effectiveAt: new Date(rejectedReplayBase.getTime() + 10_000),
    evidence: { operatorEvidence: "written email authorization" },
  });
  await applyConsentCommand({
    subject: { type: "contact", id: rejectedReplayContact.id }, kind: "opt_out", channel: "email",
    purpose: "outreach", eventNamespace: "bt04_test",
    eventKey: `${rejectedReplayContact.id}:later-withdrawal`, source: "test",
    effectiveAt: new Date(rejectedReplayBase.getTime() + 30_000),
    evidence: { providerOccurrenceId: "later-withdrawal" },
  });
  const replayedRejectedGrant = await applyConsentCommand({
    subject: { type: "contact", id: rejectedReplayContact.id }, kind: "opt_in", channel: "email",
    purpose: "outreach", eventNamespace: "bt04_test", eventKey: rejectedReplayKey, source: "test",
    effectiveAt: new Date(rejectedReplayBase.getTime() + 50_000),
    evidence: { operatorEvidence: "written email authorization" },
  });
  const [rejectedReplayState] = await db.select({ state: consentSubjectChannelStates.permissionState })
    .from(consentSubjectChannelStates)
    .innerJoin(consentSubjects, eq(consentSubjects.id, consentSubjectChannelStates.subjectId))
    .where(and(
      eq(consentSubjects.subjectType, "contact"),
      eq(consentSubjects.subjectRecordId, rejectedReplayContact.id),
      eq(consentSubjectChannelStates.channel, "email"),
    ))
    .limit(1);
  assert(
    !rejectedGrant.applied &&
    replayedRejectedGrant.duplicate &&
    !replayedRejectedGrant.applied &&
    rejectedReplayState?.state === "withdrawn",
    "a rejected occurrence remains idempotent and cannot re-enable consent after state changes",
  );

  const noIdHandlerContact = await createContact("ghl-handler-no-id");
  const noIdHandlerGhlId = `bt04-no-id-${noIdHandlerContact.id}`;
  await db.update(contacts).set({ ghlContactId: noIdHandlerGhlId }).where(eq(contacts.id, noIdHandlerContact.id));
  await handleGhlWebhook({ type: "SMS", direction: "inbound", contactId: noIdHandlerGhlId, body: "STOP" });
  await handleGhlWebhook({ type: "SMS", direction: "inbound", contactId: noIdHandlerGhlId, body: "STOP" });
  const noIdHandlerEvents = await db.select({ eventKey: consentAuditLogs.eventKey })
    .from(consentAuditLogs)
    .where(and(
      eq(consentAuditLogs.eventNamespace, "ghl_inbound_message"),
      sql`${consentAuditLogs.eventKey} LIKE ${`${noIdHandlerContact.id}:sms:activity:%`}`,
    ));
  const handlerChannelStates = await db.select({
    channel: consentSubjectChannelStates.channel,
    state: consentSubjectChannelStates.permissionState,
  })
    .from(consentSubjectChannelStates)
    .innerJoin(consentSubjects, eq(consentSubjects.id, consentSubjectChannelStates.subjectId))
    .where(and(
      eq(consentSubjects.subjectType, "contact"),
      eq(consentSubjects.subjectRecordId, noIdHandlerContact.id),
    ));
  const [handlerContactAfterStop] = await db.select().from(contacts).where(eq(contacts.id, noIdHandlerContact.id));
  const [handlerGlobalSuppression] = await db.select({ suppressed: consentSubjectGlobalSuppressions.isSuppressed })
    .from(consentSubjectGlobalSuppressions)
    .innerJoin(consentSubjects, eq(consentSubjects.id, consentSubjectGlobalSuppressions.subjectId))
    .where(and(
      eq(consentSubjects.subjectType, "contact"),
      eq(consentSubjects.subjectRecordId, noIdHandlerContact.id),
    ))
    .limit(1);
  const stateFor = (channel: string) => handlerChannelStates.find((row) => row.channel === channel)?.state;
  assert(noIdHandlerEvents.length === 4 && new Set(noIdHandlerEvents.map((row) => row.eventKey)).size === 4,
    "two identical no-ID GHL STOP deliveries use distinct persisted activity occurrences");
  assert(
    stateFor("sms") === "withdrawn" &&
    stateFor("automated_phone") === "withdrawn" &&
    stateFor("email") === undefined &&
    handlerContactAfterStop?.doNotContact !== true &&
    handlerGlobalSuppression?.suppressed !== true,
    "GHL SMS STOP withdraws SMS and automated phone without creating email or global DNC suppression",
  );

  const nativeDndContact = await createContact("ghl-native-sms-dnd");
  const nativeDndGhlId = `bt04-native-dnd-${nativeDndContact.id}`;
  await db.update(contacts).set({ ghlContactId: nativeDndGhlId }).where(eq(contacts.id, nativeDndContact.id));
  await handleGhlWebhook({ type: "SMSDNDUpdated", contactId: nativeDndGhlId, status: "active" });
  const nativeDndStates = await db.select({
    channel: consentSubjectChannelStates.channel,
    state: consentSubjectChannelStates.permissionState,
  })
    .from(consentSubjectChannelStates)
    .innerJoin(consentSubjects, eq(consentSubjects.id, consentSubjectChannelStates.subjectId))
    .where(and(
      eq(consentSubjects.subjectType, "contact"),
      eq(consentSubjects.subjectRecordId, nativeDndContact.id),
    ));
  const [nativeDndGlobal] = await db.select({ suppressed: consentSubjectGlobalSuppressions.isSuppressed })
    .from(consentSubjectGlobalSuppressions)
    .innerJoin(consentSubjects, eq(consentSubjects.id, consentSubjectGlobalSuppressions.subjectId))
    .where(and(
      eq(consentSubjects.subjectType, "contact"),
      eq(consentSubjects.subjectRecordId, nativeDndContact.id),
    ))
    .limit(1);
  assert(
    nativeDndStates.find((row) => row.channel === "sms")?.state === "withdrawn" &&
    nativeDndStates.find((row) => row.channel === "automated_phone")?.state === "withdrawn" &&
    nativeDndGlobal?.suppressed !== true,
    "native GHL SMS DND withdraws SMS and automated phone without global suppression",
  );

  const inboxEmailContact = await createContact("inbox-email-unsubscribe");
  await applyConsentCommand({
    subject: { type: "contact", id: inboxEmailContact.id }, kind: "opt_out", channel: "email",
    purpose: "outreach", eventNamespace: "inbox_action",
    eventKey: `bt04-inbox-${inboxEmailContact.id}:mark_unsubscribed:email`,
    source: "inbox_stop_or_angry",
    evidence: { inboxItemId: `bt04-inbox-${inboxEmailContact.id}`, inboundChannel: "email" },
  });
  const inboxStates = await db.select({
    channel: consentSubjectChannelStates.channel,
    state: consentSubjectChannelStates.permissionState,
  })
    .from(consentSubjectChannelStates)
    .innerJoin(consentSubjects, eq(consentSubjects.id, consentSubjectChannelStates.subjectId))
    .where(and(
      eq(consentSubjects.subjectType, "contact"),
      eq(consentSubjects.subjectRecordId, inboxEmailContact.id),
    ));
  const [inboxGlobal] = await db.select({ suppressed: consentSubjectGlobalSuppressions.isSuppressed })
    .from(consentSubjectGlobalSuppressions)
    .innerJoin(consentSubjects, eq(consentSubjects.id, consentSubjectGlobalSuppressions.subjectId))
    .where(and(
      eq(consentSubjects.subjectType, "contact"),
      eq(consentSubjects.subjectRecordId, inboxEmailContact.id),
    ))
    .limit(1);
  assert(
    inboxStates.find((row) => row.channel === "email")?.state === "withdrawn" &&
    inboxStates.find((row) => row.channel === "sms") === undefined &&
    inboxStates.find((row) => row.channel === "automated_phone") === undefined &&
    inboxGlobal?.suppressed !== true,
    "inbox email unsubscribe withdraws only email without global or phone suppression",
  );

  console.log(`\nBT-04A authority results: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});