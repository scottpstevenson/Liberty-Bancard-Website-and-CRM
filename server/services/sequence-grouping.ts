// Classifies the ~94 follow-up sequences into filter/group buckets for the
// Sequences dashboard page, and resolves each sequence's GHL workflow wiring
// status. This is READ-ONLY: it never creates, edits, or triggers GHL
// workflows, and never touches contactability/opt-out/pause state.
import { storage } from "../storage";
import { RAW_SEQUENCES } from "./sequence-blueprints";
import { getWorkflowMappings } from "./ghl-workflow-enrollment";
import { GHL_WORKFLOW_REGISTRY, getWorkflowEnvValue, getSdrWorkflowForVertical } from "./ghl-workflows";
import type { FollowUpSequence } from "@shared/schema";

export type SequenceBucket =
  | "cold_outreach"
  | "onboarding"
  | "nurture_followup"
  | "vertical_specific"
  | "transactional_operational"
  | "uncategorized";

export const BUCKET_LABELS: Record<SequenceBucket, string> = {
  cold_outreach: "Cold Outreach",
  onboarding: "Onboarding",
  nurture_followup: "Nurture / Follow-Up",
  vertical_specific: "Vertical-Specific",
  transactional_operational: "Transactional / Operational",
  uncategorized: "Uncategorized",
};

// Name -> category lookup, sourced from the RAW_SEQUENCES blueprint list
// (server/services/sequence-blueprints.ts), which already has a hand-curated
// category per sequence name for ~2/3 of all sequences.
const CATEGORY_BY_NAME: Record<string, string> = {};
for (const s of RAW_SEQUENCES) {
  CATEGORY_BY_NAME[s.name] = s.category;
}

// Maps the fine-grained blueprint/SEQUENCE_WORKFLOW_MAP categories into the
// coarse buckets requested for the Sequences page filter/group controls.
function bucketFromCategory(category: string | undefined, vertical?: string): SequenceBucket | null {
  if (!category) return null;
  if (vertical && vertical !== "all") return "vertical_specific";
  switch (category) {
    case "onboarding":
      return "onboarding";
    case "inbound":
    case "operations":
      return "transactional_operational";
    case "sdr_reply_engaged":
    case "sdr_statement_chase":
    case "sdr_proposal_followup":
    case "sdr_noshow_recovery":
    case "nurture":
    case "reactivation":
      return "nurture_followup";
    case "sdr":
    case "sdr_cold_outbound":
      // Vertical-tagged SDR sequences whose vertical wasn't resolved above
      // (name-only classification) are still vertical-specific in practice —
      // every "sdr"/"sdr_cold_outbound" entry in the blueprint targets one
      // named vertical (e.g. Retail, Auto, Med Spa, Dental, Construction).
      return "vertical_specific";
    case "sales":
    case "education":
    default:
      return "cold_outreach";
  }
}

// Fallback classification for the ~32 sequences that have no entry in the
// RAW_SEQUENCES blueprint list (mostly the "W6 —" family rows, whose
// sequenceFamily column already encodes their purpose, plus a handful of
// legacy/duplicate named sequences). Keyed by exact sequence name.
const FALLBACK_BUCKET_BY_NAME: Record<string, SequenceBucket> = {
  "New Lead Drip Campaign": "transactional_operational",
  "Statement Review Follow-up": "transactional_operational",
  "5. Chargeback Defense": "cold_outreach",
  "7. POS vs Terminal — Decision Guide": "cold_outreach",
  "8. Liberty Smart Terminal — Product Showcase": "cold_outreach",
  "10. Retail Merchants — SDR Outbound + Drip": "vertical_specific",
  "11. Auto Merchants — SDR Outbound + Drip": "vertical_specific",
  "12. Medical & Med Spa — SDR Outbound + Drip": "vertical_specific",
  "14. Text-to-Pay & Payment Links": "cold_outreach",
  "20. Referral Flywheel — Merchant to Merchant": "nurture_followup",
  "21. Referral Flywheel — Merchant to Merchant": "nurture_followup",
  "V-Restaurant: SDR Outbound Prospecting": "vertical_specific",
  "V-Restaurant: Inbound Lead Nurture": "vertical_specific",
  "V-Restaurant: Account Management Ops": "vertical_specific",
  "22. FL Auto Repair — Vertical Playbook": "vertical_specific",
  "23. FL Med Spa — Vertical Playbook": "vertical_specific",
  "24. FL Medical/Dental — Vertical Playbook": "vertical_specific",
  "Voicemail Follow-Up SMS": "nurture_followup",
  "25. FL Construction — Vertical Playbook": "vertical_specific",
  "SDR: Cold Outbound — Construction": "vertical_specific",
  "Objection Crusher": "nurture_followup",
  "W6 — Cold Outreach: Email + Manual Call": "cold_outreach",
  "W6 — Inbound Lead: No PEWC": "transactional_operational",
  "W6 — Statement Uploaded": "transactional_operational",
  "W6 — Booked Appointment": "transactional_operational",
  "W6 — No-Show Recovery": "nurture_followup",
  "W6 — Proposal Sent": "nurture_followup",
  "W6 — Application Abandoned": "onboarding",
  "W6 — Closed Won: Onboarding": "onboarding",
  "W6 — Merchant Referral Program": "nurture_followup",
  "W6 — Partner Referral Sequence": "nurture_followup",
};

