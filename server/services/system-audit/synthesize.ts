import type { ProbeResult } from "./probes/ghl-sync";

export async function synthesizeNarrative(probeResults: ProbeResult[]): Promise<string | null> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey });

    const pass = probeResults.filter(p => p.status === "ok").length;
    const warn = probeResults.filter(p => p.status === "warn").length;
    const fail = probeResults.filter(p => p.status === "error").length;
    const score = Math.round((pass / probeResults.length) * 100);

    const overallHealth = fail > 0 ? "CRITICAL" : warn > 0 ? "DEGRADED" : "HEALTHY";

    const statusEmoji = (s: ProbeResult["status"]) =>
      s === "ok" ? "✅" : s === "warn" ? "⚠️" : "❌";

    const probeText = probeResults
      .map(p => `${statusEmoji(p.status)} ${p.subsystem} (${p.status.toUpperCase()}): ${p.summary}`)
      .join("\n");

    const prompt = `You are a senior systems engineer reviewing the weekly automated health audit for Liberty Bancard's AI Business Operating System.

Audit Date: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
Overall Status: ${overallHealth} (${score}% passing — ${pass} OK, ${warn} warnings, ${fail} failures out of ${probeResults.length} probes)

Probe Results:
${probeText}

Write a concise, professional diagnostic narrative (180–250 words) with:
1. An overall health verdict and what is working well
2. The top 3 action items requiring operator attention this week (if any issues exist)
3. An overall health rating: Healthy / Degraded / Critical

Rules: plain business English, no markdown headers, no bullet points — flowing prose paragraphs only. Be direct and action-oriented.`;

    const { checkAiGate, recordAiSpend } = await import("../ai-audit-logger");
    const slot = await checkAiGate("gpt-4o");
    let response;
    try {
      response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 600,
        temperature: 0.3,
      });
    } catch (providerErr) {
      slot.refund();
      throw providerErr;
    }

    slot.settle(recordAiSpend("gpt-4o", response.usage?.prompt_tokens ?? 0, response.usage?.completion_tokens ?? 0, "system-health"));
    return response.choices[0]?.message?.content?.trim() ?? null;
  } catch (err: any) {
    console.error("[SystemAudit] Narrative synthesis failed:", err.message);
    return null;
  }
}
