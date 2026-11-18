import {createHash} from 'node:crypto';
import {resolveGeographyFromCandidates} from '../cro03/sfp-geography-resolver';
import {classifyVertical} from '../cro03/sfp-vertical-classifier';
import {parseOutscraperEmails,parseOutscraperContacts} from '../sdr/sfp-provider-contracts';
import {normalizeStateIdentity} from '../../../shared/state-identity';
import {normalizeDomain,normalizePhoneE164} from '../sdr/dedupe';
import type {OrganizationIdentity} from '../organization-resolution-policy';
export const MATCHING_POLICY='scheduled-discovery-v1' as const;
export const MAPPER_VERSION='outscraper-artifact-v1' as const;
export const TERMS:Record<string,string[]>={
 Automotive:['auto repair shop','auto body shop','tire shop','car dealer'],Healthcare:['dentist','chiropractor','medical clinic','physical therapist'],
 'Beauty/Spa':['hair salon','nail salon','barber shop','day spa'],'Construction/Trades/Home Services':['plumber','electrician','HVAC contractor','roofing contractor','landscaping service'],
 'Fitness/Recreation':['gym','yoga studio','martial arts school','personal trainer'],
};
export const COUNTIES:Record<string,string>={'12011':'Broward County','12086':'Miami-Dade County','12099':'Palm Beach County'};
// JSONB normalizes object key order; hash the same canonical form before and after retention.
function canonicalJson(v:any):any {return Array.isArray(v)?v.map(canonicalJson):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonicalJson(v[k])])):v;}
export function contentHash(v:unknown){return createHash('sha256').update(JSON.stringify(canonicalJson(v))).digest('hex');}
export type Scope={county_fips:string[];vertical_ids:string[];definition_county_fips?:string;vertical?:string;area_type?:string;area_key?:string};
export type ArtifactRow={raw:Record<string,unknown>;mapped:Record<string,string>;identity:OrganizationIdentity;state:'eligible'|'out_of_scope'|'unresolved'|'invalid';reasons:string[]};
export function normalizeDiscoveryRow(raw:Record<string,unknown>,scope:Scope):ArtifactRow {
 const text=(...keys:string[])=>{for(const k of keys)if(typeof raw[k]==='string'&&raw[k])return String(raw[k]).trim().slice(0,4000);return '';};
 const sourceFields=Object.fromEntries(Object.entries(raw).filter(([,v])=>v!==null&&['string','number','boolean'].includes(typeof v)).map(([k,v])=>[k,String(v).slice(0,4000)]));
 const mapped:Record<string,string>={...sourceFields,original_api_json:JSON.stringify(raw),name:text('name','title'),website:text('site','website'),address:text('full_address','address'),phone:text('phone','telephone','phone_number'),
 city:text('city'),state:normalizeStateIdentity(text('state'))??text('state'),postal_code:text('postal_code','zip'),category:text('category','type'),
 place_id:text('place_id'),google_id:text('google_id'),type:text('type','category'),subtypes:text('subtypes')};
 const contacts=parseOutscraperContacts(raw);
 const emails=[...new Set([...parseOutscraperEmails(raw),...contacts.flatMap(c=>c.emails)])];emails.forEach((e,i)=>mapped[`email_${i+1}`]=e);
 // Keep named-contact evidence tied to its mailbox rather than assigning one person's name to all emails.
 for(const contact of contacts)for(const email of contact.emails){
  const index=emails.indexOf(email);if(index<0)continue;
  if(contact.name)mapped[`email_${index+1}_full_name`]=contact.name;
  if(contact.title)mapped[`email_${index+1}_title`]=contact.title;
 }
 const identity:OrganizationIdentity={canonicalName:mapped.name,websiteDomain:normalizeDomain(mapped.website),googlePlaceId:mapped.place_id||null,
 mainPhone:normalizePhoneE164(mapped.phone),streetAddress:mapped.address,city:mapped.city,state:mapped.state,matchingPolicy:MATCHING_POLICY,
 sourceIdentity:mapped.place_id?{sourceSystem:'outscraper',sourceType:'place',stableKey:mapped.place_id}:mapped.google_id?{sourceSystem:'outscraper',sourceType:'google_id',stableKey:mapped.google_id}:undefined};
 const geo=resolveGeographyFromCandidates([{locationId:null,isPrimary:true,city:mapped.city||null,state:mapped.state||null,postalCode:mapped.postal_code||null,
 countyFips:text('county_fips')||null}]);
 const vertical=classifyVertical(mapped.type||mapped.category,scope.vertical?[scope.vertical]:scope.vertical_ids,2);
 let state:ArtifactRow['state']='eligible';const reasons:string[]=[];
 if(!mapped.name){state='invalid';reasons.push('BUSINESS_NAME_MISSING');}
 else if(geo.outcome==='outside_territory'||geo.eligible&&(!geo.countyFips||!scope.county_fips.includes(geo.countyFips))||vertical.outcome==='not_target'){
  state='out_of_scope';reasons.push('RETURNED_EVIDENCE_OUTSIDE_PROGRAM');
 }else if(!geo.eligible||!vertical.matchedTargetId){state='unresolved';reasons.push(...geo.reasons,...vertical.reasons);}
 if(state==='eligible'&&scope.definition_county_fips&&geo.countyFips!==scope.definition_county_fips){state='out_of_scope';reasons.push('RETURNED_EVIDENCE_OUTSIDE_DEFINITION_COUNTY');}
 if(state==='eligible'&&scope.area_type==='city'&&mapped.city.toLowerCase()!==scope.area_key?.trim().toLowerCase()){
  state=mapped.city?'out_of_scope':'unresolved';reasons.push('RETURNED_CITY_NOT_EXACT_SLICE');
 }
 if(state==='eligible'&&scope.area_type==='zip'&&mapped.postal_code.slice(0,5)!==scope.area_key){
  state=mapped.postal_code?'out_of_scope':'unresolved';reasons.push('RETURNED_ZIP_NOT_EXACT_SLICE');
 }
 // Never use query labels as returned-location or category evidence.
 if(vertical.matchedTargetId)mapped.vertical=vertical.matchedTargetId;
 return {raw,mapped,identity,state,reasons};
}
export function validateTimezone(zone:string){try{new Intl.DateTimeFormat('en-US',{timeZone:zone}).format();return zone;}catch{throw new Error('DISCOVERY_INVALID_TIMEZONE');}}
