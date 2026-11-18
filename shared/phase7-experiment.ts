import { z } from "zod";

/** Versioned design contract. Audit actor is deliberately outside semantic design. */
export const phase7ArmSchema = z
  .object({
    artifactId: z.string().uuid(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    subject: z.string().trim().min(1).max(500),
    bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    senderPolicy: z.literal("cold_outreach"),
    cadenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const phase7DesignSchema = z
  .object({
    contractVersion: z.literal(1),
    sequenceId: z.number().int().positive(),
    stepId: z.number().int().positive(),
    sequenceVersion: z.number().int().positive(),
    vertical: z.string().min(1).max(120),
    allocationUnit: z.literal("canonical_business"),
    overlapPolicy: z.literal("one_collecting_experiment_per_business"),
    outcomeMaturityDays: z.number().int().min(1).max(90),
    collectionDays: z.number().int().min(14).max(90),
    metric: z.literal("verified_qualified_reply_rate"),
    denominator: z.literal("distinct_exposed_businesses"),
    method: z.literal("fisher_exact_two_sided_v1"),
    alpha: z.number().min(0.001).max(0.05),
    comparisonFamilySize: z.number().int().min(1).max(100),
    minPerArm: z.number().int().min(1).max(1000000),
    planning: z
      .object({
        baselineRate: z.number().positive().lt(1),
        minimumDetectableEffect: z.number().positive().lt(1),
        power: z.number().min(0.8).max(0.99),
        rationale: z.string().min(20).max(2000),
      })
      .strict(),
    arms: z.object({ A: phase7ArmSchema, B: phase7ArmSchema }).strict(),
    guardrails: z
      .array(
        z
          .object({
            metric: z.enum(["hard_bounce", "complaint", "opt_out"]),
            denominator: z.literal("distinct_attempted_businesses"),
            minimumEvidence: z.number().int().positive(),
            maxRate: z.number().min(0).max(1),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.arms.A.subject.replace(/\s+/g, " ") ===
      v.arms.B.subject.replace(/\s+/g, " ")
    )
      ctx.addIssue({ code: "custom", message: "Subjects must differ" });
    if (
      v.arms.A.bodyHash !== v.arms.B.bodyHash ||
      v.arms.A.cadenceHash !== v.arms.B.cadenceHash
    )
      ctx.addIssue({
        code: "custom",
        message: "Only the subject may differ between initial arms",
      });
    if (v.planning.baselineRate + v.planning.minimumDetectableEffect >= 1)
      ctx.addIssue({
        code: "custom",
        message: "Planned effect must fit the baseline",
      });
  });
export type Phase7Design = z.infer<typeof phase7DesignSchema>;

/** Canonical JSON compatible with JSON semantics: sorted object keys, ordered arrays, finite numbers only. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value))
    return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  if (typeof value === "object")
    return `{${Object.keys(value as object)
      .filter((k) => (value as any)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as any)[k])}`)
      .join(",")}}`;
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("NON_FINITE_DESIGN_NUMBER");
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("INVALID_DESIGN_VALUE");
  return serialized;
}

function logGamma(z: number): number {
  const p = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012,
    9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5)
    return (
      Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z)
    );
  z -= 1;
  let x = 0.9999999999998099;
  for (let i = 0; i < p.length; i++) x += p[i] / (z + i + 1);
  const t = z + p.length - 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
  );
}
const choose = (n: number, k: number) =>
  logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
export function fisherExactTwoSided(
  a: number,
  nA: number,
  b: number,
  nB: number,
): number {
  if (
    ![a, nA, b, nB].every(Number.isSafeInteger) ||
    a < 0 ||
    b < 0 ||
    nA <= 0 ||
    nB <= 0 ||
    a > nA ||
    b > nB ||
    nA + nB > 2000000
  )
    throw new Error("INVALID_ANALYSIS_COUNTS");
  const k = a + b,
    n = nA + nB,
    low = Math.max(0, k - nB),
    high = Math.min(k, nA);
  const lp = (x: number) => choose(nA, x) + choose(nB, k - x) - choose(n, k);
  const observed = lp(a);
  let sum = 0;
  for (let x = low; x <= high; x++) {
    const q = lp(x);
    if (q <= observed + 1e-9) sum += Math.exp(q);
  }
  return Math.min(1, sum);
}
function normalCdf(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    1 -
    d *
      t *
      (0.31938153 +
        t *
          (-0.356563782 +
            t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? p : 1 - p;
}
function critical(alpha: number) {
  let lo = 0,
    hi = 9;
  for (let i = 0; i < 70; i++) {
    const m = (lo + hi) / 2;
    if (normalCdf(m) < 1 - alpha / 2) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
export function wilsonInterval(
  success: number,
  total: number,
  alpha = 0.05,
): [number, number] {
  if (total <= 0 || success < 0 || success > total)
    throw new Error("INVALID_ANALYSIS_COUNTS");
  const z = critical(alpha),
    p = success / total,
    d = 1 + (z * z) / total,
    c = (p + (z * z) / (2 * total)) / d;
  const h =
    (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
export function analyzePhase7(
  a: number,
  nA: number,
  b: number,
  nB: number,
  alpha: number,
  familySize: number,
) {
  const adjustedAlpha = alpha / familySize,
    pValue = fisherExactTwoSided(a, nA, b, nB);
  const rateA = a / nA,
    rateB = b / nB,
    ciA = wilsonInterval(a, nA, adjustedAlpha),
    ciB = wilsonInterval(b, nB, adjustedAlpha);
  const difference = rateB - rateA;
  const effectInterval = [
    difference - Math.sqrt((rateB - ciB[0]) ** 2 + (ciA[1] - rateA) ** 2),
    difference + Math.sqrt((ciB[1] - rateB) ** 2 + (rateA - ciA[0]) ** 2),
  ];
  // Frozen 50/50 allocation: SRM is a diagnostic hold, never a reason to reassign.
  const imbalance = Math.abs(nA - nB) / Math.sqrt(nA + nB) > 3.290526731;
  return {
    method: "fisher_exact_two_sided_v1",
    pValue,
    adjustedAlpha,
    rateA,
    rateB,
    ciA,
    ciB,
    difference,
    effectInterval,
    imbalance,
    recommendation: imbalance
      ? "inconclusive"
      : pValue <= adjustedAlpha
        ? rateB > rateA
          ? "winner_b"
          : "winner_a"
        : "inconclusive",
  };
}

/** Conservative normal-approximation planning floor, frozen before collection; analysis still uses Fisher exact. */
export function plannedMinimumPerArm(d: Phase7Design) {
  const p0 = d.planning.baselineRate,
    p1 = p0 + d.planning.minimumDetectableEffect,
    p = (p0 + p1) / 2;
  const zAlpha = critical(d.alpha / d.comparisonFamilySize),
    zPower = critical(2 * (1 - d.planning.power));
  return Math.ceil(
    (zAlpha * Math.sqrt(2 * p * (1 - p)) +
      zPower * Math.sqrt(p0 * (1 - p0) + p1 * (1 - p1))) **
      2 /
      (p1 - p0) ** 2,
  );
}
