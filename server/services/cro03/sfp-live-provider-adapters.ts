import { assertProviderActivation } from "../provider-manifest";
import {
  performApolloSearch, type ApolloSearchResult,
} from "../sdr/apollo";
import {
  performOutscraperSearch, type OutscraperSearchResult,
} from "../sdr/outscraper";
import {
  performOpenAiClassification, type OpenAiClassificationInput, type OpenAiClassificationResult,
} from "./live-provider-executors";

const CALLER = "server/services/cro03/sfp-live-provider-adapters.ts";

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

export async function executeSfpApolloDiscovery(
  input: SfpApolloDiscoveryInput,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<ApolloSearchResult> {
  assertProviderActivation({ sourceId: "apollo", caller: CALLER, explicitPaidApproval: true });
  return performApolloSearch({
    legalName: input.businessName,
    domain: input.domain,
    city: input.city,
    state: input.state,
    address: input.address,
    dbaName: input.dbaName,
    resultCap: input.resultCap,
  }, deps);
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
}

export async function executeSfpOutscraperDiscovery(
  input: SfpOutscraperDiscoveryInput,
  deps: { fetchImpl?: typeof fetch } = {},
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
  }, deps);
}