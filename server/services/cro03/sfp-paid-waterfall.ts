/** Bounded, ROI-ordered paid escalation for the South Florida program. */
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../../db";
import { getPaidProviderControls } from "../paid-provider-control";
import { lookupBusinessIdentity } from "../serper-business-identity";
import { runFreeEnrichmentLane } from "../free-enrichment-lane";
import {
  invokeSfpProviderTransport,
  currentSfpUnitPrice,
  reserveSfpProviderOperation,
  settleSfpProviderOperation,
} from "./sfp-provider-operations";
import { executeSfpApolloDiscovery, executeSfpOutscraperDiscovery } from "./sfp-live-provider-adapters";
import { writeSfpPaidCandidateEvidence } from "./sfp-paid-evidence-writer";
import {
  computeContactLinkReuse,
  computeSfpGapVector,
  hasResolvedBusinessIdentity,
  isResolvedSouthFloridaGeographyOutcome,
  stopConditionsMet,
} from "./sfp-contact-gap-vector";
import { candidateTier, rejectEmailCandidate } from "./candidate-selector";
import { getSfpCohortGapSnapshot } from "./sfp-cost-preview";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function canonicalDomain(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
      .hostname.replace(/^www\./i, "").toLowerCase() || null;
  } catch { return null; }
}

async function claimStageRun(stageRunId: string): Promise<string> {
  const claimed = rows(await db.execute(sql`
    UPDATE sfp_stage_runs
       SET state='running',claim_token=gen_random_uuid(),lease_expires_at=NOW()+INTERVAL '30 minutes',
           started_at=COALESCE(started_at,NOW()),last_heartbeat_at=NOW(),updated_at=NOW()
     WHERE id=${stageRunId}::uuid AND (
       state IN ('authorized','pending') OR (state='running' AND lease_expires_at<NOW())
     )
    RETURNING claim_token
  `))[0];
  if (!claimed) throw new Error("SFP_STAGE_ALREADY_RUNNING");
  return String(claimed.claim_token);
}

async function renewStageRunClaim(stageRunId: string, claimToken: string): Promise<void> {
  const renewed = rows(await db.execute(sql`
    UPDATE sfp_stage_runs SET lease_expires_at=NOW()+INTERVAL '30 minutes',last_heartbeat_at=NOW(),updated_at=NOW()
     WHERE id=${stageRunId}::uuid AND state='running' AND claim_token=${claimToken}::uuid
       AND lease_expires_at>NOW()
    RETURNING id
  `))[0];
  if (!renewed) throw new Error("SFP_STAGE_CLAIM_LOST");
}

