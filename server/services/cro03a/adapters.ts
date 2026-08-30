import type { Cro03CandidateField, Cro03SourceSubjectType } from "../cro03/contracts";

export const CRO03A_SOURCE_CENSUS = Object.freeze([
  "prospects",
  "sunbiz_entities",
  "provider_csv_rows",
  "sdr_merchants",
  "lead_discovery_results",
  "master_leads",
  "public_web",
] as const);

export type Cro03aSourceCensusName = typeof CRO03A_SOURCE_CENSUS[number];
export type Cro03aSourceDraft = {
  subjectType: Cro03SourceSubjectType;
  subjectKey: string;
  sourceSystem: string;
  sourceEventKey: string;
  sourceObservedAt?: string;
  timestampProvenance: string;
  payload: Record<string, unknown>;
  provenance: Record<string, unknown>;
  candidateValues: Partial<Record<Cro03CandidateField, string>>;
};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

function base(
  subjectType: Cro03SourceSubjectType,
  subjectKey: string,
  sourceSystem: string,
  sourceEventKey: string,
  payload: Record<string, unknown>,
  candidateValues: Partial<Record<Cro03CandidateField, string>>,
  provenance: Record<string, unknown> = {},
): Cro03aSourceDraft {
  const rawObservedAt = text(payload.updatedAt) ?? text(payload.createdAt) ?? text(payload.sourceModifiedDate);
  const parsedObservedAt = rawObservedAt && Number.isFinite(Date.parse(rawObservedAt))
    ? new Date(rawObservedAt).toISOString() : undefined;
  return {
    subjectType, subjectKey, sourceSystem, sourceEventKey,
    sourceObservedAt: parsedObservedAt,
    timestampProvenance: parsedObservedAt ? "source_record_timestamp" : "ingestion_attestation",
    payload, candidateValues,
    provenance: { sourceSystem, sourceEventKey, ...provenance },
  };
}

export function prospectSourceSubject(row: Record<string, unknown>): Cro03aSourceDraft {
  const id = String(row.id);
  const company = text(row.companyName);
  const email = text(row.email) ?? text(row.ownerEmail);
  const phone = text(row.phone) ?? text(row.ownerPhone);
  const website = text(row.website);
  const city = text(row.city);
  const state = text(row.state);
  return base("prospect", id, "prospects", `prospect:${id}:${text(row.updatedAt) ?? "snapshot"}`, row, {
    ...(company ? { business_name: company } : {}),
    ...(email ? { email } : {}), ...(phone ? { phone } : {}),
    ...(website ? { website } : {}), ...(city ? { city } : {}),
    ...(state ? { state } : {}),
  }, {
    prospectId: row.id, listId: row.listId ?? null,
    existingCustomerFlag: row.recordClass === "customer" || row.contactId != null || row.conversionContactId != null,
    doNotContactFlag: row.doNotContact === true,
    exactStrongIdentityMatches: row.contactId != null || row.conversionContactId != null ? ["canonical_contact_fk"] : [],
  });
}

/** Sunbiz fields intentionally use the schema's principal/entity names. */
export function sunbizSourceSubject(row: Record<string, unknown>): Cro03aSourceDraft {
  const id = String(row.id);
  const company = text(row.entityName);
  const filing = text(row.filingNumber);
  const city = text(row.principalCity);
  const state = text(row.principalState);
  const zip = text(row.principalZip);
  const address = text(row.principalAddress);
  const status = text(row.entityStatus);
  const email = text(row.email);
  const phone = text(row.phone);
  return base("sunbiz_entity", filing ? `filing:${filing}` : `row:${id}`, "sunbiz", `sunbiz:${id}:${text(row.updatedAt) ?? "snapshot"}`, row, {
    ...(company ? { business_name: company } : {}), ...(filing ? { registry_id: filing } : {}),
    ...(address ? { address } : {}), ...(city ? { city } : {}), ...(state ? { state } : {}),
    ...(zip ? { postal_code: zip } : {}), ...(status ? { entity_status: status } : {}),
    ...(email ? { email } : {}), ...(phone ? { phone } : {}),
  }, { sunbizEntityId: row.id, filingNumber: filing ?? null });
}

export function providerCsvSourceSubject(input: {
  importExecutionId: string;
  sourceRowNumber: number;
  sourceSystem: "apollo" | "outscraper";
  row: Record<string, unknown>;
  sourceObservedAt?: string;
}): Cro03aSourceDraft {
  const row = input.row;
  const company = text(row.companyName) ?? text(row.company) ?? text(row.businessName);
  const email = text(row.email);
  const phone = text(row.phone);
  const website = text(row.website) ?? text(row.domain);
  const city = text(row.city); const state = text(row.state); const zip = text(row.zip) ?? text(row.postalCode);
  return {
    ...base("provider_csv_row", `${input.importExecutionId}:${input.sourceRowNumber}`, input.sourceSystem,
      `${input.sourceSystem}:${input.importExecutionId}:${input.sourceRowNumber}`, row, {
        ...(company ? { business_name: company } : {}), ...(email ? { email } : {}),
        ...(phone ? { phone } : {}), ...(website ? { website } : {}),
        ...(city ? { city } : {}), ...(state ? { state } : {}),
        ...(zip ? { postal_code: zip } : {}),
      }, { importExecutionId: input.importExecutionId, sourceRowNumber: input.sourceRowNumber }),
    sourceObservedAt: input.sourceObservedAt,
    timestampProvenance: input.sourceObservedAt ? "import_source_timestamp" : "ingestion_time",
  };
}

