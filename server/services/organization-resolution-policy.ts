import { normalizeStateIdentity } from "../../shared/state-identity";

export type OrganizationIdentity = {
  canonicalName: string;
  websiteDomain?: string | null;
  googlePlaceId?: string | null;
  mainPhone?: string | null;
  city?: string | null;
  state?: string | null;
  streetAddress?: string | null;
  matchingPolicy?: "scheduled-discovery-v1" | "retained-public-registry-v1";
  sourceIdentity?: {sourceSystem: string; sourceType: string; stableKey: string};
};
export type OrganizationCandidate = OrganizationIdentity & {id: number; exactSource?: boolean};
export const normalOrganizationValue = (value?: string | null) => value?.trim().toLowerCase() || null;
export const normalOrganizationName = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
// US country-code formatting is not contrary identity evidence. Do not use
// a blanket last-ten-digits comparison: other international prefixes matter.
const phone = (value?: string | null) => value?.replace(/\D/g, "")
  .replace(/^1(?=\d{10}$)/,"") || null;
const address = (value?: string | null) => value?.toLowerCase().replace(/[^a-z0-9]/g, "") || null;

/** A shared domain is brand evidence, not an exact operating-location key. */
export function decideOrganizationIdentity(input: OrganizationIdentity, candidates: OrganizationCandidate[]):
  {kind: "matched"; id: number} | {kind: "create"} |
  {kind: "deferred"; reasonCode: "INSUFFICIENT_ORGANIZATION_EVIDENCE" | "AMBIGUOUS_ORGANIZATION_MATCH"; candidateIds: number[]} {
  if(input.matchingPolicy === "scheduled-discovery-v1") return decideDiscoveryIdentity(input,candidates);
  const conflict = (candidate: OrganizationCandidate) =>
    !!((input.googlePlaceId && candidate.googlePlaceId && input.googlePlaceId.trim() !== candidate.googlePlaceId.trim()) ||
      (input.websiteDomain && candidate.websiteDomain && normalOrganizationValue(input.websiteDomain) !== normalOrganizationValue(candidate.websiteDomain)) ||
      (phone(input.mainPhone) && phone(candidate.mainPhone) && phone(input.mainPhone) !== phone(candidate.mainPhone)) ||
      (input.city && candidate.city && normalOrganizationValue(input.city) !== normalOrganizationValue(candidate.city)) ||
      (input.state && candidate.state && normalizeStateIdentity(input.state) !== normalizeStateIdentity(candidate.state)) ||
      (address(input.streetAddress) && address(candidate.streetAddress) && address(input.streetAddress) !== address(candidate.streetAddress)) ||
      (normalOrganizationName(input.canonicalName) && normalOrganizationName(candidate.canonicalName) &&
        normalOrganizationName(input.canonicalName) !== normalOrganizationName(candidate.canonicalName)));
  const exactSource = candidates.filter(candidate => candidate.exactSource);
  const exactPlace = candidates.filter(candidate => input.googlePlaceId &&
    candidate.googlePlaceId === input.googlePlaceId.trim());
  // Exact source and place cannot silently disagree about ownership.
  const exact = [...new Map([...exactSource, ...exactPlace].map(candidate => [candidate.id, candidate])).values()];
  const compatible = candidates.filter(candidate => !conflict(candidate));
  const selected = exact.length ? exact : compatible;
  if (selected.length === 1 && !conflict(selected[0])) return {kind: "matched", id: selected[0].id};
  if (selected.length || candidates.length) {
    // A separately supported branch may be created despite unrelated brand-domain
    // candidates. Without a precise place/location, contradiction stays a hold.
    const supportsDistinctLocation = !!input.googlePlaceId ||
      !!(address(input.streetAddress) && input.city?.trim() && normalizeStateIdentity(input.state) &&
        (normalOrganizationValue(input.websiteDomain) || phone(input.mainPhone)));
    const distinct = (candidate: OrganizationCandidate) =>
      !!((input.googlePlaceId && candidate.googlePlaceId && input.googlePlaceId !== candidate.googlePlaceId) ||
        (input.city && candidate.city && normalOrganizationValue(input.city) !== normalOrganizationValue(candidate.city)) ||
        (input.state && candidate.state && normalizeStateIdentity(input.state) !== normalizeStateIdentity(candidate.state)) ||
        (address(input.streetAddress) && address(candidate.streetAddress) && address(input.streetAddress) !== address(candidate.streetAddress)));
    if (!exact.length && !compatible.length && supportsDistinctLocation && candidates.every(distinct))
      return {kind: "create"};
    return {kind: "deferred", reasonCode: "AMBIGUOUS_ORGANIZATION_MATCH",
      candidateIds: (selected.length ? selected : candidates).map(candidate => candidate.id).sort((a,b)=>a-b)};
  }
  // Only the retained registry worker selects this policy after verifying its
  // durable source occurrence and native claim. Manual/import defaults remain unchanged.
  const registryIdentity = input.matchingPolicy === "retained-public-registry-v1"
    && input.sourceIdentity?.sourceType === "public_registry"
    && !!input.sourceIdentity.sourceSystem.trim() && !!input.sourceIdentity.stableKey.trim();
  if (!normalOrganizationName(input.canonicalName) ||
      !(registryIdentity || input.googlePlaceId?.trim() || normalOrganizationValue(input.websiteDomain) || phone(input.mainPhone) ||
        (address(input.streetAddress) && input.city?.trim() && normalizeStateIdentity(input.state))))
    return {kind: "deferred", reasonCode: "INSUFFICIENT_ORGANIZATION_EVIDENCE", candidateIds: []};
  return {kind: "create"};
}