// Family-based fallback for sequences that share a sequenceFamily value but
// might not be an exact name match (defensive; also used as a second-chance
// heuristic ahead of the trigger-type based catch-all).
const FALLBACK_BUCKET_BY_FAMILY: Record<string, SequenceBucket> = {
  "cold-email-manual-call": "cold_outreach",
  "inbound-no-pewc": "transactional_operational",
  "statement-uploaded": "transactional_operational",
  "booked-appointment": "transactional_operational",
  "no-show-recovery": "nurture_followup",
  "proposal-sent": "nurture_followup",
  "application-abandoned": "onboarding",
  "closed-won-onboarding": "onboarding",
  "merchant-referral": "nurture_followup",
  "partner-referral": "nurture_followup",
};

export function classifySequenceBucket(seq: Pick<FollowUpSequence, "name" | "sequenceFamily" | "triggerType">): SequenceBucket {
  // 1) Vertical prefix in the name is the strongest, most unambiguous signal.
  if (/^V-[A-Za-z]/.test(seq.name) || /vertical playbook/i.test(seq.name)) {
    return "vertical_specific";
  }

  // 2) Hand-curated blueprint category (covers ~2/3 of all sequences).
  const category = CATEGORY_BY_NAME[seq.name];
  const fromCategory = bucketFromCategory(category);
  if (fromCategory) return fromCategory;

  // 3) Exact-name fallback map for sequences missing from the blueprint.
  if (FALLBACK_BUCKET_BY_NAME[seq.name]) return FALLBACK_BUCKET_BY_NAME[seq.name];

  // 4) sequenceFamily-based fallback (covers the "W6 —" family sequences).
  if (seq.sequenceFamily && FALLBACK_BUCKET_BY_FAMILY[seq.sequenceFamily]) {
    return FALLBACK_BUCKET_BY_FAMILY[seq.sequenceFamily];
  }

  // 5) Trigger-type heuristic as a last resort.
  if (seq.triggerType === "contact_created" || seq.triggerType === "deal_stage_changed") {
    return "transactional_operational";
  }
  if (seq.triggerType === "call_outcome" || seq.triggerType === "inbound_classification") {
    return "nurture_followup";
  }

  return "uncategorized";
}

export type GhlWiringStatus = "connected" | "missing" | "invalid_stale" | "not_applicable";

const PLACEHOLDER_ID_PATTERN = /^(tbd|todo|placeholder|xxx+|n\/a|test|pending|unset)$/i;

function envKeyForSequence(name: string): string {
  return `GHL_WORKFLOW_${name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase()}`;
}

export interface SequenceWiringInfo {
  status: GhlWiringStatus;
  workflowId: string | null;
  source: "registry" | "env" | "database" | "hardcoded" | "none";
}

