import { assertProviderActivation } from "../provider-manifest";
import {
  performApolloBusinessEmailEnrichment, performApolloSearch, type ApolloRequestDispatch,
  type ApolloRedactedBusiness,
} from "../sdr/apollo";
import type { ApolloEmployerScope } from "../sdr/sfp-provider-contracts";
import {
  performOutscraperSearch, type OutscraperProviderTask, type OutscraperSearchResult,
} from "../sdr/outscraper";
import {
  performOpenAiClassification, type OpenAiClassificationInput, type OpenAiClassificationResult,
} from "./live-provider-executors";

const CALLER = "server/services/cro03/sfp-live-provider-adapters.ts";

export type SfpApolloDiscoveryResult =
  | {
    outcome: "success";
    organizationId: string;
    organization: ApolloRedactedBusiness;
    people: Array<ApolloRedactedBusiness & {
      personOperationId: string | null;
      emailEnrichmentOperationId: string | null;
    }>;
    personIds: string[];
    organizationOperationId: string | null;
    personOperationIds: readonly (string | null)[];
    emailEnrichmentOperationId: string | null;
    requestOperationIds: readonly string[];
  }
  | { outcome: "no_result" | "ambiguous"; requestOperationIds: readonly string[] };

export interface SfpApolloDiscoveryInput {
  businessId: number;
  businessName: string;
  domain?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  dbaName?: string | null;
  resultCap?: number;
}

export interface SfpProviderRequestCheckpoint {
  beforeRequest?: () => Promise<void>;
  dispatchApolloRequest?: ApolloRequestDispatch;
  recordCreditSignal?: (input: { httpStatus: number; message?: string | null; failure: boolean }) => Promise<void>;
  onTaskSubmitted?: (task: OutscraperProviderTask) => Promise<void>;
}

export async function executeSfpApolloDiscovery(
  input: SfpApolloDiscoveryInput,
  deps: { fetchImpl?: typeof fetch } & SfpProviderRequestCheckpoint = {},
): Promise<SfpApolloDiscoveryResult> {
  assertProviderActivation({ sourceId: "apollo", caller: CALLER, explicitPaidApproval: true });
  const search = await performApolloSearch({
    legalName: input.businessName,
    domain: input.domain,
    city: input.city,
    state: input.state,
    address: input.address,
    dbaName: input.dbaName,
    resultCap: input.resultCap,
  }, { ...deps, dispatchRequest: deps.dispatchApolloRequest });
  if (search.outcome !== "success") {
    return {
      outcome: search.outcome,
      requestOperationIds: search.requestOperationIds ?? [],
    };
  }
  if (search.personIds.length === 0) {
    return {
      outcome: "no_result",
      requestOperationIds: search.requestOperationIds ?? [],
    };
  }

  const employerScope: ApolloEmployerScope = {
    organizationId: search.organizationId,
    names: [search.organization.name].filter(Boolean),
    domains: search.organization.website ? [search.organization.website] : [],
  };
  const enrichment = await performApolloBusinessEmailEnrichment(
    search.personIds.slice(0, 10),
    { ...deps, dispatchRequest: deps.dispatchApolloRequest },
    employerScope,
  );
  const enrichedById = new Map(enrichment.people.map((person) => [person.personId, person.email]));
  const people = search.people.map((person, index) => {
    const personId = search.personIds[index];
    const email = enrichedById.get(personId) ?? null;
    return {
      ...person,
      email,
      ownerEmail: email,
      personOperationId: search.personOperationIds?.[index] ?? null,
      emailEnrichmentOperationId: enrichment.requestOperationId ?? null,
    };
  });
  return {
    outcome: "success",
    organizationId: search.organizationId,
    organization: search.organization,
    people,
    personIds: search.personIds,
    organizationOperationId: search.organizationOperationId ?? null,
    personOperationIds: search.personOperationIds ?? [],
    emailEnrichmentOperationId: enrichment.requestOperationId ?? null,
    requestOperationIds: [...new Set([
      ...(search.requestOperationIds ?? []),
      ...(enrichment.requestOperationIds ?? []),
    ])],
  };
}

export interface SfpOutscraperDiscoveryInput {
  businessId: number;
  businessName: string;
  domain?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  resultLimit?: number;
  region?: string;
  async?: boolean;
}

export async function executeSfpOutscraperDiscovery(
  input: SfpOutscraperDiscoveryInput,
  deps: { fetchImpl?: typeof fetch } & SfpProviderRequestCheckpoint = {},
): Promise<OutscraperSearchResult> {
  assertProviderActivation({ sourceId: "outscraper", caller: CALLER, explicitPaidApproval: true });
  return performOutscraperSearch(input, deps);
}

export interface SfpOpenAiClassificationInput {
  businessId: number;
  model: string;
  system: string;
  text: string;
  maxCompletionTokens: number;
  schema?: OpenAiClassificationInput["schema"];
  // Must match the shape of `schema` above -- see the doc comment on
  // OpenAiClassificationInput.validate for why a mismatched/missing
  // validator here silently rejects every real, correctly-shaped
  // completion as invalid_output.
  validate?: OpenAiClassificationInput["validate"];
}

export async function executeSfpOpenAiClassification(
  input: SfpOpenAiClassificationInput,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<OpenAiClassificationResult> {
  assertProviderActivation({
    sourceId: "openai_classification", caller: CALLER, explicitPaidApproval: true,
  });
  return performOpenAiClassification({
    model: input.model,
    system: input.system,
    prompt: input.text,
    maxCompletionTokens: input.maxCompletionTokens,
    schema: input.schema,
    validate: input.validate,
  }, deps);
}