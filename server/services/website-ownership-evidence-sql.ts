/**
 * Source types offered to the website-ownership gate (shared/source-domain-provenance.ts), qualified by what each link records.
 *
 * Recorded policy (Phase 6 CRM-10): the exception for a directory or government website means DOMAIN OWNERSHIP AS RECORDED BY AN
 * INDEPENDENT SOURCE, not just that some organization exists. An organization, organization-location or CRM-organization link
 * clears the hold only when the evidence it recorded names the same website host the business now claims. Business existence
 * ("an organization is on file") and business affiliation ("this business belongs to that organization") are different facts and
 * neither is enough on its own: an unrelated or silent organization link keeps the website in review. A link of an independent
 * type whose recorded host is missing or different is offered as "<type>:website_not_confirmed", which the gate does not
 * recognise. Links of other types (provider imports, Sunbiz entities, places) pass through unchanged and never clear the hold.
 *
 * The comparison is on normalized hosts (scheme, "www.", path and port removed, lower case), the same normalization
 * hostFromWebsite applies. This only narrows when a hold may clear; it never releases, sends or reclassifies anything.
 */
import { sql } from "drizzle-orm";
import { INDEPENDENT_OWNERSHIP_SOURCE_TYPES } from "@shared/source-domain-provenance";

export const WEBSITE_NOT_CONFIRMED_SUFFIX = ":website_not_confirmed";

const IDENTIFIER = /^[a-z][a-z0-9_]{0,30}$/;
const hostSql = (expression: string) =>
  `split_part(regexp_replace(regexp_replace(regexp_replace(lower(btrim(${expression})),'^[a-z][a-z0-9+.-]*://',''),'^www\\.',''),':[0-9]+(/.*)?$',''),'/',1)`;

/**
 * Raw SQL for `text[]` of the business's source types as the gate should see them. `linkAlias` and `businessAlias` are fixed
 * identifiers chosen by the caller (never user input).
 */
export function websiteOwnershipSourceTypesSql(linkAlias: string, businessAlias: string): string {
  if (!IDENTIFIER.test(linkAlias) || !IDENTIFIER.test(businessAlias)) throw new Error("Invalid SQL alias");
  const independent = INDEPENDENT_OWNERSHIP_SOURCE_TYPES.map(type => `'${type.replace(/'/g, "''")}'`).join(",");
  const recordedHost = hostSql(`${linkAlias}.raw_evidence->'businessEvidence'->>'websiteDomain'`);
  const claimedHost = hostSql(`${businessAlias}.website_domain`);
  return `COALESCE((SELECT array_agg(DISTINCT CASE
      WHEN ${linkAlias}.source_type = ANY(ARRAY[${independent}]::text[])
        AND NOT (COALESCE(${recordedHost},'') <> '' AND ${recordedHost} = ${claimedHost})
      THEN ${linkAlias}.source_type || '${WEBSITE_NOT_CONFIRMED_SUFFIX}'
      ELSE ${linkAlias}.source_type END)
    FROM canonical_source_links ${linkAlias} WHERE ${linkAlias}.business_id=${businessAlias}.id), ARRAY[]::text[])`;
}

/** Same rule as a predicate: this business has an independent link whose recorded evidence confirms its website host. */
export function hasConfirmedWebsiteOwnershipSql(linkAlias: string, businessAlias: string) {
  return sql.raw(`(${websiteOwnershipSourceTypesSql(linkAlias, businessAlias)} && ARRAY[${INDEPENDENT_OWNERSHIP_SOURCE_TYPES.map(t => `'${t}'`).join(",")}]::text[])`);
}
