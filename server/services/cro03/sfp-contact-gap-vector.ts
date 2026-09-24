import {
  getAuthoritativeVerifiedContactLinks,
  type AuthoritativeContactBusinessLink,
} from "../commercial-link-authority";

export type SfpGapDimension =
  | "geography"
  | "target_vertical"
  | "official_domain"
  | "business_identity"
  | "business_contact_channel"
  | "named_decision_maker";

/** Only the resolver's positive, in-territory outcome closes geography. */
export function isResolvedSouthFloridaGeographyOutcome(outcome: unknown): boolean {
  return String(outcome ?? "") === "resolved";
}

/** A usable business identity requires both a phone and physical locality. */
export function hasResolvedBusinessIdentity(input: {
  mainPhone?: unknown;
  streetAddress?: unknown;
  city?: unknown;
}): boolean {
  return [input.mainPhone, input.streetAddress, input.city]
    .every((value) => typeof value === "string" && value.trim().length > 0);
}

export interface SfpGapVectorEntry {
  dimension: SfpGapDimension;
  open: boolean;
  closedBy: string | null;
  evidenceRef: string | null;
  subjectExclusions: Array<{
    subjectHash: string;
    authority: string;
    reasonCode: string;
    channel: string;
  }>;
}

export interface SfpBusinessGapVector {
  businessId: number;
  before: SfpGapVectorEntry[];
  after: SfpGapVectorEntry[];
  skippedProviderCalls: Array<{ provider: string; reason: string }>;
}

export async function computeContactLinkReuse(
  businessIds: number[],
): Promise<
  Map<
    number,
    {
      hasVerifiedContact: boolean;
      hasVerifiedNamedDecisionMaker: boolean;
      verifiedLinks: AuthoritativeContactBusinessLink[];
      skipReason: string | null;
    }
  >
> {
  const links = await getAuthoritativeVerifiedContactLinks(businessIds);
  const linksByBusiness = new Map<number, AuthoritativeContactBusinessLink[]>();
  for (const link of links) {
    const current = linksByBusiness.get(link.businessId) ?? [];
    current.push(link);
    linksByBusiness.set(link.businessId, current);
  }

  const result = new Map<
    number,
    {
      hasVerifiedContact: boolean;
      hasVerifiedNamedDecisionMaker: boolean;
      verifiedLinks: AuthoritativeContactBusinessLink[];
      skipReason: string | null;
    }
  >();
  for (const businessId of businessIds) {
    const verifiedLinks = linksByBusiness.get(businessId) ?? [];
    const verifiedContact = verifiedLinks.find((link) => Boolean(link.contactEmail));
    const verifiedNamedDecisionMaker = verifiedLinks.find(
      (link) => Boolean(link.contactName && link.contactTitle),
    );
    const satisfiedLink = verifiedNamedDecisionMaker ?? verifiedContact;
    result.set(businessId, {
      hasVerifiedContact: Boolean(verifiedContact),
      hasVerifiedNamedDecisionMaker: Boolean(verifiedNamedDecisionMaker),
      verifiedLinks,
      skipReason: satisfiedLink
        ? `verified_contact_reuse:decisionId=${satisfiedLink.decisionId}`
        : null,
    });
  }
  return result;
}

export interface ComputeSfpGapVectorInput {
  businessId: number;
  evidenceRefs?: Partial<Record<SfpGapDimension, string | null>>;
  geographyResolved?: boolean;
  targetVerticalResolved: boolean;
  officialDomainKnown: boolean;
  businessIdentityResolved?: boolean;
  hasFreeDiscoveryContactCandidate: boolean;
  hasPaidContactCandidate?: boolean;
  hasPaidNamedDecisionMaker?: boolean;
  verifiedLinkReuse: {
    hasVerifiedContact: boolean;
    hasVerifiedNamedDecisionMaker: boolean;
  };
  subjectSuppressions: Array<{
    subjectHash: string;
    authority: string;
    reasonCode: string;
    channel: string;
    scope: "contact" | "email" | "business";
  }>;
  businessWideSuppressionApplied: boolean;
  apolloSkipReason?: string | null;
  outscraperSkipReason?: string | null;
}

