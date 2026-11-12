/**
 * Lifecycle-aware document expectations for a Contact.
 *
 * What a person is asked for depends on where the relationship actually is. Identity and banking documents are sensitive and are
 * only listed once underwriting is the current purpose; an early statement lead is never shown a checklist that implies they owe
 * an application, ID, or voided check. This list is display only: it creates no request, message, or task.
 */
export type ExpectedDocument = { category: string; label: string };

const APPLICATION: ExpectedDocument = { category: "Application", label: "Merchant Application" };
const PHOTO_ID: ExpectedDocument = { category: "Photo ID", label: "Government-Issued Photo ID" };
const VOIDED_CHECK: ExpectedDocument = { category: "Voided Check", label: "Voided Check / Bank Letter" };
const STATEMENT: ExpectedDocument = { category: "Processing Statement", label: "Processing Statement" };

const PARTNER_DOCUMENTS: readonly ExpectedDocument[] = [
  { category: "EIN Letter", label: "W9 / EIN Letter" },
  { category: "Signed Proposal", label: "Partner Agreement" },
];

type Purpose = "early" | "statement" | "application" | "underwriting" | "ongoing" | "ended" | "unknown";

const PURPOSE_BY_STATE: Record<string, Purpose> = {
  PROSPECT: "early", ENGAGED: "early", APPOINTMENT_SCHEDULED: "early", APPOINTMENT_COMPLETED: "early",
  STATEMENT_REQUESTED: "statement", STATEMENT_RECEIVED: "statement", STATEMENT_ANALYZED: "statement",
  PROPOSAL_READY: "statement", PROPOSAL_SENT: "statement", NEGOTIATION: "statement",
  APPLICATION_STARTED: "application", APPLICATION_COMPLETE: "application",
  UNDERWRITING: "underwriting", UNDERWRITING_CONDITIONAL: "underwriting", APPROVED: "underwriting", BOARDING: "underwriting",
  EQUIPMENT_DEPLOYMENT: "underwriting", ACTIVATION_PENDING: "underwriting", FIRST_TRANSACTION: "underwriting", FIRST_FUNDING: "underwriting",
  ACTIVE_PROCESSING: "ongoing", HEALTHY: "ongoing", AT_RISK: "ongoing", RETENTION: "ongoing",
  CHURNED: "ended", WINBACK: "ended", CLOSED_LOST: "ended",
};

export type DocumentExpectation = {
  purpose: Purpose;
  expected: readonly ExpectedDocument[];
  /** Plain-language scope shown with the checklist so a short list is never mistaken for a complete one. */
  note: string;
};

export function expectedDocumentsFor(input: { lifecycleState?: string | null; isPartner?: boolean }): DocumentExpectation {
  if (input.isPartner) {
    return { purpose: "ongoing", expected: PARTNER_DOCUMENTS, note: "Partner documents requested for a partner organization contact." };
  }
  const state = String(input.lifecycleState ?? "").trim().toUpperCase();
  const purpose = PURPOSE_BY_STATE[state] ?? "unknown";
  switch (purpose) {
    case "early":
      return { purpose, expected: [], note: "No documents are requested at this stage. Files can still be added below." };
    case "statement":
      return { purpose, expected: [STATEMENT], note: "Only a processing statement is requested at this stage. Application, ID and banking documents are requested once underwriting begins." };
    case "application":
      return { purpose, expected: [APPLICATION, STATEMENT], note: "The application is in progress. ID and banking documents are requested once underwriting begins." };
    case "underwriting":
      return { purpose, expected: [APPLICATION, PHOTO_ID, VOIDED_CHECK, STATEMENT], note: "Underwriting and boarding documents for this stage." };
    case "ongoing":
      return { purpose, expected: [], note: "This account is processing. Documents on file are listed below; none are requested automatically." };
    case "ended":
      return { purpose, expected: [], note: "This relationship is closed. Documents on file are listed below; none are requested." };
    default:
      return { purpose: "unknown", expected: [], note: "The lifecycle stage is not recorded, so no document is listed as required. Files can still be added below." };
  }
}
