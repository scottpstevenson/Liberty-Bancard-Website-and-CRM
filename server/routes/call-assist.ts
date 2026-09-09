import type { Express } from "express";
import OpenAI from "openai";
import { isDashboardUser } from "../replit_integrations/auth";
import { authorizeContactAccess } from "../services/crm-object-access";
import { featureFlags } from "../services/feature-flags";
import { evaluateContactability } from "../services/contactability";
import { retrieveChunks } from "../services/knowledge-base";
import { pool } from "../db";

const PHASES = ["pre_call", "objection", "follow_up", "statement_request"] as const;
type Phase = typeof PHASES[number];

export function registerCallAssistRoutes(app: Express) {
  app.post("/api/contacts/:id/call-assist", isDashboardUser, async (req, res) => {
    if (!featureFlags.CALL_ASSIST_ENABLED) return res.status(404).json({ error: "Not found" });
    const contactId = Number.parseInt(String(req.params.id), 10);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return res.status(400).json({ error: "Invalid contact ID" });
    }
    const role = (req.user as any)?.role;
    const contact = await authorizeContactAccess(req, res, contactId, { exactAssignment: role === "agent" });
    if (!contact) return;

    const phase = req.body?.phase as Phase;
    if (!PHASES.includes(phase)) return res.status(400).json({ error: "Invalid phase" });
    const category = typeof req.body?.objection_category === "string" ? req.body.objection_category.trim() : "";
    const note = typeof req.body?.note === "string" ? req.body.note : "";
    if (phase === "objection" && (!category || note.length > 500)) {
      return res.status(400).json({ error: "Objection category and note (max 500 characters) are required" });
    }

    const eligibility = await evaluateContactability({
      contactId, channel: "manual_call", mode: "dryRun",
      state: (contact as any).state ?? undefined,
    });
    if (!eligibility.ghlPermissionPayload.lb_manual_call_allowed) {
      await pool.query(
        `INSERT INTO call_assist_sessions (actor_user_id, contact_id, phase, status, reason_code)
         VALUES ($1,$2,$3,'blocked','CONTACT_NOT_ELIGIBLE')`,
        [String((req.user as any)?.id), contactId, phase],
      );
      return res.json({ available: false, reason: "CONTACT_NOT_ELIGIBLE" });
    }
    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      return res.json({ available: false, reason: "OPENAI_NOT_CONFIGURED" });
    }

    const prefix: Record<Phase, string> = {
      pre_call: "Pre-call prep",
      objection: `Objection: ${category}`,
      follow_up: "Follow-up",
      statement_request: "Statement request",
    };
    const context = [
      prefix[phase],
      `Business type: ${(contact as any).vertical ?? "unknown"}`,
      `Company: ${(contact as any).companyName ?? "unknown"}`,
    ].join(". ");
    const question = typeof req.body?.question === "string" && req.body.question.trim()
      ? req.body.question.trim() : context;
    const start = Date.now();
    try {
      const chunks = await retrieveChunks({ query: question, audience: "staff", topK: 5 });
      const knowledgeContext = chunks.map((chunk) => `[${chunk.title}]\n${chunk.content}`).join("\n\n");
      const prompt = `You are a sales call assistant. Give concise, accurate guidance for a representative.
Do not mention or infer private contact details. Use only the business context and staff knowledge below.
Business context: ${context}
Staff knowledge:
${knowledgeContext || "(No matching staff knowledge was found.)"}
Representative request: ${question}`;
      const client = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        ...(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ? { baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL } : {}),
      });
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: prompt }],
        max_tokens: 700,
      });
      const answer = completion.choices[0]?.message?.content?.trim() || "No guidance was generated.";
      const lowConfidence = chunks.length === 0;
      const latencyMs = Date.now() - start;
      const saved = await pool.query(
        `INSERT INTO call_assist_sessions
         (actor_user_id, contact_id, phase, status, reason_code, answer_truncated, answer_char_count,
          cited_revision_ids, confidence_score, low_confidence, latency_ms, prompt_tokens, completion_tokens,
          flagged_injection, flagged_pii)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [String((req.user as any)?.id), contactId, phase, lowConfidence ? "low_confidence" : "ok",
          null, answer.slice(0, 2000), answer.length, chunks.map((c) => c.revisionId).filter((id): id is number => id !== null),
          chunks.length ? chunks.reduce((sum, c) => sum + c.relevance, 0) / chunks.length : 0,
          lowConfidence, latencyMs, completion.usage?.prompt_tokens ?? null,
          completion.usage?.completion_tokens ?? null, false, false],
      );
      return res.json({
        available: true, answer,
        sources: chunks.map((c) => ({ title: c.title, revisionId: c.revisionId, relevance: c.relevance })),
        lowConfidence, sessionId: saved.rows[0].id, latencyMs,
      });
    } catch (error) {
      console.error("[CallAssist] Provider error:", error);
      return res.json({ available: false, reason: "PROVIDER_ERROR" });
    }
  });
}