export async function computeSfpGapVector(
  input: ComputeSfpGapVectorInput,
): Promise<SfpBusinessGapVector> {
  const exclusionsFor = (dimension: "business_contact_channel" | "named_decision_maker") =>
    input.subjectSuppressions
      .filter((suppression) => {
        if (suppression.scope === "business") return false;
        if (dimension === "business_contact_channel") {
          return suppression.channel === "email" || suppression.channel === "all";
        }
        return suppression.scope === "contact";
      })
      .map(({ subjectHash, authority, reasonCode, channel }) => ({
        subjectHash,
        authority,
        reasonCode,
        channel,
      }));

  const before: SfpGapVectorEntry[] = [
    {
      dimension: "geography",
      open: input.geographyResolved !== true,
      closedBy: input.geographyResolved === true ? "cohort_freeze_geography_resolution" : null,
      evidenceRef: input.evidenceRefs?.geography ?? null,
      subjectExclusions: [],
    },
    {
      dimension: "target_vertical",
      open: !input.targetVerticalResolved,
      closedBy: input.targetVerticalResolved ? "target_vertical_resolved" : null,
      evidenceRef: input.evidenceRefs?.target_vertical ?? null,
      subjectExclusions: [],
    },
    {
      dimension: "official_domain",
      open: !input.officialDomainKnown,
      closedBy: input.officialDomainKnown ? "official_domain_known" : null,
      evidenceRef: input.evidenceRefs?.official_domain ?? null,
      subjectExclusions: [],
    },
    {
      dimension: "business_identity",
      open: input.businessIdentityResolved !== true,
      closedBy: input.businessIdentityResolved === true ? "business_identity_resolved" : null,
      evidenceRef: input.evidenceRefs?.business_identity ?? null,
      subjectExclusions: [],
    },
    {
      dimension: "business_contact_channel",
      open: !(input.hasFreeDiscoveryContactCandidate || input.hasPaidContactCandidate || input.verifiedLinkReuse.hasVerifiedContact),
      closedBy: input.hasFreeDiscoveryContactCandidate
        ? "free_discovery_contact_candidate"
        : input.hasPaidContactCandidate
          ? "paid_candidate_evidence"
        : input.verifiedLinkReuse.hasVerifiedContact
          ? "verified_contact_reuse"
          : null,
      evidenceRef: input.evidenceRefs?.business_contact_channel ?? null,
      subjectExclusions: exclusionsFor("business_contact_channel"),
    },
    {
      dimension: "named_decision_maker",
      open: !(input.hasPaidNamedDecisionMaker || input.verifiedLinkReuse.hasVerifiedNamedDecisionMaker),
      closedBy: input.verifiedLinkReuse.hasVerifiedNamedDecisionMaker
        ? "verified_named_decision_maker_reuse"
        : input.hasPaidNamedDecisionMaker
          ? "paid_named_decision_maker_evidence"
        : null,
      evidenceRef: input.evidenceRefs?.named_decision_maker ?? null,
      subjectExclusions: exclusionsFor("named_decision_maker"),
    },
  ];

  if (input.businessWideSuppressionApplied) {
    for (const entry of before) {
      if (entry.dimension === "geography") continue;
      entry.open = false;
      entry.closedBy = "business_wide_suppression_authoritative";
    }
  }

  const skippedProviderCalls: Array<{ provider: string; reason: string }> = [];
  if (input.verifiedLinkReuse.hasVerifiedNamedDecisionMaker && input.apolloSkipReason) {
    skippedProviderCalls.push({ provider: "apollo", reason: input.apolloSkipReason });
  }
  if (input.outscraperSkipReason) {
    skippedProviderCalls.push({ provider: "outscraper", reason: input.outscraperSkipReason });
  }

  return {
    businessId: input.businessId,
    before,
    after: before.map((entry) => ({
      ...entry,
      subjectExclusions: entry.subjectExclusions.map((exclusion) => ({ ...exclusion })),
    })),
    skippedProviderCalls,
  };
}

export function stopConditionsMet(vector: SfpBusinessGapVector): {
  allClosed: boolean;
  openDimensions: SfpGapDimension[];
} {
  const openDimensions = vector.after
    .filter((entry) => entry.open)
    .map((entry) => entry.dimension);
  return { allClosed: openDimensions.length === 0, openDimensions };
}