async function buildCurrentGapVector(input: {
  cohortRunId: string;
  businessId: number;
  reuse: {
    hasVerifiedContact: boolean; hasVerifiedNamedDecisionMaker: boolean;
    verifiedLinks?: Array<{ decisionId: string | number; contactName?: string | null; contactTitle?: string | null }>;
  };
  apolloSkipReason?: string | null;
  outscraperSkipReason?: string | null;
}) {
  const decision = rows(await db.execute(sql`
    SELECT classifier_outcome,geography_outcome,geography_location_id,suppression_subjects,
           suppression_business_wide_rule_applied,classification_evidence_id
      FROM sfp_cohort_decisions
     WHERE cohort_run_id=${input.cohortRunId}::uuid AND business_id=${input.businessId}
     LIMIT 1
  `))[0];
  const business = rows(await db.execute(sql`
    SELECT website_domain,vertical,main_phone,street_address,city
      FROM businesses WHERE id=${input.businessId}
  `))[0];
  const free = rows(await db.execute(sql`
    SELECT id FROM free_discovery_candidates
     WHERE business_id=${input.businessId} AND field IN ('email','phone')
       AND disposition IN ('staged','validation_admitted','accepted')
     ORDER BY created_at DESC LIMIT 1
  `))[0];
  const paid = rows(await db.execute(sql`
    SELECT id FROM sfp_paid_candidate_evidence
     WHERE business_id=${input.businessId} AND field IN ('email','phone')
       AND disposition IN ('staged','accepted')
     ORDER BY created_at DESC LIMIT 1
  `))[0];
  const paidNamedDecisionMaker = rows(await db.execute(sql`
    SELECT id FROM sfp_paid_candidate_evidence
     WHERE business_id=${input.businessId} AND provider='apollo' AND subject_type='person'
       AND NULLIF(BTRIM(person_name_evidence),'') IS NOT NULL
       AND NULLIF(BTRIM(person_title_evidence),'') IS NOT NULL
       AND disposition IN ('staged','accepted')
     ORDER BY created_at DESC LIMIT 1
  `))[0];
  const contactRows = rows(await db.execute(sql`
    SELECT id,email,COALESCE(opted_out_email,FALSE) AS opted_out_email,
           unsubscribe_status,bounce_status
      FROM contacts WHERE business_id=${input.businessId}
       AND (COALESCE(opted_out_email,FALSE)=TRUE OR unsubscribe_status IN ('unsubscribed','complained')
            OR bounce_status IN ('hard','blocked'))
  `));
  const domainEvidence = rows(await db.execute(sql`
    SELECT id FROM sfp_paid_candidate_evidence
     WHERE business_id=${input.businessId} AND provider='serper' AND field='website_domain'
       AND disposition IN ('staged','accepted')
     ORDER BY created_at DESC LIMIT 1
  `))[0];
  let storedSuppressions: any[] = [];
  try {
    storedSuppressions = typeof decision?.suppression_subjects === "string"
      ? JSON.parse(decision.suppression_subjects) : decision?.suppression_subjects ?? [];
  } catch { storedSuppressions = []; }
  const subjectSuppressions = [
    ...storedSuppressions,
    ...contactRows.map((contact: any) => ({
      subjectHash: sha256(String(contact.email ?? contact.id).trim().toLowerCase()),
      authority: "canonical_contact_suppression_state",
      reasonCode: contact.bounce_status ? `bounce_${contact.bounce_status}` : String(contact.unsubscribe_status ?? "opted_out"),
      channel: "email",
      scope: "email" as const,
    })),
  ];
  const verifiedDecision = input.reuse.verifiedLinks?.find((verified) => verified.contactName && verified.contactTitle);
  return computeSfpGapVector({
    businessId: input.businessId,
    // Cohort membership itself is the persisted proof that the same resolver
    // accepted geography at freeze time; retain its actual outcome evidence.
    geographyResolved: isResolvedSouthFloridaGeographyOutcome(decision?.geography_outcome),
    targetVerticalResolved: ["resolved_high", "resolved_medium"].includes(String(decision?.classifier_outcome)),
    officialDomainKnown: Boolean(business?.website_domain),
    businessIdentityResolved: hasResolvedBusinessIdentity({
      mainPhone: business?.main_phone,
      streetAddress: business?.street_address,
      city: business?.city,
    }),
    hasFreeDiscoveryContactCandidate: Boolean(free),
    hasPaidContactCandidate: Boolean(paid),
    hasPaidNamedDecisionMaker: Boolean(paidNamedDecisionMaker),
    verifiedLinkReuse: input.reuse,
    subjectSuppressions,
    businessWideSuppressionApplied: Boolean(decision?.suppression_business_wide_rule_applied),
    evidenceRefs: {
      geography: decision?.geography_location_id == null ? null : `business_location:${decision.geography_location_id}`,
      target_vertical: decision?.classification_evidence_id ? `classification_evidence:${decision.classification_evidence_id}` : null,
      official_domain: domainEvidence?.id ? `paid_candidate_evidence:${domainEvidence.id}` : null,
      business_identity: hasResolvedBusinessIdentity({
        mainPhone: business?.main_phone,
        streetAddress: business?.street_address,
        city: business?.city,
      }) ? `business:${input.businessId}` : null,
      business_contact_channel: paid?.id ? `paid_candidate_evidence:${paid.id}` : free?.id ? `free_discovery_candidate:${free.id}` : null,
      named_decision_maker: verifiedDecision
        ? `decision:${verifiedDecision.decisionId}`
        : paidNamedDecisionMaker?.id
          ? `paid_candidate_evidence:${paidNamedDecisionMaker.id}`
          : null,
    },
    apolloSkipReason: input.apolloSkipReason,
    outscraperSkipReason: input.outscraperSkipReason,
  });
}

