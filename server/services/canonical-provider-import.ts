import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { retainProviderImportRow,providerImportRowFingerprint } from "./provider-import-evidence";
import { mapProviderCsvRow } from "./provider-import-columns";
import { resolveOrganization } from "./organization-resolver";
import { normalizeDomain, normalizePhoneE164 } from "./sdr/dedupe";
import { writeContact } from "./contact-writer";
import { recordImportRowDisposition } from "./import-execution";
import type { ImportSourceCoordinate } from "./tabular-import-reader";
import {hasCanonicalImportRecoveryClaim,type CanonicalImportRecoveryClaim} from "./canonical-import-recovery-contract";

const rows=(value:any):any[]=>value?.rows ?? value ?? [];
const sourceValue=(raw:Record<string,string>,...keys:string[])=>{
  for (const [key,value] of Object.entries(raw)) {
    if (keys.includes(key.trim().toLowerCase().replace(/\s+/g,"_")) && value?.trim()) return value.trim();
  }
  return null;
};
async function resumeImportedAffiliations(contactIds:number[],authorityCheck:(tx:any)=>Promise<boolean>) {
  const {previewContactBusinessSystemLinks,applyContactBusinessSystemLink}=await import("./contact-business-system-links");
  const {initializeImportedLinkedContactClass}=await import("./commercial-classification-authority");
  for (const contactId of contactIds) {
    const preview=await previewContactBusinessSystemLinks({afterContactId:contactId-1,limit:1});
    const proposed=preview.rows.find(row=>row.contactId===contactId);
    if (proposed?.eligible && proposed.businessId && proposed.sourceLinkId) {
      await applyContactBusinessSystemLink({contactId,businessId:proposed.businessId,sourceLinkId:proposed.sourceLinkId,
        sourceEntityId:proposed.sourceEntityId,snapshotHash:proposed.snapshotHash},authorityCheck);
    }
    await initializeImportedLinkedContactClass(contactId,authorityCheck);
  }
}
/** Preserve every supplied address as evidence; only syntactically usable,
 * distinct addresses materialize contacts. No email status from a CSV is a
 * purchased hygiene receipt or affiliation authority. */
export function providerImportEmails(raw:Record<string,string>):string[] {
  const emails=new Set<string>();
  for (const [key,value] of Object.entries(raw)) {
    if (!/email/i.test(key) || /status|verified|validation|score|source|type|name/i.test(key)) continue;
    for (const token of String(value ?? "").split(/[,;\s|]+/)) {
      const email=token.trim().toLowerCase();
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) emails.add(email);
    }
  }
  return [...emails].sort();
}
/** A numbered vendor address keeps its own person/role observations. Never
 * assign one person's name/title to every unrelated mailbox in a source row. */
export function providerImportRecipient(raw:Record<string,string>,email:string) {
  const addressFields=Object.entries(raw).filter(([key,value])=>
    /email/i.test(key) && !/status|verified|validation|score|source|type|name/i.test(key) &&
    String(value).toLowerCase().split(/[,;\s|]+/).includes(email));
  for (const [key] of addressFields) {
    const prefix=key.trim().toLowerCase().replace(/\s+/g,"_");
    const firstName=sourceValue(raw,`${prefix}_first_name`);
    const lastName=sourceValue(raw,`${prefix}_last_name`);
    const fullName=sourceValue(raw,`${prefix}_full_name`,`${prefix}_name`);
    const title=sourceValue(raw,`${prefix}_title`,`${prefix}_job_title`,`${prefix}_position`);
    if (firstName || lastName || fullName || title) {
      const parts=fullName?.split(/\s+/) ?? [];
      return {firstName:firstName ?? parts[0] ?? "",lastName:lastName ?? parts.slice(1).join(" "),title:title ?? ""};
    }
  }
  return null;
}

