import OpenAI from "openai";
import { createHash } from "node:crypto";
import { assertProviderActivation } from "../provider-manifest";
import { serperGateway, type SerperEndpoint } from "../serper-gateway";
import { executeApolloForCro03c, type ApolloFrozenOrganizationIdentity } from "../sdr/apollo";
import {
  executeCro03cOutscraper, type Cro03cFrozenOutscraperQuery,
} from "../sdr/outscraper";
import { processValidationIntent } from "../provider-readiness-control";
import { hashCro03Evidence } from "./source-staging";
import {
  assertCro03cAuthorityBeforeIo,
  assertCro03cLiveContext,
  type Cro03cLiveProviderContext,
} from "./live-execution";
import {
  createCro03cDomainRequestLimiter,
  createCro03cLiveSafeEgress,
  type Cro03cLiveCrawlRequest,
} from "./live-safe-egress";
import type { DurableEgressLimiter, EgressTransport } from "./safe-egress";

/**
 * This module is intentionally a small capability boundary.  In particular it
 * does not accept Cro03WorkerProviderContext (or any of the old batch input
 * shapes).  Callers must construct and freeze the input from their durable
 * stage plan before crossing this boundary.
 */
const CALLER = "server/services/cro03/live-provider-executors.ts";
const SHA256 = /^[0-9a-f]{64}$/i;
/**
 * These registries are deliberately empty until a reviewed CRO03C release
 * supplies a versioned model and prompt bundle. Environment values and a
 * frozen stage document are not an authority to add a model or instruction.
 */
const APPROVED_CRO03C_OPENAI_MODEL_HASHES = new Set<string>();
const APPROVED_CRO03C_OPENAI_SYSTEM_PROMPT_HASHES = new Set<string>();
const APPROVED_CRO03C_OPENAI_PROMPT_HASHES = new Set<string>();

export type Cro03cLiveProviderOutcome =
  | "success"
  | "no_result"
  | "blocked"
  | "failed"
  | "ambiguous";

export interface Cro03cLiveProviderResult {
  provider: Cro03cLiveProviderContext["provider"];
  outcome: Cro03cLiveProviderOutcome;
  settledUnits: number;
  settledAmountMicros: number;
  providerReference?: string;
  evidenceHash: string;
  /** Safe to store in cro03c_receipts.redacted_metadata; never response text. */
  redactedMetadata: Record<string, unknown>;
}

interface PricedInput {
  /** Amount in micros for one contract unit, from the approved activation schedule. */
  readonly amountMicros: number;
  /** The reservation made by the stage planner; executors never reserve. */
  readonly reservedUnits: number;
}

