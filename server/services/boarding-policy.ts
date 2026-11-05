/**
 * Boarding policy matrix (R03). Which documents / e-signature a program needs before processor
 * submission is a BUSINESS decision. Until the owner records it in system_settings
 * (`boarding.policy.matrix.v1`) every gate is `native_policy_required` and readiness fails closed.
 * Nothing here guesses a requirement.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";

export const BOARDING_POLICY_SETTING_KEY = "boarding.policy.matrix.v1";

export interface BoardingPolicyProgram { requiredDocuments: string[]; esignRequired: boolean }
export interface BoardingPolicyMatrix {
  version: string;
  recordedBy: string;
  recordedAt: string;
  programs: Record<string, BoardingPolicyProgram>;
}

/** Proposal handed to the owner for review (documentation only; never applied automatically). */
export const PROPOSED_POLICY_MATRIX_FOR_OWNER_REVIEW = {
  note: "Owner must record this per program. Values below are placeholders for review, not requirements.",
  programs: { "<program name>": { requiredDocuments: ["<condition_type>", "..."], esignRequired: "<true|false>" } },
};

export function validatePolicyMatrix(v: unknown): BoardingPolicyMatrix | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, any>;
  if (typeof m.version !== "string" || !m.version || typeof m.recordedBy !== "string" || !m.recordedBy) return null;
  if (typeof m.recordedAt !== "string" || Number.isNaN(Date.parse(m.recordedAt))) return null;
  if (!m.programs || typeof m.programs !== "object") return null;
  const programs: Record<string, BoardingPolicyProgram> = {};
  for (const [k, p] of Object.entries(m.programs as Record<string, any>)) {
    if (!p || !Array.isArray(p.requiredDocuments) || typeof p.esignRequired !== "boolean") return null;
    if (!p.requiredDocuments.every((d: unknown) => typeof d === "string" && d.trim())) return null;
    programs[k.trim().toLowerCase()] = { requiredDocuments: p.requiredDocuments.map((d: string) => d.trim()), esignRequired: p.esignRequired };
  }
  return { version: m.version, recordedBy: m.recordedBy, recordedAt: m.recordedAt, programs };
}

export async function readBoardingPolicyMatrix(): Promise<BoardingPolicyMatrix | null> {
  const r = await db.execute(sql`SELECT value FROM system_settings WHERE key = ${BOARDING_POLICY_SETTING_KEY} LIMIT 1`);
  const row = ((r as any).rows ?? r)[0] as { value?: unknown } | undefined;
  return row ? validatePolicyMatrix(row.value) : null;
}

export function policyForProgram(m: BoardingPolicyMatrix | null, program: string | null | undefined): BoardingPolicyProgram | null {
  if (!m || !program) return null;
  return m.programs[program.trim().toLowerCase()] ?? null;
}
