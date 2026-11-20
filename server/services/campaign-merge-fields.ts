import { sanitizeFirstName } from "./contact-name-utils";

/**
 * Legacy-campaign merge fields, shared by the campaign send path and the editor's "as sent" preview.
 * Pure: no database, network or environment. Both legacy snake_case and current camelCase fields resolve identically.
 * Unknown tokens fail approval and dispatch; preview reports that hold without sending.
 */
export interface CampaignMergeSource {
  ownerFirstName?: string | null;
  ownerLastName?: string | null;
  companyName?: string | null;
  vertical?: string | null;
  city?: string | null;
  state?: string | null;
}

export function campaignMergeFields(prospect: CampaignMergeSource): Record<string, string> {
  const fields = {
    "{{first_name}}": sanitizeFirstName(prospect.ownerFirstName) || "there",
    "{{last_name}}": prospect.ownerLastName || "",
    "{{company_name}}": prospect.companyName || "your business",
    "{{vertical}}": prospect.vertical || "your industry",
    "{{city}}": prospect.city || "",
    "{{state}}": prospect.state || "",
  };
  return { ...fields, "{{firstName}}": fields["{{first_name}}"], "{{lastName}}": fields["{{last_name}}"], "{{companyName}}": fields["{{company_name}}"] };
}

export function applyCampaignMergeFields(text: string, fields: Record<string, string>): string {
  let out = text;
  for (const [key, value] of Object.entries(fields)) out = out.replace(new RegExp(key.replace(/[{}]/g, "\\$&"), "g"), () => value);
  return out;
}

export function leftoverTokens(text: string): string[] {
  return [...new Set(text.match(/\{\{[^}]+\}\}/g) ?? [])];
}

/** Validates template vocabulary without replacing recipient facts or weakening unknown-token holds. */
export function unsupportedCampaignTokens(text: string): string[] {
  const fields = campaignMergeFields({});
  return leftoverTokens(text).filter((token) => !(token in fields));
}
export function assertCampaignTemplateSupported(subject: string, body: string): void {
  if (unsupportedCampaignTokens(`${subject}\n${body}`).length) {
    throw Object.assign(new Error("Campaign contains unsupported merge fields; review the final preview before approval."), { httpStatus: 409, code: "CAMPAIGN_UNSUPPORTED_MERGE_FIELDS" });
  }
}
