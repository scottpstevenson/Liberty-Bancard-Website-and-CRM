import { sanitizeFirstName } from "./contact-name-utils";

/**
 * Legacy-campaign merge fields, shared by the campaign send path and the editor's "as sent" preview.
 * Pure: no database, network or environment. Unknown {{tokens}} are NOT replaced and are NOT blocked by the campaign
 * send path, so they would be delivered literally; `leftoverTokens` lets the preview say so.
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
  return {
    "{{first_name}}": sanitizeFirstName(prospect.ownerFirstName) || "there",
    "{{last_name}}": prospect.ownerLastName || "",
    "{{company_name}}": prospect.companyName || "your business",
    "{{vertical}}": prospect.vertical || "your industry",
    "{{city}}": prospect.city || "",
    "{{state}}": prospect.state || "",
  };
}

export function applyCampaignMergeFields(text: string, fields: Record<string, string>): string {
  let out = text;
  for (const [key, value] of Object.entries(fields)) out = out.replace(new RegExp(key.replace(/[{}]/g, "\\$&"), "g"), value);
  return out;
}

export function leftoverTokens(text: string): string[] {
  return [...new Set(text.match(/\{\{[^}]+\}\}/g) ?? [])];
}
