/**
 * Guard the consent-authority migration against the known high-risk regressions.
 * This is intentionally narrow and mechanical; new semantic writers must be
 * added to the reducer rather than bypassing it.
 */
import fs from "node:fs";

const files = [
  "server/routes/wizard.ts",
  "server/services/sunbiz-cron.ts",
  "server/services/sdr/chat-handlers.ts",
  "server/services/sdr/orchestrator.ts",
  "server/services/communication-feedback.ts",
  "server/services/bounce-feedback.ts",
  "server/routes/public.ts",
];
const banned = [
  /consentEmail:\s*true/,
  /consentSms:\s*true/,
  /consentTier:\s*["']pewc_full_automation["']/,
];
let failures = 0;

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const pattern of banned) {
    if (pattern.test(text)) {
      console.error(`FAIL ${file}: prohibited direct affirmative consent projection (${pattern})`);
      failures++;
    }
  }
}

for (const file of [
  "server/routes/public.ts",
  "server/routes/campaigns.ts",
  "server/routes/inbox.ts",
  "server/routes/sdr.ts",
  "server/services/ghl.ts",
  "server/services/workflow-executor.ts",
  "server/services/sdr/webhook-handlers.ts",
]) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes("applyConsentCommand")) {
    console.error(`FAIL ${file}: expected canonical consent authority import/use`);
    failures++;
  }
}

// Public forms may pass consent intent to the existing-contact merge (which
// invokes the reducer), but a new-contact mutation must never seed a legacy
// affirmative projection before its canonical command commits.
const publicSource = fs.readFileSync("server/routes/public.ts", "utf8");
const publicMutations = publicSource.matchAll(/mutation:\s*\{([\s\S]*?)\n\s*\},\s*\n\s*provenance:/g);
for (const match of publicMutations) {
  if (/\b(consentEmail|consentSms|consentTier|doNotContact|doNotAutoContact)\s*:/.test(match[1])) {
    console.error("FAIL server/routes/public.ts: a new-contact mutation seeds an authority-owned consent projection");
    failures++;
  }
}

