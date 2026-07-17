import type { ProbeResult } from "./ghl-sync";

export async function probeAiAdvisor(): Promise<ProbeResult> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  if (!apiKey) {
    return {
      subsystem: "ai-advisor",
      status: "warn",
      summary: "OpenAI API key not configured — AI advisors, narrative synthesis, and enrichment disabled",
      details: { apiKeyConfigured: false },
    };
  }

  const isDummy = apiKey.includes("DUMMY") || apiKey.length < 30;
  if (isDummy) {
    return {
      subsystem: "ai-advisor",
      status: "warn",
      summary: "OpenAI API key appears to be a placeholder — AI features will fail at runtime",
      details: { apiKeyConfigured: true, isDummyKey: true },
    };
  }

  try {
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey });

    const start = Date.now();
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "ping" }],
      max_completion_tokens: 3,
    });
    const latencyMs = Date.now() - start;
    const valid = !!response.choices[0]?.message?.content;

    return {
      subsystem: "ai-advisor",
      status: valid ? "ok" : "warn",
      summary: valid
        ? `OpenAI API reachable (${latencyMs}ms round-trip)`
        : "OpenAI responded but returned empty content — quota may be exhausted",
      details: {
        apiKeyConfigured: true,
        isDummyKey: false,
        latencyMs,
        responseValid: valid,
        model: "gpt-4o-mini",
      },
    };
  } catch (err: any) {
    const is401 = err.status === 401 || err.message?.includes("401");
    const isQuota = err.message?.includes("quota") || err.message?.includes("429");
    return {
      subsystem: "ai-advisor",
      status: "error",
      summary: is401
        ? "OpenAI API key invalid or expired — all AI features non-functional"
        : isQuota
        ? "OpenAI quota exceeded — AI features will fail until quota resets"
        : `OpenAI API unreachable: ${err.message}`,
      details: { apiKeyConfigured: true, error: err.message, is401, isQuota },
    };
  }
}