export async function materializeCanonicalProviderImportRow(input:{
  executionId:string; claimToken?:string; recoveryClaim?:CanonicalImportRecoveryClaim;
  sourceRowNumber:number; sourceFormat:string;
  actorId:string; rawRow:Record<string,string>; sourceCoordinate?:ImportSourceCoordinate; fileName?:string;
  ownerAuthorityCheck?:(tx:any)=>Promise<void>;
}) {
  const mapped=mapProviderCsvRow(input.rawRow,input.sourceFormat);
  const fingerprint=await providerImportRowFingerprint(input);
  const authorityCheck=async(tx:any)=>{
    if (input.ownerAuthorityCheck) await input.ownerAuthorityCheck(tx);
    return input.recoveryClaim ? hasCanonicalImportRecoveryClaim(tx,{
    executionId:input.executionId,sourceRowNumber:input.sourceRowNumber,rowFingerprint:fingerprint,
    recoveryClaim:input.recoveryClaim,
  }) : rows(await tx.execute(sql`SELECT id FROM import_executions
    WHERE id=${input.executionId}::uuid AND claim_token=${input.claimToken}::uuid
       AND status='running' AND lease_expires_at>=clock_timestamp() FOR UPDATE`)).length===1;
  };
  await retainProviderImportRow({...input,authorityCheck});
  const original=await db.transaction(async tx=>{
    if (!await authorityCheck(tx)) throw new Error("IMPORT_EXECUTION_LEASE_LOST");
    const receipt=rows(await tx.execute(sql`SELECT * FROM import_row_dispositions
      WHERE execution_id=${input.executionId}::uuid AND source_row_number=${input.sourceRowNumber}`))[0];
    if (receipt && receipt.row_fingerprint!==fingerprint) throw new Error("IMPORT_ROW_FINGERPRINT_MISMATCH");
    return receipt;
  });
  if (original && !input.recoveryClaim) {
    // Original row accounting is immutable, even when enrichment remains held.
    // Recovery confirms evidence rather than rewriting a previous disposition.
    const contacts=rows(await db.execute(sql`SELECT DISTINCT contact_id FROM contact_source_events
      WHERE import_execution_id=${input.executionId}::uuid AND source_row_number=${input.sourceRowNumber}
        AND row_fingerprint=${fingerprint}`));
    const contactIds=contacts.map(row=>Number(row.contact_id));
    await resumeImportedAffiliations(contactIds,authorityCheck);
    const linked=contactIds.length ? rows(await db.execute(sql`SELECT DISTINCT business_id FROM contacts
      WHERE id IN (${sql.join(contactIds.map(id=>sql`${id}`),sql`,`)}) AND business_id IS NOT NULL`)) : [];
    return {disposition:String(original.disposition),contactIds,
      businessId:original.diagnostic?.businessId ?? (linked.length===1 ? Number(linked[0].business_id) : null)};
  }
  const name=mapped.companyName?.trim();
  const hold=async(reasonCode:string,diagnostic?:Record<string,unknown>)=>{
    if (input.recoveryClaim) {
      await db.transaction(async tx=>{
        if (!await authorityCheck(tx)) throw new Error("CANONICAL_IMPORT_RECOVERY_CLAIM_LOST");
        await tx.execute(sql`UPDATE cro03_enrichment_items SET state='blocked',terminal_code=${reasonCode},
          claim_token=NULL,lease_expires_at=NULL,current_provider=NULL,updated_at=clock_timestamp()
          WHERE id=${input.recoveryClaim!.itemId}::uuid`);
      });
    } else {
      if (!input.claimToken) throw new Error("IMPORT_EXECUTION_CLAIM_REQUIRED");
      await recordImportRowDisposition({...input,claimToken:input.claimToken,rowFingerprint:fingerprint,
        disposition:"deferred",reasonCode,diagnostic});
    }
    return {disposition:"deferred",fulfillmentState:"held",contactIds:[] as number[],
      businessId:typeof diagnostic?.businessId==="number" ? diagnostic.businessId : null};
  };
  if (!name) {
    return hold("CANONICAL_IMPORT_BUSINESS_IDENTITY_MISSING");
  }
  const place=sourceValue(input.rawRow,"place_id","google_place_id","placeid");
  const resolution=await resolveOrganization({
    canonicalName:name,websiteDomain:normalizeDomain(mapped.website),googlePlaceId:place,
    mainPhone:normalizePhoneE164(mapped.phone),city:mapped.city,state:mapped.state,authorityCheck,
    create:{recordClass:"canonical",streetAddress:mapped.address,postalCode:mapped.zip,
      vertical:mapped.vertical ?? mapped.industry,lastSourceType:input.sourceFormat},
  });
  if (resolution.kind==="deferred") {
    return hold(`CANONICAL_IMPORT_${resolution.reasonCode}`,{candidateIds:resolution.candidateIds});
  }
  const businessId=Number(resolution.business.id);
  // Never import provider validity claims as hygiene. Restrictive source facts
  // are applied through canonical consent in the SAME fenced local transaction.
  const {importedSourceRestrictions}=await import("./provider-import-columns");
  const {customer,consentFlags,restrictions}=importedSourceRestrictions(input.rawRow);
  const sourceSystem=input.sourceFormat==="google_maps_outscraper" ? "outscraper" : "apollo";
  const stableKey=place ?? sourceValue(input.rawRow,"organization_id","company_id","apollo_organization_id")
    ?? `import:${input.executionId}:row:${input.sourceRowNumber}`;
  let result;
  try {
  result=await db.transaction(async tx=>{
    if (!await authorityCheck(tx)) throw new Error("IMPORT_EXECUTION_LEASE_LOST");
    const source=rows(await tx.execute(sql`INSERT INTO canonical_source_links
      (business_id,source_system,source_type,stable_key,raw_evidence)
      VALUES(${businessId},${sourceSystem},${place ? "place" : "provider_import"},${stableKey},
        ${JSON.stringify({executionId:input.executionId,sourceRowNumber:input.sourceRowNumber,
          rowFingerprint:fingerprint})}::jsonb)
      ON CONFLICT(source_system,source_type,stable_key) DO UPDATE
        SET last_confirmed_at=clock_timestamp()
      RETURNING id,business_id`))[0];
    if (Number(source.business_id)!==businessId) throw new Error("CANONICAL_IMPORT_STABLE_SOURCE_CONFLICT");
    if (mapped.address || mapped.city || mapped.zip || place) {
      // Serialize insertion-only source locations on the canonical root. Keep
      // vendor county/neighborhood labels observational, not FIPS authority.
      await tx.execute(sql`SELECT id FROM businesses WHERE id=${businessId} FOR UPDATE`);
      const existing=rows(await tx.execute(sql`SELECT id FROM business_locations WHERE business_id=${businessId}
        AND ((${place}::text IS NOT NULL AND google_place_id=${place})
          OR (street_address IS NOT DISTINCT FROM ${mapped.address ?? null}
            AND city IS NOT DISTINCT FROM ${mapped.city ?? null}
            AND state IS NOT DISTINCT FROM ${mapped.state ?? null}
            AND postal_code IS NOT DISTINCT FROM ${mapped.zip ?? null})) LIMIT 1`))[0];
      if (!existing) {
        await tx.execute(sql`INSERT INTO business_locations
          (business_id,street_address,city,state,postal_code,phone,website_url,google_place_id,is_primary)
          VALUES(${businessId},${mapped.address ?? null},${mapped.city ?? null},${mapped.state ?? null},
            ${mapped.zip ?? null},${normalizePhoneE164(mapped.phone)},${mapped.website ?? null},${place},
            NOT EXISTS(SELECT 1 FROM business_locations WHERE business_id=${businessId}))`);
      }
    }
    const emails=providerImportEmails(input.rawRow);
    const contactIds:number[]=[];
    for (const [index,email] of emails.entries()) {
      const person=providerImportRecipient(input.rawRow,email);
      // Flat Apollo rows represent a person; numbered Maps mailboxes do not.
      const flatPerson=input.sourceFormat==="apollo_lead_list" && emails.length===1;
      const contact=await writeContact({
        mode:"local_only",transaction:tx,
        retainedSourceRecovery:input.recoveryClaim,
        mutation:{email,phone:normalizePhoneE164(mapped.phone) ?? "",
           firstName:person?.firstName ?? (flatPerson ? mapped.firstName ?? "" : ""),
           lastName:person?.lastName ?? (flatPerson ? mapped.lastName ?? "" : ""),companyName:name,
           website:mapped.website ?? "",title:person?.title ?? (flatPerson ? mapped.title ?? "" : ""),city:mapped.city ?? "",
           state:mapped.state ?? "",address:mapped.address ?? "",importBatchId:input.executionId,
           ...(customer ? {existingMerchantCustomer:true} : {})},
        provenance:{sourceCategory:"csv_import",sourceType:sourceSystem,
          eventKey:`canonical-provider:${input.executionId}:${input.sourceRowNumber}:${createHash("sha256").update(email).digest("hex")}`,
          importExecutionId:input.executionId,importClaimToken:input.claimToken,
          sourceRowNumber:input.sourceRowNumber,rowFingerprint:fingerprint,sourceExternalId:stableKey,
          actorType:"import",actorId:input.actorId,
           metadata:{place_id:place,sourceFormat:input.sourceFormat,sourceCoordinate:input.sourceCoordinate ?? null,
             canonicalRecoveryItemId:input.recoveryClaim?.itemId ?? null}},
        actor:{actorType:"import",actorId:input.actorId},
        hookPolicy:{source:"cro03",deferValidation:true,deferReadiness:true,
          deferLeadScoring:true,suppressProviderProjection:true,authorityCheck},
        rowDisposition:{createdReasonCode:"CANONICAL_PROVIDER_CONTACT_CREATED",
          matchedReasonCode:"CANONICAL_PROVIDER_CONTACT_MATCHED",additionalContact:index>0},
      });
      contactIds.push(contact.id);
      if (customer) await tx.execute(sql`UPDATE contacts SET existing_merchant_customer=TRUE,updated_at=clock_timestamp()
        WHERE id=${contact.id} AND existing_merchant_customer IS DISTINCT FROM TRUE`);
      if (restrictions.length) {
        const {applyConsentCommand}=await import("./consent-authority");
        for (const kind of restrictions) {
        await applyConsentCommand({
          subject:{type:"contact",id:contact.id},
          kind,
          ...(kind==="global_dnc" ? {} : {channel:"email" as const}),
          eventNamespace:"canonical_provider_import_restriction",
          eventKey:`${input.executionId}:${input.sourceRowNumber}:${contact.id}:${fingerprint}:${kind}`,
          source:"canonical_provider_import",actorId:input.actorId,
          evidence:{sourceEventId:contact._sourceEventId,sourceRowNumber:input.sourceRowNumber,
            rowFingerprint:fingerprint,negativeFields:consentFlags.map(([key])=>key)},
        },{transaction:tx,beforeWrite:async(tx:any)=>{
          if (!await authorityCheck(tx)) throw new Error("CANONICAL_IMPORT_RESTRICTION_AUTHORITY_LOST");
        }});
        }
      }
    }
    if (!emails.length) {
      // Business-only is a real committed transition, not a fake placeholder
      // contact, inbound request, validation or outreach approval.
      await tx.execute(sql`INSERT INTO import_row_dispositions
        (execution_id,source_row_number,row_fingerprint,disposition,reason_code,diagnostic)
        VALUES(${input.executionId}::uuid,${input.sourceRowNumber},${fingerprint},
          ${resolution.kind==="created" ? "created" : "matched_noop"} ,'CANONICAL_PROVIDER_BUSINESS_ONLY',
          ${JSON.stringify({businessId,sourceLinkId:source.id,contactIds:[]})}::jsonb)
        ON CONFLICT(execution_id,source_row_number) DO NOTHING`);
    }
    const receipt=rows(await tx.execute(sql`SELECT disposition FROM import_row_dispositions
      WHERE execution_id=${input.executionId}::uuid AND source_row_number=${input.sourceRowNumber}`))[0];
    return {disposition:String(receipt.disposition),fulfillmentState:"completed",businessId,contactIds};
  });
  } catch (error) {
    if (error instanceof Error && error.message==="CANONICAL_IMPORT_STABLE_SOURCE_CONFLICT")
      return hold("CANONICAL_IMPORT_STABLE_SOURCE_CONFLICT",{businessId,stableKey,sourceSystem});
    throw error;
  }
  await resumeImportedAffiliations(result.contactIds,authorityCheck);
  return result;
}