const sdrWebhookSource = fs.readFileSync("server/services/sdr/webhook-handlers.ts", "utf8");
if (!/handleEmailBounce[\s\S]*recordReachabilityObservation/.test(sdrWebhookSource)) {
  console.error("FAIL server/services/sdr/webhook-handlers.ts: GHL email bounces must record canonical reachability");
  failures++;
}
const optOutSection = sdrWebhookSource.split("export async function handleOptOut")[1] ?? "";
if (!/applyContactOptOut\(contact\.id,[\s\S]{0,180}suppressAfterCanonicalOptOut\(contact\.id/.test(optOutSection) ||
    !/suppressAfterCanonicalOptOut[\s\S]*try[\s\S]*suppressNewLeadAutoEnrollmentForContact[\s\S]*catch/.test(optOutSection)) {
  console.error("FAIL server/services/sdr/webhook-handlers.ts: canonical opt-out must commit before best-effort enrollment suppression");
  failures++;
}
const wizardSource = fs.readFileSync("server/routes/wizard.ts", "utf8");
for (const route of ["email", "sms", "voice", "voicemail"]) {
  const routeSection = wizardSource.split(`/api/wizard/test-send/${route}`)[1]?.slice(0, 1200) ?? "";
  if (!routeSection.includes("wizardProviderTestBlocked(res)")) {
    console.error(`FAIL server/routes/wizard.ts: wizard ${route} provider test lacks the isolated-transport guard`);
    failures++;
  }
}
const contactsRouteSource = fs.readFileSync("server/routes/contacts.ts", "utf8");
const markDncSection = contactsRouteSource.split('"/api/contacts/:id/mark-dnc"')[1]?.slice(0, 3500) ?? "";
if (!markDncSection.includes("applyConsentCommand") || /UPDATE\s+contacts\s+SET/i.test(markDncSection)) {
  console.error("FAIL server/routes/contacts.ts: mark-dnc must use the canonical global-DNC command without raw contact suppression SQL");
  failures++;
}
const contactWriterSource = fs.readFileSync("server/services/contact-writer.ts", "utf8");
if (!contactWriterSource.includes("stripContactAuthorityFields(args.mutation)") ||
    !/consentSms:\s*false/.test(contactWriterSource) ||
    !/consentEmail:\s*false/.test(contactWriterSource)) {
  console.error("FAIL server/services/contact-writer.ts: generic contact creation must strip authority fields before provider and database writes");
  failures++;
}
const sdrOrchestratorSource = fs.readFileSync("server/services/sdr/orchestrator.ts", "utf8");
if (/consentSms:\s*contact\.consentSms/.test(sdrOrchestratorSource) ||
    !/consentSms:\s*false/.test(sdrOrchestratorSource)) {
  console.error("FAIL server/services/sdr/orchestrator.ts: SDR conversion must not copy legacy consent into a new subject");
  failures++;
}
const bounceFeedbackSource = fs.readFileSync("server/services/bounce-feedback.ts", "utf8");
if (/\.update\(contacts\)[\s\S]{0,200}emailStatus/.test(bounceFeedbackSource) ||
    !/eventKey:\s*`outbound_message:\$\{message\.id\}:bounced`/.test(bounceFeedbackSource)) {
  console.error("FAIL server/services/bounce-feedback.ts: bounce feedback must use per-message canonical reachability events without direct contact status writes");
  failures++;
}
const communicationFeedbackSource = fs.readFileSync("server/services/communication-feedback.ts", "utf8");
if (/updates\.(emailStatus|smsStatus|doNotAutoContact)\s*=/.test(communicationFeedbackSource) ||
    !communicationFeedbackSource.includes("await recordReachabilityObservation")) {
  console.error("FAIL server/services/communication-feedback.ts: delivery feedback must record reachability before writing unrelated contact feedback");
  failures++;
}
const authoritySource = fs.readFileSync("server/services/consent-authority.ts", "utf8");
if (/email_status = 'opted_out', do_not_auto_contact/.test(authoritySource) ||
    /sms_status = 'opted_out',\s*\n\s*do_not_auto_contact/.test(authoritySource) ||
    !authoritySource.includes("if (!inserted) return;")) {
  console.error("FAIL server/services/consent-authority.ts: channel opt-outs must remain channel-scoped and reachability replays must be idempotent");
  failures++;
}
const contactabilitySource = fs.readFileSync("server/services/contactability.ts", "utf8");
if (!contactabilitySource.includes("consentSubjectChannelStates") ||
    !contactabilitySource.includes("Canonical ${canonicalChannel} permission is withdrawn or suppressed")) {
  console.error("FAIL server/services/contactability.ts: live contactability must enforce canonical channel projections");
  failures++;
}
const sdrGhlRulesSource = fs.readFileSync("server/services/sdr/ghl-sync-rules.ts", "utf8");
const importSource = fs.readFileSync("server/routes/imports.ts", "utf8");
if (!sdrGhlRulesSource.includes("${merchantId}:${channel}:${occurrenceKey}") ||
    !importSource.includes("execution:${importExecution.id}:row:${rowIndex}:restrict")) {
  console.error("FAIL withdrawal writers must use occurrence keys, not permanent subject/status keys");
  failures++;
}
const unsubscribeRouteSource = fs.readFileSync("server/routes/public.ts", "utf8");
const unsubscribeTokenSource = fs.readFileSync("server/services/unsubscribe-token.ts", "utf8");
if (!unsubscribeRouteSource.includes("occurrence:${occurrenceId}") ||
    !unsubscribeTokenSource.includes("crypto.randomUUID()") ||
    !unsubscribeTokenSource.includes("email_unsubscribe:${contactId}:${occurrenceId}")) {
  console.error("FAIL public unsubscribe must use a signed per-message occurrence key");
  failures++;
}
const ghlSource = fs.readFileSync("server/services/ghl.ts", "utf8");
const workflowSource = fs.readFileSync("server/services/workflow-executor.ts", "utf8");
if (!ghlSource.includes("unsubscribe:${webhookOccurrenceId}") ||
    !ghlSource.includes("dnc:${occurrenceId}") ||
    !workflowSource.includes("unsubscribe:${occurrenceId}") ||
    !ghlSource.includes("activity:${inboundActivity.id}")) {
  console.error("FAIL GHL and workflow restrictive events must use occurrence-specific keys");
  failures++;
}
if (!ghlSource.includes('["sms", "automated_phone"] as const') ||
    !workflowSource.includes('["sms", "automated_phone"] as const') ||
    !ghlSource.includes(':${type}:${eventFingerprint}:automated_phone')) {
  console.error("FAIL GHL and workflow SMS unsubscribe handling must remain channel-scoped");
  failures++;
}
const inboxSource = fs.readFileSync("server/routes/inbox.ts", "utf8");
if (!inboxSource.includes('channelStr === "sms" || channelStr === "email"') ||
    !inboxSource.includes('kind: withdrawalChannel ? "opt_out" : "global_dnc"')) {
  console.error("FAIL inbox unsubscribe handling must keep known email/SMS channels scoped");
  failures++;
}
for (const file of ["server/services/sdr/ghl-sync-rules.ts", "server/services/sdr/voice-orchestrator.ts"]) {
  const source = fs.readFileSync(file, "utf8");
  if (!source.includes("applyConsentCommand")) {
    console.error(`FAIL ${file}: SDR opt-out/DNC path must create a canonical consent command`);
    failures++;
  }
}

if (failures) process.exit(1);
console.log("PASS consent semantic-writer dominance checks");