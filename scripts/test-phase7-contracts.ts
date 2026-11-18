/** Pure behavior tests. No server, database, environment credentials or provider. */
import { generateKeyPairSync, sign } from "node:crypto";
import {
  verifySendGridSignature,
  sendGridKind,
  continuousFeedbackCoverage,
  verifiesSendGridSmtpKey,
} from "../server/services/phase7-sendgrid-contract";
import assert from "node:assert/strict";
import { z } from "zod";
import { editableSequenceStepSchema } from "../shared/schema";
import {
  canonicalJson,
  phase7DesignSchema,
  fisherExactTwoSided,
  analyzePhase7,
  wilsonInterval,
} from "../shared/phase7-experiment";
import { interpolateSequenceText } from "../server/services/sequence-step-interpolation";
let checks = 0;
const check = (x: unknown) => {
  assert.ok(x);
  checks++;
};
const smtpMetadata = { api_key_id: "fixture-key", scopes: ["mail.send"] };
check(verifiesSendGridSmtpKey(smtpMetadata, "fixture-key"));
check(verifiesSendGridSmtpKey({ result: [smtpMetadata] }, "fixture-key"));
for (const invalid of [null, [], {}, { result: [] }, { result: [smtpMetadata, smtpMetadata] },
  { result: [smtpMetadata], ...smtpMetadata }, { result: [null] },
  { ...smtpMetadata, api_key_id: "another-key" }, { ...smtpMetadata, scopes: [] },
  { ...smtpMetadata, scopes: ["mail.send", 7] }]) {
  check(!verifiesSendGridSmtpKey(invalid, "fixture-key"));
}
for (const path of [
  editableSequenceStepSchema,
  editableSequenceStepSchema.partial(),
  editableSequenceStepSchema.extend({ id: z.number().optional() }).strict(),
]) {
  for (const field of [
    "abTestResults",
    "variantASent",
    "winnerSelected",
    "approvedBy",
    "createdBy",
    "abTestConfig",
    "variantBSubject",
    "actorId",
  ]) {
    check(
      !path.safeParse({
        stepOrder: 1,
        actionType: "email",
        [field]: field === "abTestResults" ? { winnerSelected: "B" } : "forged",
      }).success,
    );
  }
  check(
    path.safeParse({
      stepOrder: 1,
      actionType: "email",
      subject: "Subject",
      body: "Body",
    }).success,
  );
}
assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
checks++;
assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
checks++;
assert.throws(() => canonicalJson({ n: Infinity }));
checks++;
// Independently published Fisher exact 2x2 table [[1,9],[11,3]]. scipy.stats.fisher_exact agrees.
check(
  Math.abs(fisherExactTwoSided(1, 10, 11, 14) - 0.0027594561852200836) < 1e-10,
);
check(
  Math.abs(fisherExactTwoSided(11, 14, 1, 10) - 0.0027594561852200836) < 1e-10,
);
check(Math.abs(fisherExactTwoSided(0, 10, 0, 10) - 1) < 1e-10);
check(Math.abs(fisherExactTwoSided(10, 10, 10, 10) - 1) < 1e-10);
assert.throws(() => fisherExactTwoSided(11, 10, 0, 10));
checks++;
const result = analyzePhase7(20, 1000, 60, 1000, 0.05, 3);
check(result.recommendation === "winner_b");
check(result.adjustedAlpha === 0.05 / 3);
check(analyzePhase7(1, 5, 90, 1000, 0.05, 1).recommendation === "inconclusive");
const ci = wilsonInterval(5, 10);
check(Math.abs(ci[0] - 0.2365930905) < 0.00001);
check(Math.abs(ci[1] - 0.7634069095) < 0.00001);
const h = "a".repeat(64),
  arm = {
    artifactId: "00000000-0000-4000-8000-000000000001",
    contentHash: h,
    subject: "Control",
    bodyHash: h,
    senderPolicy: "cold_outreach",
    cadenceHash: h,
  };