// Registry entries keyed by triggerType, for the (small) set of trigger types
// that map 1:1 to a single GHL Workflow ID Manager registry entry. "sdr_outreach"
// is excluded here because it is shared by 8 vertical-specific registry rows and
// is disambiguated separately via getSdrWorkflowForVertical().
const REGISTRY_BY_TRIGGER_TYPE = new Map(
  GHL_WORKFLOW_REGISTRY.filter((w) => w.triggerType !== "sdr_outreach").map((w) => [w.triggerType, w])
);
const REGISTRY_BY_ID = new Map(GHL_WORKFLOW_REGISTRY.map((w) => [w.id, w]));

export async function getSequenceWiringMap(
  sequences: Pick<FollowUpSequence, "name" | "triggerType">[]
): Promise<Record<string, SequenceWiringInfo>> {
  const hardcodedMap = getWorkflowMappings();
  let dbMappings: Awaited<ReturnType<typeof storage.getGhlWorkflowMappings>> = [];
  try {
    dbMappings = await storage.getGhlWorkflowMappings();
  } catch (err) {
    console.warn("[sequence-grouping] Failed to load GHL workflow mappings from DB:", err);
  }
  const dbByName = new Map(dbMappings.map((m) => [m.sequenceName, m]));

  const result: Record<string, SequenceWiringInfo> = {};
  for (const seq of sequences) {
    const name = seq.name;
    const hardcodedEntry = hardcodedMap[name];

    // 1) Primary source of truth: the GHL Workflow ID Manager registry
    // (server/services/ghl-workflows.ts). Applies to sequences whose
    // triggerType maps directly to a registry business event, or whose
    // hardcoded category identifies it as an SDR cold-outbound cadence for
    // a specific vertical (registry rows sdr_cold_auto, sdr_cold_medspa, etc).
    let registryEntry = REGISTRY_BY_TRIGGER_TYPE.get(seq.triggerType);
    if (!registryEntry && hardcodedEntry) {
      const isSdrColdOutbound = hardcodedEntry.category === "sdr_outbound" || hardcodedEntry.category === "sdr_cold_outbound" || hardcodedEntry.category === "sdr";
      if (isSdrColdOutbound && hardcodedEntry.vertical && hardcodedEntry.vertical !== "all") {
        registryEntry = REGISTRY_BY_ID.get(getSdrWorkflowForVertical(hardcodedEntry.vertical));
      }
    }

    if (registryEntry) {
      const registryValue = await getWorkflowEnvValue(registryEntry.envKey);
      if (!registryValue) {
        result[name] = { status: "missing", workflowId: null, source: "none" };
      } else if (PLACEHOLDER_ID_PATTERN.test(registryValue.trim())) {
        result[name] = { status: "invalid_stale", workflowId: registryValue, source: "registry" };
      } else {
        result[name] = { status: "connected", workflowId: registryValue, source: "registry" };
      }
      continue;
    }

    // 2) Fallback for sequences with no registry counterpart: these are
    // app-native multi-step drip cadences run by the sequence engine itself
    // rather than a single GHL business-event workflow, so they resolve
    // wiring via their own per-sequence-name mapping (env override, admin-set
    // DB mapping, or the hardcoded SEQUENCE_WORKFLOW_MAP default).
    const envValue = process.env[envKeyForSequence(name)] || null;
    const dbValue = dbByName.get(name)?.ghlWorkflowId || null;
    const hardcodedValue = hardcodedEntry?.ghlWorkflowId || null;

    const resolved = envValue || dbValue || hardcodedValue;
    const source: SequenceWiringInfo["source"] = envValue ? "env" : dbValue ? "database" : hardcodedValue ? "hardcoded" : "none";

    // Purely internal, DB-driven welcome drips that fire on contact_created
    // before any GHL contact linkage is guaranteed to exist — these are not
    // routed through the GHL enrollment bridge in practice, so "no workflow
    // ID configured" is expected rather than a gap to flag.
    if (!resolved && seq.triggerType === "contact_created") {
      result[name] = { status: "not_applicable", workflowId: null, source: "none" };
      continue;
    }

    if (!resolved) {
      result[name] = { status: "missing", workflowId: null, source: "none" };
      continue;
    }
    if (PLACEHOLDER_ID_PATTERN.test(resolved.trim())) {
      result[name] = { status: "invalid_stale", workflowId: resolved, source };
      continue;
    }
    result[name] = { status: "connected", workflowId: resolved, source };
  }
  return result;
}