export function sdrMerchantSourceSubject(row: Record<string, unknown>): Cro03aSourceDraft {
  const id = String(row.id);
  const source = text(row.source);
  const sourceRef = text(row.sourceRef);
  const company = text(row.businessName);
  const email = text(row.mainEmail); const phone = text(row.mainPhone);
  const website = text(row.website) ?? text(row.domain);
  const city = text(row.city); const state = text(row.state); const zip = text(row.zip);
  return base("sdr_merchant", sourceRef ? `${source ?? "sdr"}:${sourceRef}` : `row:${id}`,
    "sdr_merchants", `sdr_merchant:${id}:${text(row.updatedAt) ?? "snapshot"}`, row, {
      ...(company ? { business_name: company } : {}), ...(email ? { email } : {}),
      ...(phone ? { phone } : {}), ...(website ? { website } : {}),
      ...(city ? { city } : {}), ...(state ? { state } : {}),
      ...(zip ? { postal_code: zip } : {}),
    }, { merchantId: row.id, source: source ?? null, sourceRef: sourceRef ?? null,
      businessId: row.businessId ?? null, existingCustomerFlag: row.existingCustomerFlag ?? false,
      doNotContactFlag: row.doNotContactFlag ?? false });
}

export function leadDiscoverySourceSubject(row: Record<string, unknown>): Cro03aSourceDraft | null {
  const id = String(row.id);
  if (row.merchantId !== null && row.merchantId !== undefined) return null;
  const company = text(row.businessName); const email = text(row.email); const phone = text(row.phone);
  const city = text(row.city); const state = text(row.state); const zip = text(row.zip);
  return base("lead_discovery_result", id, "lead_discovery_results", `discovery:${id}`, row, {
    ...(company ? { business_name: company } : {}), ...(email ? { email } : {}),
    ...(phone ? { phone } : {}), ...(city ? { city } : {}),
    ...(state ? { state } : {}), ...(zip ? { postal_code: zip } : {}),
  }, { discoveryResultId: row.id, merchantId: null });
}

export function linkedDiscoveryEvidence(row: Record<string, unknown>): Cro03aSourceDraft | null {
  if (row.merchantId === null || row.merchantId === undefined) return null;
  const id = String(row.merchantId);
  return {
    ...sdrMerchantSourceSubject({ id, businessName: row.businessName, city: row.city, state: row.state }),
    sourceEventKey: `discovery-linked:${row.id}`,
    provenance: { sourceSystem: "lead_discovery_results", discoveryResultId: row.id, merchantId: row.merchantId, evidenceOnlyLinkedDiscovery: true },
  };
}

export function masterLeadSourceSubject(row: Record<string, unknown>): Cro03aSourceDraft {
  const id = String(row.id);
  const coordinate = [text(row.sourcePath), text(row.sheetId), text(row.tabName), row.rowNumber].filter(Boolean).join(":");
  const company = text(row.company); const email = text(row.email); const phone = text(row.phone);
  const city = text(row.city); const state = text(row.state); const website = text(row.website);
  return base("master_lead", coordinate ? `${coordinate}:${id}` : `row:${id}`, "master_leads",
    `master_lead:${id}:${coordinate || "row"}`, row, {
      ...(company ? { business_name: company } : {}), ...(email ? { email } : {}),
      ...(phone ? { phone } : {}), ...(website ? { website } : {}),
      ...(city ? { city } : {}), ...(state ? { state } : {}),
    }, { masterLeadId: row.id, sourcePath: row.sourcePath ?? null, rowNumber: row.rowNumber ?? null });
}

export function publicWebObservationSubject(input: {
  sourceKey: string; eventKey: string; payload: Record<string, unknown>; observedAt?: string;
}): Cro03aSourceDraft {
  return {
    ...base("public_web", input.sourceKey, "public_web", input.eventKey, input.payload, {}),
    sourceObservedAt: input.observedAt,
    timestampProvenance: input.observedAt ? "persisted_source_observed_at" : "ingestion_time",
  };
}

export const CRO03A_EXCLUDED_SOURCE_TYPES = Object.freeze([
  "contacts", "businesses", "companies", "deals", "opportunities", "cr04", "cr06", "ghl",
] as const);