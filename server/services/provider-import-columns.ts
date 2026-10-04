/** Shared legacy projection for uploads and restart recovery. Raw columns are
 * retained separately; extending this projection must not rewrite old evidence. */
const googleMapsColumnMap: Record<string, string> = {
  "name": "companyName", "telephone": "phone", "phone": "phone",
  "category": "industry", "rating": "rating", "review_count": "reviewCount",
  "reviews": "reviewCount", "keyword": "keyword", "address": "address",
  "website": "website", "city": "city", "state": "state",
};
const apolloColumnMap: Record<string, string> = {
  "first_name": "firstName", "first name": "firstName", "firstname": "firstName",
  "last_name": "lastName", "last name": "lastName", "lastname": "lastName",
  "email": "email", "email_address": "email",
  "mobile_phone": "phone", "mobile phone": "phone", "corporate_phone": "phone", "corporate phone": "phone", "phone": "phone",
  "company": "companyName", "company_name": "companyName", "company name": "companyName",
  "title": "title", "industry": "industry", "keywords": "keywords",
  "#_employees": "employeeCount", "# employees": "employeeCount", "employees": "employeeCount",
  "annual_revenue": "annualRevenue", "annual revenue": "annualRevenue",
  "company_address": "address", "company address": "address", "address": "address",
  "city": "city", "company_city": "city", "company city": "city",
  "state": "state", "company_state": "state", "company state": "state",
  "website": "website",
  "person_linkedin_url": "linkedinUrl", "person linkedin url": "linkedinUrl",
  "facebook_url": "facebookUrl", "facebook url": "facebookUrl",
};
const genericColumnMap: Record<string, string> = {
  ...apolloColumnMap, ...googleMapsColumnMap,
  "business_name": "companyName", "business name": "companyName", "business": "companyName",
  "dba": "dba", "doing_business_as": "dba",
  "owner_first_name": "firstName", "owner_first": "firstName", "contact_first_name": "firstName",
  "owner_last_name": "lastName", "owner_last": "lastName", "contact_last_name": "lastName",
  "owner_email": "ownerEmail", "contact_email": "email",
  "owner_phone": "ownerPhone", "contact_phone": "phone",
  "street": "address", "street_address": "address",
  "zip": "zip", "zipcode": "zip", "zip_code": "zip", "postal": "zip", "postal_code": "zip",
  "vertical": "vertical", "type": "vertical",
  "volume": "monthlyVolume", "estimated_volume": "monthlyVolume", "monthly_volume": "monthlyVolume",
  "processor": "currentProvider", "current_processor": "currentProvider",
  "employee_count": "employeeCount", "year_established": "yearEstablished", "established": "yearEstablished",
  "google_rating": "rating", "google_reviews": "reviewCount",
  "lead_source": "leadSource", "source": "leadSource",
  "notes": "notes", "tags": "tags",
  "email_status": "emailStatus", "emailstatus": "emailStatus",
  "consent_tier": "consentTier", "consenttier": "consentTier",
  "opted_out_email": "optedOutEmail", "optedoutemail": "optedOutEmail", "opted_out": "optedOutEmail",
  "do_not_contact": "doNotContact", "donotcontact": "doNotContact", "dnc": "doNotContact",
  "do_not_auto_contact": "doNotAutoContact", "donotautocontact": "doNotAutoContact",
  "unsubscribed": "emailStatus",
};
export function getImportColumnMap(sourceFormat: string): Record<string, string> {
  return sourceFormat === "google_maps_outscraper" ? { ...genericColumnMap, ...googleMapsColumnMap }
    : sourceFormat === "apollo_lead_list" ? { ...genericColumnMap, ...apolloColumnMap }
    : { ...genericColumnMap };
}
export function mapProviderCsvRow(row: Record<string, unknown>, sourceFormat: string): Record<string, string> {
  const columnMap = getImportColumnMap(sourceFormat);
  const mapped: Record<string, string> = {};
  for (const [column, value] of Object.entries(row)) {
    if (!value || typeof value !== "string") continue;
    const normalized = column.toLowerCase().trim().replace(/\s+/g, "_");
    const original = column.toLowerCase().trim();
    const field = Object.hasOwn(columnMap, normalized) ? columnMap[normalized]
      : Object.hasOwn(columnMap, original) ? columnMap[original] : undefined;
    if (field) mapped[field] = value.trim();
  }
  return mapped;
}

/** Imported positive validity/consent claims never grant permission. Only
 * independently asserted restrictive dimensions and a monotonic customer flag
 * are projected; retain the original columns as evidence. */
export function importedSourceRestrictions(row: Record<string, unknown>) {
  const normalizedKey=(key:string)=>key.toLowerCase().replace(/[^a-z0-9]/g,"");
  const negativeFlags=Object.entries(row).filter(([key,value])=>
    /opt(?:ed)?out|unsubscrib|donot(?:auto)?contact|existingcustomer|existingmerchant|complaint|bounce|^dnc$|emailstatus/.test(normalizedKey(key))
      && /^(true|yes|1|opted.?out|unsubscribed|blocked|bounced|hard|hard.?bounce|reported)$/i.test(String(value).trim()));
  const customer=negativeFlags.some(([key])=>/existingcustomer|existingmerchant/.test(normalizedKey(key)));
  const consentFlags=negativeFlags.filter(([key])=>!/existingcustomer|existingmerchant/.test(normalizedKey(key)));
  const restrictions=([
    consentFlags.some(([key])=>/donotcontact|^dnc$|complaint|bounce/.test(normalizedKey(key))) ? "global_dnc" : null,
    consentFlags.some(([key])=>/donotautocontact/.test(normalizedKey(key))) ? "block_auto_contact" : null,
    consentFlags.some(([key])=>/opt(?:ed)?out|unsubscrib|emailstatus/.test(normalizedKey(key))) ? "opt_out" : null,
  ] as const).filter((kind):kind is "global_dnc"|"block_auto_contact"|"opt_out"=>kind!==null);
  return {customer,consentFlags,restrictions};
}