export interface Cro03cInternalSourceInput extends PricedInput {
  readonly provider: "internal_source";
  readonly evidence: Readonly<Record<string, unknown>>;
}
/** RDAP and JSON-LD are evidence parsers in the initial zero-cost path. */
export interface Cro03cZeroCostEvidenceInput extends PricedInput {
  readonly provider: "rdap" | "jsonld";
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface Cro03cSerperInput extends PricedInput {
  readonly provider: "serper";
  readonly endpoint: SerperEndpoint;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface Cro03cApolloInput extends PricedInput {
  readonly provider: "apollo";
  readonly identity: Readonly<ApolloFrozenOrganizationIdentity>;
}

export interface Cro03cOpenAiInput extends PricedInput {
  readonly provider: "openai";
  readonly model: string;
  readonly modelHash: string;
  readonly system: string;
  readonly systemPromptHash: string;
  readonly prompt: string;
  readonly promptHash: string;
  readonly maxCompletionTokens: number;
}

export interface Cro03cZeroBounceInput extends PricedInput {
  readonly provider: "zerobounce";
  /** A previously authorized cro03_winning_email validation intent. */
  readonly intentId: string;
}

export interface Cro03cOutscraperInput extends Cro03cFrozenOutscraperQuery {}

/**
 * The existing Outscraper client only accepts the deprecated batch worker
 * authority, and first-party crawling requires a non-serializable durable
 * egress limiter capability.  Neither is safe to reconstruct from an input
 * document.  Keeping these variants explicit prevents an accidental fallback
 * to raw fetch or a legacy batch context.
 */
export interface Cro03cFirstPartyWebInput extends PricedInput {
  readonly provider: "first_party_web";
  readonly crawl: Cro03cLiveCrawlRequest;
}

export interface Cro03cUnsupportedLiveInput extends PricedInput {
  readonly provider: never;
}

export type Cro03cFrozenLiveProviderInput =
  | Cro03cInternalSourceInput
  | Cro03cZeroCostEvidenceInput
  | Cro03cSerperInput
  | Cro03cApolloInput
  | Cro03cOpenAiInput
  | Cro03cZeroBounceInput
  | Cro03cOutscraperInput
  | Cro03cFirstPartyWebInput
  | Cro03cUnsupportedLiveInput;

/** Injection is intentionally limited to the already DNS-pinned transport
 * boundary. It makes deterministic tests possible without admitting fetch. */
export interface Cro03cLiveProviderExecutorDependencies {
  readonly pinnedTransportFactory?: () => EgressTransport;
  readonly egressLimiter?: DurableEgressLimiter;
  readonly lookup?: (hostname: string) => Promise<readonly string[]>;
  /** Durable worker checkpoint written immediately before the first possible
   * provider transport invocation. */
  readonly beforeTransportInvocation?: () => Promise<void>;
}

function isFrozenTree(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== "object") return true;
  if (seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Object.values(value as Record<string, unknown>).every((child) => isFrozenTree(child, seen));
}

function assertPricedInput(input: PricedInput): void {
  if (!Number.isInteger(input.amountMicros) || input.amountMicros < 0 ||
      !Number.isInteger(input.reservedUnits) || input.reservedUnits < 0) {
    throw new Error("CRO03C_PRICE_SCHEDULE_UNKNOWN");
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Verifies both content-addressing and the release-reviewed allowlists before
 * an LLM request can be constructed. This prevents a stage input from using a
 * raw system instruction as its own authority.
 */
export function assertCro03cOpenAiInputApproved(input: Cro03cOpenAiInput): void {
  if (!input.model || !input.system || !input.prompt ||
      !Number.isInteger(input.maxCompletionTokens) || input.maxCompletionTokens < 1 ||
      !SHA256.test(input.modelHash) || !SHA256.test(input.systemPromptHash) ||
      !SHA256.test(input.promptHash)) {
    throw new Error("CRO03C_PROVIDER_INPUT_UNSUPPORTED");
  }
  if (sha256(input.model) !== input.modelHash.toLowerCase() ||
      sha256(input.system) !== input.systemPromptHash.toLowerCase() ||
      sha256(input.prompt) !== input.promptHash.toLowerCase()) {
    throw new Error("CRO03C_OPENAI_HASH_MISMATCH");
  }
  if (!APPROVED_CRO03C_OPENAI_MODEL_HASHES.has(input.modelHash.toLowerCase()) ||
      !APPROVED_CRO03C_OPENAI_SYSTEM_PROMPT_HASHES.has(input.systemPromptHash.toLowerCase()) ||
      !APPROVED_CRO03C_OPENAI_PROMPT_HASHES.has(input.promptHash.toLowerCase())) {
    throw new Error("CRO03C_OPENAI_PROMPT_NOT_APPROVED");
  }
}

function redactedSerperMetadata(status: number | undefined): Record<string, unknown> {
  // Provider payloads can include contact and query data. Evidence is a
  // receipt only; no response body, error text, or request values cross it.
  return { responseReceived: true, status: status ?? null };
}

function result(
  context: Cro03cLiveProviderContext,
  input: PricedInput,
  outcome: Cro03cLiveProviderOutcome,
  settledUnits: number,
  evidence: unknown,
  providerReference?: string,
): Cro03cLiveProviderResult {
  if (!Number.isInteger(settledUnits) || settledUnits < 0 || settledUnits > input.reservedUnits) {
    throw new Error("CRO03C_SETTLEMENT_EXCEEDS_RESERVATION");
  }
  const settledAmountMicros = settledUnits * input.amountMicros;
  if (!Number.isSafeInteger(settledAmountMicros)) throw new Error("CRO03C_PRICE_SCHEDULE_UNKNOWN");
  return {
    provider: context.provider, outcome, settledUnits, settledAmountMicros, providerReference,
    evidenceHash: hashCro03Evidence({ provider: context.provider, outcome, providerReference, evidence }),
    redactedMetadata: { provider: context.provider, outcome, evidence },
  };
}

function assertProviderMatches(
  context: Cro03cLiveProviderContext,
  input: Cro03cFrozenLiveProviderInput,
): void {
  assertCro03cLiveContext(context);
  if (context.caller !== CALLER || context.provider !== input.provider) {
    throw new Error("CRO03C_PROVIDER_CONTEXT_DENIED");
  }
  if (!isFrozenTree(input)) throw new Error("CRO03C_INPUT_NOT_FROZEN");
  assertPricedInput(input);
}

/**
 * Dispatch one pre-reserved live stage operation.  This deliberately returns
 * a normalized, hashable result rather than settling a stage operation: the
 * durable stage worker owns settlement and can atomically record this result.
 * In particular, SerperGateway already claims its own billing-window budget;
 * this dispatcher must never make a second Serper reservation.
 */
export async function executeCro03cLiveProvider(
  context: Cro03cLiveProviderContext,
  input: Cro03cFrozenLiveProviderInput,
  dependencies: Cro03cLiveProviderExecutorDependencies = {},
): Promise<Cro03cLiveProviderResult> {
  assertProviderMatches(context, input);

  switch (input.provider) {
    case "internal_source":
      // No transport occurs, but use the same normalized receipt shape.
      return result(context, input, "success", 0, input.evidence);

    case "rdap":
    case "jsonld":
      // These internal paths consume only a previously frozen evidence
      // artifact. They deliberately do not turn an RDAP/JSON-LD stage into
      // arbitrary network fetch authority.
      return result(context, input, "no_result", 0, input.evidence);

    case "serper": {
      // SerperGateway is the sole approved transport and budget claimant.
      assertProviderActivation({
        sourceId: "serper", caller: CALLER, explicitPaidApproval: true,
      });
      await assertCro03cAuthorityBeforeIo(context);
      await dependencies.beforeTransportInvocation?.();
      const response = await serperGateway.executeSearch(input.endpoint, input.payload, CALLER);
      if (response.blocked) return result(context, input, "blocked", 0, {
        blocked: true,
      });
      if (!response.ok) return result(context, input, "failed", 0, {
        ...redactedSerperMetadata(response.status),
      });
      return result(context, input, "success", 1, redactedSerperMetadata(response.status));
    }

    case "apollo": {
      assertProviderActivation({
        sourceId: "apollo", caller: CALLER, explicitPaidApproval: true,
      });
      await assertCro03cAuthorityBeforeIo(context);
      await dependencies.beforeTransportInvocation?.();
      const response = await executeApolloForCro03c(
        context,
        input.identity,
        Math.min(input.reservedUnits, 100),
        (url, init) => fetch(url, init),
      );
      if (response.billing.certainty !== "exact") {
        return result(context, input, "ambiguous", 0, {
          billingCertainty: "unknown",
          providerReference: response.billing.providerReference ?? null,
        });
      }
      const creditedUnits = response.billing.creditedUnits;
      if (creditedUnits === undefined) {
        return result(context, input, "ambiguous", 0, { billingCertainty: "unknown" });
      }
      const evidence = response.outcome === "success"
        ? {
          // Receipt metadata is an operational audit surface, not enrichment
          // evidence. Apollo's organization/person fields include PII.
          organizationId: response.organizationId,
          organizationCount: 1,
          peopleCount: response.people.length,
          billing: { creditedUnits },
        }
        : {
          billing: { creditedUnits },
          providerReference: response.billing.providerReference ?? null,
        };
      return result(
        context,
        input,
        response.outcome === "success" ? "success" : response.outcome === "no_result" ? "no_result" : "ambiguous",
        creditedUnits,
        evidence,
        response.billing.providerReference,
      );
    }

    case "openai": {
      assertCro03cOpenAiInputApproved(input);
      assertProviderActivation({
        sourceId: "openai_classification", caller: CALLER, explicitPaidApproval: true,
      });
      const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
      const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
      if (!apiKey || !baseURL) throw new Error("CRO03C_PROVIDER_NOT_CONFIGURED");
      const client = new OpenAI({ apiKey, baseURL });
      await assertCro03cAuthorityBeforeIo(context);
      await dependencies.beforeTransportInvocation?.();
      const completion = await client.chat.completions.create({
        model: input.model,
        messages: [{ role: "system", content: input.system }, { role: "user", content: input.prompt }],
        max_completion_tokens: input.maxCompletionTokens,
      });
      const tokens = completion.usage?.total_tokens;
      if (typeof tokens !== "number" || !Number.isInteger(tokens) || tokens < 0) {
        throw new Error("CRO03C_PROVIDER_PRICING_UNVERIFIABLE");
      }
      return result(context, input, "success", tokens, {
        responseReceived: true,
        model: completion.model,
        usage: {
          promptTokens: completion.usage?.prompt_tokens ?? null,
          completionTokens: completion.usage?.completion_tokens ?? null,
          totalTokens: tokens,
        },
      });
    }

    case "zerobounce": {
      if (!input.intentId) throw new Error("CRO03C_PROVIDER_INPUT_UNSUPPORTED");
      assertProviderActivation({
        sourceId: "zerobounce", caller: CALLER, explicitPaidApproval: true,
      });
      await assertCro03cAuthorityBeforeIo(context);
      await dependencies.beforeTransportInvocation?.();
      const status = await processValidationIntent(input.intentId);
      if (status === "completed") return result(context, input, "success", 1, { status }, input.intentId);
      if (status === "deferred") return result(context, input, "blocked", 0, { status }, input.intentId);
      return result(context, input, status === "not_found" ? "failed" : "ambiguous", 0, { status }, input.intentId);
    }

    case "first_party_web": {
      await assertCro03cAuthorityBeforeIo(context);
      const egress = await createCro03cLiveSafeEgress({
        // The egress capability has its own narrow caller identity. Preserve
        // every signed/fenced authority field while crossing that boundary.
        context: { ...context, caller: "server/services/cro03/live-safe-egress.ts" },
        limiter: dependencies.egressLimiter ?? createCro03cDomainRequestLimiter(),
        lookup: dependencies.lookup,
        pinnedTransportFactory: dependencies.pinnedTransportFactory,
        beforeTransportInvocation: dependencies.beforeTransportInvocation,
      }, input.crawl.operationId);
      const pages = await egress.crawl(input.crawl);
      const settledUnits = pages.length;
      const outcome: Cro03cLiveProviderOutcome = pages.some((page) => page.status >= 200 && page.status < 400)
        ? "success" : "no_result";
      return result(context, input, outcome, settledUnits, {
        crawl: pages.map((page) => ({
          urlHash: sha256(page.url),
          status: page.status,
          contentType: page.contentType,
          bytes: page.bytes,
          bodyHash: sha256(page.body),
        })),
      });
    }

    case "outscraper": {
      assertProviderActivation({
        sourceId: "outscraper", caller: CALLER, explicitPaidApproval: true,
      });
      await assertCro03cAuthorityBeforeIo(context);
      await dependencies.beforeTransportInvocation?.();
      const execution = await executeCro03cOutscraper(context, input);
      return result(context, input, execution.outcome, execution.settledUnits, execution.evidence);
    }
  }
}
