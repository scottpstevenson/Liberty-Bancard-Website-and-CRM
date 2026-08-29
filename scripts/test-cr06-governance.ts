#!/usr/bin/env npx tsx
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CR06_DISPATCH_AVAILABLE,
  CR06_MAX_PREPARED_MEMBERS,
  getCr06RolloutManifest,
} from "../server/services/cr06-premium-campaigns";
import { renderCr06Recipient } from "../server/services/cr06-renderer";

const manifest = getCr06RolloutManifest();
assert.deepEqual(manifest.counts, { programs: 3, sequences: 3, contents: 12, manualTasks: 3 });
assert.equal(manifest.artifacts.filter((a) => a.kind === "program").length, 3);
assert.equal(manifest.artifacts.filter((a) => a.kind === "sequence_version").length, 3);
assert.equal(manifest.artifacts.filter((a) => a.kind === "content_version").length, 12);
assert.equal(manifest.artifacts.filter((a) => a.kind === "manual_task_definition").length, 3);
assert.deepEqual(manifest.cadenceDays, [1, 4, 8, 14]);
assert.deepEqual(manifest.channels, ["email"]);
assert.equal(manifest.cap, 250);
assert.equal(CR06_MAX_PREPARED_MEMBERS, 250);
assert.equal(CR06_DISPATCH_AVAILABLE, false);
assert.equal(manifest.dispatchAvailable, false);
assert.match(manifest.manifestHash, /^[0-9a-f]{64}$/);
assert.equal(new Set(manifest.artifacts.map((a) => a.identityKey)).size, 21);
assert.ok(manifest.programs.every((p) => p.contentKeys.length === 4));
assert.equal(manifest.artifacts.length, 21, "the immutable package is exactly 3 + 3 + 12 + 3 artifacts");

const sequenceArtifacts = manifest.artifacts.filter((artifact) => artifact.kind === "sequence_version");
const contentArtifacts = manifest.artifacts.filter((artifact) => artifact.kind === "content_version");
const taskArtifacts = manifest.artifacts.filter((artifact) => artifact.kind === "manual_task_definition");
assert.equal(sequenceArtifacts.length, 3, "exactly three four-email sequences are permitted");
assert.equal(contentArtifacts.length, 12, "do not add a fifth email or a thirteenth content version");
assert.equal(manifest.manifestVersion, "liberty-premium-pilots-v2");
assert.ok(manifest.artifacts.every((artifact) => artifact.version === 2), "current certified artifacts are immutable version 2 records");
assert.ok(manifest.artifacts.every((artifact) => artifact.identityKey.endsWith("-v2")),
  "v2 uses explicit identities and never aliases stored v1 artifacts");