const design = {
  contractVersion: 1,
  sequenceId: 1,
  stepId: 1,
  sequenceVersion: 1,
  vertical: "Healthcare",
  allocationUnit: "canonical_business",
  overlapPolicy: "one_collecting_experiment_per_business",
  outcomeMaturityDays: 7,
  collectionDays: 14,
  metric: "verified_qualified_reply_rate",
  denominator: "distinct_exposed_businesses",
  method: "fisher_exact_two_sided_v1",
  alpha: 0.05,
  comparisonFamilySize: 3,
  minPerArm: 1000,
  planning: {
    baselineRate: 0.02,
    minimumDetectableEffect: 0.02,
    power: 0.8,
    rationale: "Pre-registered planning scenario; real baseline unknown.",
  },
  arms: { A: arm, B: { ...arm, subject: "Challenger" } },
  guardrails: [
    {
      metric: "complaint",
      denominator: "distinct_attempted_businesses",
      minimumEvidence: 20,
      maxRate: 0.01,
    },
  ],
};
check(phase7DesignSchema.safeParse(design).success);
for (const invalid of [
  { ...design, collectionDays: 1 },
  { ...design, arms: { A: arm, B: arm } },
  {
    ...design,
    arms: { A: arm, B: { ...arm, subject: "B", bodyHash: "b".repeat(64) } },
  },
  { ...design, method: "unsupported" },
])
  check(!phase7DesignSchema.safeParse(invalid).success);
check(
  !phase7DesignSchema.safeParse({
    ...design,
    arms: { A: arm, B: { ...arm, subject: "   " } },
  }).success,
);
check(
  !phase7DesignSchema.safeParse({
    ...design,
    arms: {
      A: { ...arm, subject: "Subject  line" },
      B: { ...arm, subject: "Subject line" },
    },
  }).success,
);
// Real send-path interpolator, including the prior stale-source assertion's negative control.
const values = {
  firstName: "Alex",
  lastName: "Smith",
  companyName: "Example",
  email: "x@example.test",
  industry: "Retail",
  monthlyVolume: "",
  currentProcessor: "",
  recommendedProgram: "",
  recommendedTerminal: "",
  serviceType: "",
  estimatedVolume: "",
  agentName: "Liberty",
  agentEmail: "help@libertybancard.com",
  agentPhone: "954-266-8214",
  businessName: "Example",
  calendarLink: null,
};
assert.throws(
  () =>
    interpolateSequenceText("Unresolved {{unknown}}", values, "phase7 fixture"),
  /unresolved template placeholder/,
);
checks++;
assert.equal(
  interpolateSequenceText("Hello {{firstName}}", values, "fixture"),
  "Hello Alex",
);
checks++;

const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" }),
  stamp = String(Math.floor(Date.now() / 1000)),
  raw = Buffer.from('[{"event":"delivered"}]');
const publicKey = keys.publicKey
  .export({ format: "der", type: "spki" })
  .toString("base64");
const signature = sign(
  "sha256",
  Buffer.concat([Buffer.from(stamp), raw]),
  keys.privateKey,
).toString("base64");
check(verifySendGridSignature(raw, signature, stamp, publicKey));
check(
  !verifySendGridSignature(
    Buffer.from('[{"event":"bounce"}]'),
    signature,
    stamp,
    publicKey,
  ),
);
check(
  !verifySendGridSignature(
    raw,
    signature,
    String(Number(stamp) - 26 * 3600),
    publicKey,
  ),
);
check(!verifySendGridSignature(raw, signature, stamp, "invalid"));
check(
  sendGridKind({ event: "bounce", type: "bounce", status: "5.1.1" }) ===
    "hard_bounce",
);
check(
  sendGridKind({ event: "bounce", type: "blocked", status: "5.7.1" }) === null,
);
check(
  sendGridKind({ event: "bounce", type: "bounce", status: "4.1.1" }) === null,
);
check(sendGridKind({ event: "spamreport" }) === "complaint");
check(sendGridKind({ event: "processed" }) === null);
const epoch = new Date("2026-10-01T00:00:00Z"),
  at = (m: number) => new Date(+epoch + m * 60000),
  observations = [0, 5, 10, 15, 20].map((m) => ({
    healthy: true,
    observed_at: at(m),
    identity_hash: "identity",
  }));
check(
  continuousFeedbackCoverage(observations, at(1), at(19), "identity", at(25)),
);
check(
  !continuousFeedbackCoverage(
    observations.filter((_, i) => i !== 1 && i !== 2),
    at(1),
    at(19),
    "identity",
    at(25),
  ),
);
check(
  !continuousFeedbackCoverage(
    observations.map((r, i) => ({ ...r, healthy: i !== 2 })),
    at(1),
    at(19),
    "identity",
    at(25),
  ),
);
check(
  !continuousFeedbackCoverage(
    observations.map((r, i) => ({
      ...r,
      identity_hash: i < 2 ? "identity" : "rotated",
    })),
    at(1),
    at(19),
    "identity",
    at(25),
  ),
);
check(
  !continuousFeedbackCoverage(observations, at(-1), at(19), "identity", at(25)),
);
check(
  !continuousFeedbackCoverage(observations, at(1), at(19), "identity", at(18)),
);
console.log(
  `Phase 7 contracts: ${checks} behavior checks passed; zero external effects.`,
);