/** Mirrors the immutable SQL crm_identity_name legal-suffix key; SQL remains retrieval authority. */
export const discoveryName=(v:string)=>v.normalize('NFKD').toLowerCase()
  .replace(/\b(incorporated|inc|limited|ltd|llc|llp|corp|corporation|company|co)\b/g, "")
  .replace(/[^a-z0-9]/g, "");
function decideDiscoveryIdentity(input:OrganizationIdentity,candidates:OrganizationCandidate[]):ReturnType<typeof decideOrganizationIdentity> {
  const uniq=(a:OrganizationCandidate[])=>[...new Map(a.map(c=>[c.id,c])).values()];
  const samePlace=(a?:string|null,b?:string|null)=>!!a&&!!b&&a.trim()===b.trim();
  const sourceOwned=(c:OrganizationCandidate)=>!!c.exactSource||!!input.sourceIdentity&&!!c.sourceIdentity&&input.sourceIdentity.sourceSystem===c.sourceIdentity.sourceSystem&&input.sourceIdentity.sourceType===c.sourceIdentity.sourceType&&input.sourceIdentity.stableKey===c.sourceIdentity.stableKey;
  const same=(a?:string|null,b?:string|null)=>!!a&&!!b&&normalOrganizationValue(a)===normalOrganizationValue(b);
  const differentLocation=(c:OrganizationCandidate)=>!!((input.state&&c.state&&normalizeStateIdentity(input.state)!==normalizeStateIdentity(c.state))||
    (input.city&&c.city&&!same(input.city,c.city))||(address(input.streetAddress)&&address(c.streetAddress)&&address(input.streetAddress)!==address(c.streetAddress)));
  const differentPlace=(c:OrganizationCandidate)=>!!input.googlePlaceId&&!!c.googlePlaceId&&input.googlePlaceId!==c.googlePlaceId;
  const exact=uniq(candidates.filter(c=>sourceOwned(c)||samePlace(input.googlePlaceId,c.googlePlaceId)));
  // Strong identifiers owned by different businesses are an actual conflict, not weak missing metadata.
  const strong=uniq(candidates.filter(c=>sourceOwned(c)||samePlace(input.googlePlaceId,c.googlePlaceId)||
    (!differentLocation(c)&&!differentPlace(c)&&(same(input.websiteDomain,c.websiteDomain)||!!phone(input.mainPhone)&&phone(input.mainPhone)===phone(c.mainPhone)))));
  const hold=(a:OrganizationCandidate[]):ReturnType<typeof decideOrganizationIdentity>=>({kind:"deferred",reasonCode:"AMBIGUOUS_ORGANIZATION_MATCH",candidateIds:uniq(a).map(c=>c.id).sort((a,b)=>a-b)});
  const domainOwners=candidates.filter(c=>same(input.websiteDomain,c.websiteDomain));
  const phoneOwners=candidates.filter(c=>!!phone(input.mainPhone)&&phone(input.mainPhone)===phone(c.mainPhone));
  const uniqueOwned=uniq([...(domainOwners.length===1?domainOwners:[]),...(phoneOwners.length===1?phoneOwners:[])]);
  if(exact.length){if(exact.length!==1||uniqueOwned.some(c=>c.id!==exact[0].id)||differentPlace(exact[0]))return hold(uniq([...exact,...uniqueOwned]));
    return {kind:"matched",id:exact[0].id};}
  if(strong.length===1)return {kind:"matched",id:strong[0].id};
  if(strong.length>1)return hold(strong);
  const names=candidates.filter(c=>discoveryName(input.canonicalName)===discoveryName(c.canonicalName)&&
    !differentLocation(c)&&!differentPlace(c)&&!!input.city&&!!input.state&&same(input.city,c.city)&&normalizeStateIdentity(input.state)===normalizeStateIdentity(c.state)&&
    !!address(input.streetAddress)&&address(input.streetAddress)===address(c.streetAddress));
  if(names.length===1)return {kind:"matched",id:names[0].id};
  if(names.length>1)return hold(names);
  if(candidates.length&&!candidates.every(c=>differentPlace(c)||differentLocation(c)))return hold(candidates);
  const usable=!!input.googlePlaceId||!!normalOrganizationValue(input.websiteDomain)||!!phone(input.mainPhone)||
    !!(address(input.streetAddress)&&input.city&&normalizeStateIdentity(input.state));
  return usable&&!!normalOrganizationName(input.canonicalName)?{kind:"create"}:{kind:"deferred",reasonCode:"INSUFFICIENT_ORGANIZATION_EVIDENCE",candidateIds:[]};
}