const countWords = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
for (const program of manifest.programs) {
  const sequence = sequenceArtifacts.find((artifact) => artifact.identityKey === program.sequenceKey);
  assert.ok(sequence, `sequence exists for ${program.key}`);
  const sequenceDocument = sequence.document as {
    cadenceDays: number[];
    channels: string[];
    manualTaskAfterTouch: number;
    contentIdentityKeys: string[];
  };
  assert.deepEqual(sequenceDocument.cadenceDays, [1, 4, 8, 14], `${program.key} cadence is exact`);
  assert.deepEqual(sequenceDocument.channels, ["email"], `${program.key} is email-only`);
  assert.equal(sequenceDocument.manualTaskAfterTouch, 2, `${program.key} holds the task after Email 2`);
  assert.deepEqual(sequenceDocument.contentIdentityKeys, program.contentKeys, `${program.key} preserves content order`);

  const contents = contentArtifacts
    .filter((artifact) => artifact.parentKey === program.sequenceKey)
    .map((artifact) => artifact.document as {
      key: string; touch: number; day: number; subject: string; paragraphs: string[];
      callToAction: { label: string; url: string }; model: null; promptVersion: null; reviewedOnly: boolean;
    })
    .sort((left, right) => left.touch - right.touch);
  assert.equal(contents.length, 4, `${program.key} has exactly four emails`);
  assert.deepEqual(contents.map((content) => content.touch), [1, 2, 3, 4], `${program.key} touch ordering is exact`);
  assert.deepEqual(contents.map((content) => content.day), [1, 4, 8, 14], `${program.key} day ordering is exact`);
  for (const content of contents) {
    const body = content.paragraphs.join(" ");
    assert.ok(countWords(body) >= 60 && countWords(body) <= 120, `${content.key} body must be 60–120 words`);
    assert.equal(content.model, null, `${content.key} has no runtime AI model`);
    assert.equal(content.promptVersion, null, `${content.key} has no AI prompt`);
    assert.equal(content.reviewedOnly, true, `${content.key} is reviewed immutable copy`);
  }
  const closing = contents[3];
  assert.match(`${closing.subject} ${closing.paragraphs.join(" ")}`, /close the loop/i, `${program.key} Email 4 is a respectful closing touch`);
  assert.match(closing.paragraphs.join(" "), /no action is needed|not (?:a )?good time/i, `${program.key} Email 4 respects a decline`);

  const task = taskArtifacts.find((artifact) => artifact.identityKey === program.manualTaskKey);
  assert.ok(task, `manual task exists for ${program.key}`);
  const taskDocument = task.document as { trigger: { afterEmailTouch: number }; action: string };
  assert.equal(taskDocument.trigger.afterEmailTouch, 2, `${program.key} manual task triggers after Email 2`);
  assert.equal(taskDocument.action, "manual_research_call", `${program.key} task remains manual`);
}

const renderInput = {
  rendererVersion: "cr06-renderer-v1",
  purpose: "commercial_outreach" as const,
  content: {
    subject: "A <focused> review",
    greeting: "Hi Pat <Owner>,",
    paragraphs: ["Current retained evidence supports a payment-flow review."],
    callToAction: { label: "Review one statement", url: "https://libertybancard.com/free-analysis" },
  },
  sender: {
    displayName: "Scott Stevenson",
    email: "Scott@mail.libertybancard.com",
    signature: "Business Development\n954-266-8214",
  },
  compliance: {
    mailingAddress: "123 Main Street, Fort Lauderdale, FL 33301",
    unsubscribe: { instruction: "Reply unsubscribe and we will stop future emails." },
  },
};
const first = renderCr06Recipient(renderInput);
const second = renderCr06Recipient(renderInput);
assert.deepEqual(first, second);
assert.ok(first.html.includes("&lt;Owner&gt;"));
assert.equal((first.html.match(/data-cr06-signature=/g) ?? []).length, 1);
assert.equal((first.html.match(/data-cr06-compliance=/g) ?? []).length, 1);
assert.equal((first.text.match(/\[CR-06-SIGNATURE\]/g) ?? []).length, 1);
assert.equal((first.text.match(/\[CR-06-COMPLIANCE\]/g) ?? []).length, 1);
assert.match(first.mimeSha256, /^[0-9a-f]{64}$/);
assert.match(first.renderSha256, /^[0-9a-f]{64}$/);
assert.equal(first.mimeSha256, second.mimeSha256, "MIME-equivalent parts hash deterministically");
assert.equal(first.renderSha256, second.renderSha256, "complete render hash deterministically");

for (const artifact of contentArtifacts) {
  const content = artifact.document as { subject: string; paragraphs: string[]; callToAction: { label: string; url: string } };
  const rendered = renderCr06Recipient({
    ...renderInput,
    content: {
      subject: content.subject,
      greeting: "Hi Pat,",
      paragraphs: content.paragraphs,
      callToAction: content.callToAction,
    },
  });
  assert.equal((rendered.text.match(new RegExp(`^${content.callToAction.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: https:`, "gm")) ?? []).length, 1, `${artifact.identityKey} has one text CTA`);
  assert.equal((rendered.html.match(/<a href=/g) ?? []).length, 1, `${artifact.identityKey} has one HTML CTA`);
  assert.equal((rendered.text.match(/\[CR-06-SIGNATURE\]/g) ?? []).length, 1, `${artifact.identityKey} has one signature`);
  assert.equal((rendered.text.match(/\[CR-06-COMPLIANCE\]/g) ?? []).length, 1, `${artifact.identityKey} has one footer`);
  assert.equal((rendered.text.match(/^Unsubscribe:/gm) ?? []).length, 1, `${artifact.identityKey} has one unsubscribe treatment`);
}