export async function previewSfpPaidWaterfall(cohortRunId: string) {
  const cohort = rows(await db.execute(sql`
    SELECT r.id,r.cohort_hash,r.cohort_state,r.voided_at,r.superseded_at,p.is_active
      FROM sfp_cohort_runs r JOIN sfp_programs p ON p.id=r.program_id
     WHERE r.id=${cohortRunId}::uuid
  `))[0];
  if (!cohort) throw new Error("SFP_COHORT_RUN_NOT_FOUND");
  if (cohort.cohort_state !== "frozen" || cohort.voided_at || cohort.superseded_at) {
    throw new Error(`SFP_COHORT_NOT_USABLE:state=${cohort.cohort_state}`);
  }
  const eligible = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM sfp_cohort_members m
     WHERE m.cohort_run_id=${cohortRunId}::uuid
       AND NOT EXISTS (SELECT 1 FROM free_discovery_candidates c
                        WHERE c.business_id=m.business_id AND c.disposition IN ('staged','validation_admitted'))
  `))[0];
  const controls = await getPaidProviderControls();
  const supported = new Set(["serper", "outscraper", "apollo"]);
  return {
    cohortRunId,
    programActive:Boolean(cohort.is_active),
    businessesNeedingPaidDiscovery:Number(eligible?.count ?? 0),
    providers: await Promise.all(controls.providers.map(async (p: any) => ({
      ...p,
      executableForSfp: supported.has(String(p.provider)),
      unitPriceMicros: supported.has(String(p.provider))
        ? await currentSfpUnitPrice(p.provider === "openai" ? "openai_classification" : p.provider as any).catch(() => null) : null,
      role: p.provider === "serper" ? "find/corroborate the official domain, then rerun the free first-party crawler"
        : p.provider === "zerobounce" ? "validation stage, not discovery"
        : p.provider === "openai" ? "classification only; never invents contact facts"
        : "not admitted to the independent SFP execution boundary",
    }))),
    waterfall:["serper","free_first_party_recrawl","outscraper","apollo"],
    note:"Outscraper/Apollo now execute through executeSfpPaidPersonAndIdentityDiscovery, extracted adapters admitted via provider-manifest.ts (Task #1999 C5) — not the CRO-03C generation/handoff pipeline. OpenAI remains classification-only, used by the pre-cohort bridge, never invoked from this waterfall.",
  };
}

/**
 * Task #1999 (C6/C7/C11): typed-gap-driven Apollo (named decision-maker) and
 * Outscraper (business identity) escalation for a frozen cohort. Runs after
 * the Serper domain-discovery stage. Every reservation/settlement reuses
 * reserveSfpProviderOperation/settleSfpProviderOperation exactly like the
 * Serper stage above (same cohort/stage-run authority, same $50 cap), so
 * this never becomes a second, ungoverned paid-I/O path. A resolved gap
 * dimension stops ONLY that provider for that business — Apollo is skipped
 * only when a verified named decision-maker already exists (C4 reuse);
 * Outscraper is skipped only when the business already has a known domain.
 * Paid results are written to sfp_paid_candidate_evidence (C3) and linked
 * from sfp_stage_items.paidCandidateEvidenceId, never into
 * free_discovery_candidates/cro03c_candidate_evidence.
 */
export async function executeSfpPaidPersonAndIdentityDiscovery(
  input: {
    cohortRunId: string;
    idempotencyKey: string;
    actorId: string;
    maxBusinesses?: number;
    previewSnapshotHash?: string;
  },
  deps: { fetchImpl?: typeof fetch } = {},
) {
  const maxBusinesses = Math.max(1, Math.min(25, Number(input.maxBusinesses ?? 10)));
  if (!input.previewSnapshotHash) throw new Error("SFP_PREVIEW_REQUIRED");
  const currentPreview = await getSfpCohortGapSnapshot(input.cohortRunId);
  if (currentPreview.snapshotHash !== input.previewSnapshotHash) throw new Error("SFP_STALE_PREVIEW");
  const cohortHashRow = rows(await db.execute(sql`
    SELECT cohort_hash FROM sfp_cohort_runs WHERE id=${input.cohortRunId}::uuid
  `))[0];
  if (!cohortHashRow) throw new Error("SFP_COHORT_RUN_NOT_FOUND");
  const payloadHash = sha256({
    cohortRunId: input.cohortRunId, cohortHash: cohortHashRow.cohort_hash, maxBusinesses,
    providers: ["serper", "outscraper", "apollo"],
    order: ["serper", "free_first_party_recrawl", "outscraper", "apollo"],
    previewSnapshotHash: input.previewSnapshotHash ?? null,
  });
  const existing = rows(await db.execute(sql`
    SELECT * FROM sfp_stage_runs WHERE stage='paid_waterfall' AND idempotency_key=${input.idempotencyKey} LIMIT 1
  `))[0];
  if (existing?.payload_hash && String(existing.payload_hash) !== payloadHash) {
    throw new Error("SFP_IDEMPOTENCY_PAYLOAD_MISMATCH");
  }
  if (existing?.state === "completed") {
    return { stageRunId: String(existing.id), replayed: true, processed: Number(existing.processed_count), succeeded: Number(existing.succeeded_count), failed: Number(existing.failed_count) };
  }
  const stage = existing ?? rows(await db.execute(sql`
    INSERT INTO sfp_stage_runs(cohort_run_id,stage,idempotency_key,actor_id,state,max_items,provider_keys,payload_hash,preview_snapshot_hash,started_at,last_heartbeat_at)
    VALUES(${input.cohortRunId}::uuid,'paid_waterfall',${input.idempotencyKey},${input.actorId},'authorized',${maxBusinesses},'["serper","outscraper","apollo"]'::jsonb,${payloadHash},${input.previewSnapshotHash ?? null},NOW(),NOW())
    ON CONFLICT(stage,idempotency_key) DO UPDATE SET updated_at=NOW() RETURNING *
  `))[0];
  const stageClaimToken = await claimStageRun(String(stage.id));
  await executeSfpSerperDiscovery({
    cohortRunId: input.cohortRunId,
    idempotencyKey: `${input.idempotencyKey}:serper`,
    actorId: input.actorId,
    maxBusinesses,
    previewSnapshotHash: input.previewSnapshotHash,
    internalSkipPreviewCheck: true,
  });
  const targets = rows(await db.execute(sql`
    SELECT b.id,b.canonical_name,b.city,b.state,b.postal_code,b.street_address,b.website_domain,b.main_phone,m.roi_score
      FROM sfp_cohort_members m JOIN businesses b ON b.id=m.business_id
     WHERE m.cohort_run_id=${input.cohortRunId}::uuid
     ORDER BY m.roi_score DESC,b.id ASC LIMIT ${maxBusinesses}
  `));
  await db.execute(sql`UPDATE sfp_stage_runs SET selected_count=${targets.length},updated_at=NOW() WHERE id=${String(stage.id)}::uuid`);

  const businessIds = targets.map((t: any) => Number(t.id));
  const reuse = await computeContactLinkReuse(businessIds);
  let succeeded = 0, failed = 0, skipped = 0;
  const gapVectors: Array<Awaited<ReturnType<typeof computeSfpGapVector>>> = [];

  for (const target of targets) {
    await renewStageRunClaim(String(stage.id), stageClaimToken);
    const businessId = Number(target.id);
    const linkReuse = reuse.get(businessId) ?? { hasVerifiedContact: false, hasVerifiedNamedDecisionMaker: false, verifiedLinks: [], skipReason: null };
    const beforeVector = await buildCurrentGapVector({
      cohortRunId: input.cohortRunId, businessId, reuse: linkReuse,
    });
    const gapOpen = (dimension: string) => beforeVector.before.some((entry) => entry.dimension === dimension && entry.open);
    let apolloSkipReason: string | null = gapOpen("named_decision_maker") ? null : (linkReuse.skipReason ?? "named_decision_maker_gap_closed");
    let outscraperSkipReason: string | null = gapOpen("business_identity") ? null : "business_identity_gap_closed";

    // Outscraper follows Serper plus the canonical free recrawl, and only runs
    // while the business-identity dimension remains open.
    if (!outscraperSkipReason) {
      let reservation: Awaited<ReturnType<typeof reserveSfpProviderOperation>> | null = null;
      try {
        reservation = await reserveSfpProviderOperation({
          stageRunId: String(stage.id), cohortRunId: input.cohortRunId, businessId,
          provider: "outscraper", purpose: "sfp_business_identity_discovery",
          idempotencyKey: `${input.idempotencyKey}:outscraper:${businessId}`, actorId: input.actorId, units: 1,
        });
        if (reservation.replayed) {
          skipped++;
          outscraperSkipReason = "outscraper_already_completed";
        } else {
        const result = await invokeSfpProviderTransport(reservation, () =>
          executeSfpOutscraperDiscovery({
            businessId, businessName: String(target.canonical_name), domain: target.website_domain,
            city: target.city, state: target.state, resultLimit: 2,
          }, deps));
        const place = result.results?.[0];
        const candidateValues: Array<{ field: string; value: string }> = [];
        if (place) {
          for (const field of ["name", "phone", "email", "website", "address", "city", "state", "zip", "category"] as const) {
            const value = place[field];
            if (typeof value === "string" && value.trim() &&
                (field !== "email" || !rejectEmailCandidate(value, "business"))) candidateValues.push({ field, value: value.trim() });
          }
          for (const [field, value] of [["rating", place.rating], ["review_count", place.reviewCount], ["place_id", place.placeId]] as const) {
            if (value !== null && value !== undefined && String(value).trim()) candidateValues.push({ field, value: String(value) });
          }
        }
        if (candidateValues.length) {
          const domain = canonicalDomain(place?.website);
          const writes = await db.transaction(async (tx) => {
            const evidence = [];
            for (const item of candidateValues) {
              evidence.push(await writeSfpPaidCandidateEvidence({
                businessId, provider: "outscraper", field: item.field, value: item.value, subjectType: "business",
                providerOperationId: reservation!.operationId, confidence: 70,
                candidateMetadata: { source: "outscraper", placeId: place?.placeId ?? null },
              }, tx));
            }
            await tx.execute(sql`
              UPDATE businesses SET
                website_domain=COALESCE(website_domain,${domain}),
                main_phone=COALESCE(main_phone,${place?.phone ?? null}),
                street_address=COALESCE(street_address,${place?.address ?? null}),
                city=COALESCE(city,${place?.city ?? null}),
                state=COALESCE(state,${place?.state ?? null}),
                postal_code=COALESCE(postal_code,${place?.zip ?? null}),
                updated_at=NOW()
              WHERE id=${businessId}
            `);
            await settleSfpProviderOperation({
              reservation: reservation!, outcome: "completed", observation: "unknown", businessId,
            }, tx);
            await tx.execute(sql`
              UPDATE sfp_stage_items
                 SET paid_candidate_evidence_id=${writes[0].id}::uuid,outcome_code='candidate_found',updated_at=NOW()
               WHERE provider_operation_id=${reservation!.operationId}::uuid
            `);
            return evidence;
          });
          void writes;
          succeeded++;
        } else {
          await settleSfpProviderOperation({ reservation, outcome: "no_result", observation: "no_result", businessId });
          skipped++;
        }
        }
      } catch (error: any) {
        if (reservation) await settleSfpProviderOperation({ reservation, outcome: "failed", observation: "transport", businessId }).catch(() => {});
        failed++;
        outscraperSkipReason = `outscraper_failed:${String(error?.message ?? error).slice(0, 120)}`;
      }
    } else {
      skipped++;
    }

    if (!apolloSkipReason) {
      let reservation: Awaited<ReturnType<typeof reserveSfpProviderOperation>> | null = null;
      try {
        reservation = await reserveSfpProviderOperation({
          stageRunId: String(stage.id), cohortRunId: input.cohortRunId, businessId,
          provider: "apollo", purpose: "sfp_named_decision_maker_discovery",
          idempotencyKey: `${input.idempotencyKey}:apollo:${businessId}`, actorId: input.actorId, units: 1,
        });
        if (reservation.replayed) { skipped++; continue; }
        const result = await invokeSfpProviderTransport(reservation, () =>
          executeSfpApolloDiscovery({
            businessId, businessName: String(target.canonical_name), domain: target.website_domain,
            city: target.city, state: target.state, address: target.street_address,
          }, deps));
        const people = result.outcome === "success" ? [...result.people] : [];
        people.sort((a: any, b: any) => {
          const tierA = candidateTier({ subject_type: "person", stage_key: "apollo",
            apollo_match_confidence: "high", candidate_metadata: { ownerTitle: a.ownerTitle } });
          const tierB = candidateTier({ subject_type: "person", stage_key: "apollo",
            apollo_match_confidence: "high", candidate_metadata: { ownerTitle: b.ownerTitle } });
          return tierA - tierB || Number(Boolean(b.ownerEmail ?? b.email)) - Number(Boolean(a.ownerEmail ?? a.email));
        });
        const candidateValues: Array<{ field: string; value: string; subjectType: "person" | "business"; personName?: string | null; personTitle?: string | null }> = [];
        const org: any = result.outcome === "success" ? result.organization : null;
        if (org) {
          for (const [field, value] of [["phone", org.phone], ["email", org.email], ["website", org.website],
            ["address", org.address], ["city", org.city], ["state", org.state], ["zip", org.zip], ["category", org.category]] as const) {
            if (typeof value === "string" && value.trim() &&
                (field !== "email" || !rejectEmailCandidate(value, "business"))) {
              candidateValues.push({ field, value: value.trim(), subjectType: "business" });
            }
          }
        }
        for (const person of people as any[]) {
          const name = [person.ownerFirstName, person.ownerLastName].filter(Boolean).join(" ") || person.name || null;
          for (const [field, value] of [["email", person.ownerEmail ?? person.email], ["phone", person.ownerPhone ?? person.phone]] as const) {
            if (typeof value !== "string" || !value.trim()) continue;
            if (field === "email" && rejectEmailCandidate(value, "person")) continue;
            candidateValues.push({ field, value: value.trim(), subjectType: "person", personName: name, personTitle: person.ownerTitle ?? null });
          }
        }
        if (result.outcome === "success" && candidateValues.length) {
          const writes = await db.transaction(async (tx) => {
            const evidence = [];
            for (const item of candidateValues) {
              evidence.push(await writeSfpPaidCandidateEvidence({
                businessId, provider: "apollo", field: item.field, value: item.value, subjectType: item.subjectType,
                providerOperationId: reservation!.operationId, confidence: 75,
                personNameEvidence: item.personName ?? null, personTitleEvidence: item.personTitle ?? null,
                candidateMetadata: item.subjectType === "person"
                  ? { apolloMatchConfidence: "high", ownerTitle: item.personTitle ?? null }
                  : { source: "apollo", organizationId: result.outcome === "success" ? result.organizationId : null },
              }, tx));
            }
            await tx.execute(sql`
              UPDATE businesses SET
                website_domain=COALESCE(website_domain,${canonicalDomain(org?.website)}),
                main_phone=COALESCE(main_phone,${org?.phone ?? null}),
                street_address=COALESCE(street_address,${org?.address ?? null}),
                city=COALESCE(city,${org?.city ?? null}),
                state=COALESCE(state,${org?.state ?? null}),
                postal_code=COALESCE(postal_code,${org?.zip ?? null}),
                updated_at=NOW()
              WHERE id=${businessId}
            `);
            await settleSfpProviderOperation({ reservation: reservation!, outcome: "completed", observation: "unknown", businessId }, tx);
            const emailReferenceIndex = candidateValues.findIndex((value) => value.field === "email");
            await tx.execute(sql`
              UPDATE sfp_stage_items
                 SET paid_candidate_evidence_id=${writes[emailReferenceIndex >= 0 ? emailReferenceIndex : 0].id}::uuid,
                     outcome_code='candidate_found',updated_at=NOW()
               WHERE provider_operation_id=${reservation!.operationId}::uuid
            `);
            return evidence;
          });
          void writes;
          succeeded++;
        } else {
          await settleSfpProviderOperation({ reservation, outcome: "no_result", observation: "no_result", businessId });
          skipped++;
        }
      } catch (error: any) {
        if (reservation) await settleSfpProviderOperation({ reservation, outcome: "failed", observation: "transport", businessId }).catch(() => {});
        failed++;
        apolloSkipReason = `apollo_failed:${String(error?.message ?? error).slice(0, 120)}`;
      }
    } else {
      skipped++;
    }

    const afterVector = await buildCurrentGapVector({
      cohortRunId: input.cohortRunId, businessId, reuse: linkReuse,
      apolloSkipReason, outscraperSkipReason,
    });
    const completeVector = { ...afterVector, before: beforeVector.before };
    gapVectors.push(completeVector);
    await db.execute(sql`
      INSERT INTO sfp_stage_items(stage_run_id,business_id,provider,state,outcome_code,gap_vector,redacted_result,completed_at)
      VALUES(${String(stage.id)}::uuid,${businessId},'gap_vector','completed','gap_vector_recorded',
             ${JSON.stringify(completeVector)}::jsonb,${JSON.stringify({ before: completeVector.before, after: completeVector.after })}::jsonb,NOW())
      ON CONFLICT(stage_run_id,business_id,provider) DO UPDATE
        SET gap_vector=EXCLUDED.gap_vector,redacted_result=EXCLUDED.redacted_result,updated_at=NOW()
    `);
  }

  await db.execute(sql`
    UPDATE sfp_stage_runs SET state=${failed ? "partial" : "completed"},claim_token=NULL,lease_expires_at=NULL,processed_count=${targets.length},
           succeeded_count=${succeeded},failed_count=${failed},skipped_count=${skipped},
           completed_at=NOW(),last_heartbeat_at=NOW(),updated_at=NOW()
     WHERE id=${String(stage.id)}::uuid AND claim_token=${stageClaimToken}::uuid
  `);
  return {
    stageRunId: String(stage.id), replayed: false, processed: targets.length, succeeded, failed, skipped,
    gapVectors: gapVectors.map((v) => ({
      businessId: v.businessId, before: v.before, after: v.after,
      stopConditions: stopConditionsMet(v), skippedProviderCalls: v.skippedProviderCalls,
    })),
    zeroOutreachConfirmed: true,
  };
}

export async function executeSfpSerperDiscovery(input: {
  cohortRunId:string;
  idempotencyKey:string;
  actorId:string;
  maxBusinesses?:number;
  previewSnapshotHash?:string;
  internalSkipPreviewCheck?:boolean;
}) {
  const maxBusinesses=Math.max(1,Math.min(25,Number(input.maxBusinesses ?? 10)));
  if (!input.internalSkipPreviewCheck) {
    if (!input.previewSnapshotHash) throw new Error("SFP_PREVIEW_REQUIRED");
    const currentPreview=await getSfpCohortGapSnapshot(input.cohortRunId);
    if(currentPreview.snapshotHash!==input.previewSnapshotHash) throw new Error("SFP_STALE_PREVIEW");
  }
  const cohortHashRow=rows(await db.execute(sql`SELECT cohort_hash FROM sfp_cohort_runs WHERE id=${input.cohortRunId}::uuid`))[0];
  if(!cohortHashRow) throw new Error("SFP_COHORT_RUN_NOT_FOUND");
  const payloadHash=sha256({cohortRunId:input.cohortRunId,cohortHash:cohortHashRow.cohort_hash,maxBusinesses,
    providers:["serper"],order:["serper","free_first_party_recrawl"],previewSnapshotHash:input.previewSnapshotHash ?? null});
  const existing=rows(await db.execute(sql`
    SELECT * FROM sfp_stage_runs WHERE stage='paid_waterfall' AND idempotency_key=${input.idempotencyKey} LIMIT 1
  `))[0];
  if(existing?.payload_hash && String(existing.payload_hash)!==payloadHash) throw new Error("SFP_IDEMPOTENCY_PAYLOAD_MISMATCH");
  if(existing?.state==='completed') return {stageRunId:String(existing.id),replayed:true,processed:Number(existing.processed_count),succeeded:Number(existing.succeeded_count),failed:Number(existing.failed_count)};
  const stage=existing ?? rows(await db.execute(sql`
     INSERT INTO sfp_stage_runs(cohort_run_id,stage,idempotency_key,actor_id,state,max_items,provider_keys,payload_hash,preview_snapshot_hash,started_at,last_heartbeat_at)
     VALUES(${input.cohortRunId}::uuid,'paid_waterfall',${input.idempotencyKey},${input.actorId},'authorized',${maxBusinesses},'["serper"]'::jsonb,${payloadHash},${input.previewSnapshotHash ?? null},NOW(),NOW())
    ON CONFLICT(stage,idempotency_key) DO UPDATE SET updated_at=NOW() RETURNING *
  `))[0];
   const stageClaimToken=await claimStageRun(String(stage.id));
  const targets=rows(await db.execute(sql`
    SELECT b.id,b.canonical_name,b.city,b.state,b.postal_code,b.street_address,b.website_domain,m.roi_score
      FROM sfp_cohort_members m JOIN businesses b ON b.id=m.business_id
     WHERE m.cohort_run_id=${input.cohortRunId}::uuid
       AND b.website_domain IS NULL
       AND NOT EXISTS (SELECT 1 FROM free_discovery_candidates c WHERE c.business_id=b.id AND c.disposition IN ('staged','validation_admitted'))
     ORDER BY m.roi_score DESC,b.id ASC LIMIT ${maxBusinesses}
  `));
  await db.execute(sql`UPDATE sfp_stage_runs SET selected_count=${targets.length},updated_at=NOW() WHERE id=${String(stage.id)}::uuid`);
  let succeeded=0,failed=0,noResult=0,freeRecrawlFailed=0;
  for(const target of targets){
     await renewStageRunClaim(String(stage.id),stageClaimToken);
    let reservation:Awaited<ReturnType<typeof reserveSfpProviderOperation>>|null=null;
    try{
      reservation=await reserveSfpProviderOperation({
        stageRunId:String(stage.id),cohortRunId:input.cohortRunId,businessId:Number(target.id),provider:"serper",
        purpose:"sfp_official_domain_discovery",idempotencyKey:`${input.idempotencyKey}:serper:${target.id}`,
        actorId:input.actorId,units:4,
      });
      if(reservation.replayed){ noResult++; continue; }
       const outcome=await invokeSfpProviderTransport(reservation,() => lookupBusinessIdentity({
         businessName:String(target.canonical_name),zip:target.postal_code,city:target.city,state:target.state,address:target.street_address,
       },{caller:"server/services/cro03/sfp-paid-waterfall.ts"}));
      if(outcome.kind==='accepted_match' && outcome.accepted){
        const acceptedIdentity = outcome.accepted;
        let domain:string|null=null;
        if(acceptedIdentity.website){
          try{domain=new URL(acceptedIdentity.website.startsWith('http')?acceptedIdentity.website:`https://${acceptedIdentity.website}`).hostname.replace(/^www\./,'').toLowerCase();}catch{domain=null;}
        }
        const identityCandidates = [
          ...(domain ? [{ field: "website_domain", value: domain }] : []),
          ...(acceptedIdentity.phone ? [{ field: "phone", value: acceptedIdentity.phone }] : []),
        ];
        await db.transaction(async (tx) => {
          const evidence = [];
          for (const candidate of identityCandidates) {
            evidence.push(await writeSfpPaidCandidateEvidence({
              businessId: Number(target.id), provider: "serper", field: candidate.field,
              value: candidate.value, subjectType: "business", providerOperationId: reservation!.operationId,
              confidence: 90, candidateMetadata: { acceptedIdentityMatch: true },
            }, tx));
          }
          await tx.execute(sql`
            UPDATE businesses SET website_domain=COALESCE(website_domain,${domain}),main_phone=COALESCE(main_phone,${acceptedIdentity.phone}),updated_at=NOW()
             WHERE id=${Number(target.id)}
          `);
          await settleSfpProviderOperation({
            reservation: reservation!,outcome:'completed',observation:'unknown',businessId:Number(target.id),
            settledUnits:outcome.requestsUsed,resultData:{domain,reasonCode:domain ? "SERPER_DOMAIN_DISCOVERED" : "SERPER_IDENTITY_MATCH_NO_DOMAIN"},
          },tx);
          if (evidence.length) {
            await tx.execute(sql`
              UPDATE sfp_stage_items SET paid_candidate_evidence_id=${evidence[0].id}::uuid,
                     outcome_code='candidate_found',updated_at=NOW()
               WHERE provider_operation_id=${reservation!.operationId}::uuid
            `);
          }
        });
        if(domain){
          // Domain discovery is a paid-stage success even if the subsequent
          // free crawl fails. The canonical free lane owns its own retry state.
          try { await runFreeEnrichmentLane([Number(target.id)]); }
          catch { freeRecrawlFailed++; }
          succeeded++;
        }else{
          noResult++;
        }
      }else{
        await settleSfpProviderOperation({
          reservation,outcome:'no_result',observation:'no_result',businessId:Number(target.id),
          settledUnits:outcome.requestsUsed,resultData:{domain:null,reasonCode:"SERPER_NO_RESULT"},
        });
        noResult++;
      }
    }catch(error:any){
      if(reservation) await settleSfpProviderOperation({reservation,outcome:'failed',observation:'transport',businessId:Number(target.id)}).catch(()=>{});
      failed++;
      await db.execute(sql`UPDATE sfp_stage_items SET state='failed',outcome_code=${String(error?.message ?? error).slice(0,180)},completed_at=NOW(),updated_at=NOW() WHERE stage_run_id=${String(stage.id)}::uuid AND business_id=${Number(target.id)} AND provider='serper'`).catch(()=>{});
    }
  }
  await db.execute(sql`
    UPDATE sfp_stage_runs SET state=${failed?"partial":"completed"},claim_token=NULL,lease_expires_at=NULL,processed_count=${targets.length},succeeded_count=${succeeded},
           failed_count=${failed},skipped_count=${noResult},completed_at=NOW(),last_heartbeat_at=NOW(),updated_at=NOW()
     WHERE id=${String(stage.id)}::uuid AND claim_token=${stageClaimToken}::uuid
  `);
  return {stageRunId:String(stage.id),replayed:false,processed:targets.length,succeeded,failed,noResult,freeRecrawlFailed,zeroOutreachConfirmed:true};
}
