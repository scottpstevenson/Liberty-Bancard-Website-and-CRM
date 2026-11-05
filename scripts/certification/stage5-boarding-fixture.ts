/**
 * Shared Stage 5 certification fixture helpers (disposable database only).
 * The boarding policy matrix is an OWNER decision that is unrecorded in production; certifications record a
 * clearly synthetic one so the readiness evaluator can resolve its gates, and negative controls remove it.
 */
export const CERT_PROGRAM = "Cert Program";
export const CERT_POLICY_VERSION = "cert-policy-v1";

export async function recordCertPolicy(
  db: any, sql: any,
  programs: Record<string, { requiredDocuments: string[]; esignRequired: boolean }> = { [CERT_PROGRAM]: { requiredDocuments: [], esignRequired: false } },
  version = CERT_POLICY_VERSION,
): Promise<void> {
  const value = { version, recordedBy: "cert-fixture", recordedAt: new Date(Date.now() - 60_000).toISOString(), programs };
  await db.execute(sql`
    INSERT INTO system_settings (key, value) VALUES ('boarding.policy.matrix.v1', ${JSON.stringify(value)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
}

export async function removeCertPolicy(db: any, sql: any): Promise<void> {
  await db.execute(sql`DELETE FROM system_settings WHERE key = 'boarding.policy.matrix.v1'`);
}