assert.throws(() => renderCr06Recipient({
  ...renderInput,
  content: { ...renderInput.content, callToAction: { label: "Unsafe", url: "javascript:alert(1)" } },
}), /CR06_INVALID_URL/);
assert.throws(() => renderCr06Recipient({
  ...renderInput,
  content: { ...renderInput.content, callToAction: { label: "Unsafe", url: "https://user:password@example.com" } },
}), /CR06_INVALID_URL/);
assert.throws(() => renderCr06Recipient({
  ...renderInput,
  content: { ...renderInput.content, subject: "" },
}), /CR06_REQUIRED_FIELD_UNRESOLVED/);
assert.throws(() => renderCr06Recipient({
  ...renderInput,
  content: { ...renderInput.content, paragraphs: ["Guaranteed 30% savings on every payment."] },
}), /CR06_PROHIBITED_CLAIM/);
assert.throws(() => renderCr06Recipient({
  ...renderInput,
  content: { ...renderInput.content, greeting: "Hi {{first_name}}," },
}), /CR06_UNRESOLVED_TOKEN/);

const rendererSource = fs.readFileSync("server/services/cr06-renderer.ts", "utf8");
for (const prohibited of ["../db", "../storage", "fetch(", "axios", "openai", "generateText", "sendSmtpEmail"]) {
  assert.ok(!rendererSource.toLowerCase().includes(prohibited.toLowerCase()), `renderer contains prohibited dependency: ${prohibited}`);
}
const serviceSource = fs.readFileSync("server/services/cr06-premium-campaigns.ts", "utf8");
assert.ok(!serviceSource.includes("sendSmtpEmail"));
assert.ok(!serviceSource.includes("sendGmail"));
assert.ok(!serviceSource.includes("enrollContactInSequence"));
assert.ok(serviceSource.includes("providerAttemptCount: 0"));
assert.ok(serviceSource.includes("dispatchAvailable: false"));
for (const prohibited of ["openai", "generateText", "generateObject", "chat.completions", "fetch("]) {
  assert.ok(!serviceSource.toLowerCase().includes(prohibited.toLowerCase()), `CR-06 content path contains runtime AI/network token: ${prohibited}`);
}
const adminSource = fs.readFileSync("server/routes/admin.ts", "utf8");
const legacyRoute = adminSource.slice(adminSource.indexOf('app.post("/api/admin/outbound/cohort-launch"'), adminSource.indexOf("// ── Cohort Send Metrics"));
assert.ok(legacyRoute.includes("globalPauseChanged: false"));
assert.ok(!legacyRoute.includes("applyPauseMutation"));

const migration = fs.readFileSync("migrations/0182_cr06_premium_campaign_governance.sql", "utf8");
assert.ok(migration.includes("provider_attempt_count INTEGER NOT NULL DEFAULT 0"));
assert.ok(migration.includes("ON DELETE RESTRICT"));
assert.ok(migration.includes("CR06_APPROVED_ARTIFACT_IMMUTABLE"));
assert.ok(migration.includes("CR06_HISTORY_DELETE_FORBIDDEN"));

console.log(JSON.stringify({
  suite: "cr06-governance",
  status: "passed",
  manifestVersion: manifest.manifestVersion,
  manifestHash: manifest.manifestHash,
  counts: manifest.counts,
  rendererHash: first.htmlSha256,
  providerAttempts: 0,
  dispatchAvailable: false,
}, null, 2));