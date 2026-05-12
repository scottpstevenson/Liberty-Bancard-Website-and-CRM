import type { Express, RequestHandler } from "express";
import { isDashboardUser, isAuthenticated } from "../replit_integrations/auth";
import { logAiCall } from "../services/ai-audit-logger";
import { getTrainingHubStatus, createTrainingHub, appendGhlBlueprintsToDoc, syncGhlBlueprintsToMainDoc, LIBERTY_BANCARD_GHL_DOC_ID } from "../services/google-drive";
import { storage } from "../storage";
import { db } from "../db";
import { roleplaySessions, roleplayExchanges, users } from "@shared/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { createMasterVault, getVaultStatus } from "../services/business-vault";

// Admin or manager role required for write operations
const isAdminOrManager: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated()) {
    const role = (req.user as any)?.role;
    if (role === "admin" || role === "manager") {
      return next();
    }
  }
  return res.status(403).json({ message: "Admin or manager access required" });
};

export function registerTrainingRoutes(app: Express) {
  // Get training hub status — internal dashboard users only (admin, manager, agent)
  app.get("/api/training/status", isDashboardUser, async (req, res) => {
    try {
      const status = await getTrainingHubStatus();
      res.json(status);
    } catch (error: any) {
      console.error("Training hub status error:", error);
      res.status(500).json({ message: error.message || "Failed to get training hub status" });
    }
  });

  // Create / seed the training hub — admin or manager only
  app.post("/api/training/setup", isAdminOrManager, async (req, res) => {
    try {
      const result = await createTrainingHub();
      res.json(result);
    } catch (error: any) {
      console.error("Training hub setup error:", error);
      res.status(500).json({ message: error.message || "Failed to create training hub" });
    }
  });

  // Append GHL Workflow Node Blueprints to a Google Doc — admin or manager only
  app.post("/api/training/append-ghl-blueprints", isAdminOrManager, async (req, res) => {
    try {
      const { docId } = req.body;
      if (!docId) return res.status(400).json({ message: "docId is required" });
      const result = await appendGhlBlueprintsToDoc(docId);
      res.json(result);
    } catch (error: any) {
      console.error("Append GHL blueprints error:", error);
      res.status(500).json({ message: error.message || "Failed to append GHL blueprints to doc" });
    }
  });

  // Sync GHL Workflow Node Blueprints to the Liberty Bancard main GHL doc (hardcoded doc ID)
  // This is the explicit, auditable execution path for doc: 1qFNQoJboXVx6kGam2i1PG-ia-jWyPJZp7NEpMynOaoQ
  app.post("/api/training/sync-main-ghl-doc", isAdminOrManager, async (req, res) => {
    try {
      console.log(`[GHL Blueprints] Syncing to Liberty Bancard main doc: ${LIBERTY_BANCARD_GHL_DOC_ID}`);
      const result = await syncGhlBlueprintsToMainDoc();
      res.json({ ...result, docId: LIBERTY_BANCARD_GHL_DOC_ID });
    } catch (error: any) {
      console.error("Sync main GHL doc error:", error);
      res.status(500).json({ message: error.message || "Failed to sync GHL blueprints to main doc" });
    }
  });

  // === AI ROLEPLAY COACH ===

  // Scenario scripts grounded in Liberty Bancard's actual sequence playbooks:
  // - Cold Call: mirrors SDR Cold Outbound playbook (overpriced processing, hidden fees, statement review hook)
  // - Objection Handling: mirrors Objection Crusher sequence (rate concerns, contract lock-in, risk aversion)
  // - Statement Review Close: mirrors SDR Statement Chase sequence (savings analysis, 3 options, 24-hour review)
  // - Competitor Switch: mirrors Contract Escape sequence (auto-renewed contracts, ETF negotiation, equipment leases)
  // - 0% Program Pitch: mirrors Surcharge & Cash Discount Compliance sequence (legal signage, receipts, card brand rules)
  const SCENARIO_SCRIPTS: Record<string, string> = {
    "Cold Call": `You are a skeptical merchant receiving an unsolicited call from a payment processor rep at Liberty Bancard. You are busy, slightly irritated, and happy with your current processor. You've heard pitches like this before. The rep's opening needs to speak to real pain points: overpriced processing on high-ticket transactions, no text-to-pay or financing options, or hidden fees buried in monthly statements. Push back on pricing and credibility. Only open up if the rep offers something specific, like a free statement review showing a real savings number (typically $200-500/month). Ask why you should trust them over your current provider.`,
    "Objection Handling": `You are a merchant who has heard the Liberty Bancard pitch but has strong, realistic objections. Use these specific objections in sequence or as the rep triggers them:
1. "Your rates seem too good to be true — I've heard that before."
2. "I'm locked into a contract and I can't just switch."
3. "I don't want to risk disrupting my business."
When the rep explains how interchange works (Visa/Mastercard sets base rates, the markup is what varies), soften slightly on objection 1. When they explain contract terms (flexible month-to-month, no ETF surprises, no equipment leases), soften on objection 2. Only fully warm up if the rep gives specific, concrete answers to all objections. Stay realistic — don't cave easily.`,
    "Statement Review Close": `You are a merchant who has shared your processing statement with a Liberty Bancard rep. You are curious about the potential savings but quite skeptical. Ask probing questions: How exactly do you calculate the savings? Are the savings guaranteed? What fees are involved in switching? What are the 3 options they typically show? The rep should know that Liberty Bancard normally identifies 3 specific ways to reduce costs and can turn around a personalized analysis within 24 hours. Push back on vague answers. Only get excited if the rep can speak to your specific numbers.`,
    "Competitor Switch": `You are a merchant currently using Square or Stripe and you're pretty happy with the simplicity. You process about $30K/month. You believe you might be locked into your current agreement. The rep should know that many contracts have expired and auto-renewed to month-to-month — the merchant may not even be locked in anymore. Ask the rep to explain how they'd handle your contract situation. Also ask about early termination fees, equipment leases, and whether switching would be disruptive to your staff. You need a very clear, specific reason to switch — "better rates" is not enough on its own.`,
    "0% Program Pitch": `You are a restaurant owner curious about the 0% processing program (also called surcharge or cash discount) but worried about the details. You process $50K/month and have very tight margins. Ask pointed questions about: Is this actually legal? What signage is required? How will customers react? What happens if I implement it wrong — will I get fined by Visa or Mastercard? The rep should know that done correctly (with proper signage, receipts, and compliant messaging), this is legal and can eliminate your processing costs entirely. Push back if the rep is vague about compliance. Only warm up if they explain the proper implementation steps clearly.`,
  };

  const PERSONA_CONTEXTS: Record<string, string> = {
    "Auto Shop Owner": "You are the owner of a busy auto repair shop. You process about $40K/month, mostly credit cards. You're practical, no-nonsense, and don't like salespeople wasting your time.",
    "Dentist": "You run a dental practice processing about $80K/month. You are professional, busy, and cautious about anything that could affect patient experience or compliance.",
    "Restaurant Owner": "You own a mid-size restaurant doing $55K/month in card volume. You're tight on margins, deal with high staff turnover, and are always looking for ways to cut costs.",
    "Retail Store Owner": "You operate a retail boutique processing $25K/month. You care about customer experience and already get good service from your current processor.",
    "Home Services Contractor": "You run a plumbing and HVAC business processing $35K/month. Half your payments are in the field. You care about reliability and ease of use over everything.",
    "Medspa Owner": "You operate a medspa processing $90K/month. You are success-oriented, detail-focused, and interested in anything that improves your bottom line — but only with proof.",
  };

  const DIFFICULTY_MODIFIERS: Record<string, string> = {
    standard: "",
    hard: `

DIFFICULTY: HARD MODE — You are significantly more resistant than a typical merchant. Be skeptical of every claim, interrupt with sharper objections, demand specific numbers and proof, and reference past bad experiences with processors. Do not warm up unless the rep gives concrete, specific, well-supported answers. Penalize vague language. Even when softening, stay guarded. Do not convert easily — make the rep work hard for any concession. Tone scoring should be stricter: only reward genuinely empathetic, professional, and concrete language.`,
    expert: `

DIFFICULTY: EXPERT MODE — You are an extremely tough, sophisticated merchant who has been pitched dozens of times. You know interchange, effective rate math, ETF clauses, equipment lease traps, and surcharge compliance details. Challenge the rep on technical accuracy. Call out generic pitches. Express open frustration when answers are vague. Only consider switching if the rep demonstrates true expertise AND offers a specific, quantified benefit. Stay in character as nearly impossible to convert.`,
  };

  // Start a new roleplay session
  app.post("/api/training/roleplay/start", isDashboardUser, async (req, res) => {
    try {
      const { scenario, persona, difficulty } = req.body;
      if (!scenario || !persona) return res.status(400).json({ message: "scenario and persona required" });
      const validDifficulty = ["standard", "hard", "expert"].includes(difficulty) ? difficulty : "standard";
      const userId = (req.user as any)?.id;
      const [session] = await db.insert(roleplaySessions).values({
        userId,
        scenario,
        persona,
        difficulty: validDifficulty,
        status: "active",
      }).returning();
      res.json(session);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Submit a rep message and get merchant reply + scoring
  app.post("/api/training/roleplay/exchange", isDashboardUser, async (req, res) => {
    try {
      const { sessionId, repMessage, conversationHistory } = req.body;
      if (!sessionId || !repMessage) return res.status(400).json({ message: "sessionId and repMessage required" });

      const userId = (req.user as any)?.id;
      const [session] = await db.select().from(roleplaySessions).where(eq(roleplaySessions.id, Number(sessionId)));
      if (!session) return res.status(404).json({ message: "Session not found" });
      if (session.userId !== userId) return res.status(403).json({ message: "Not your session" });

      const scenarioScript = SCENARIO_SCRIPTS[session.scenario] || SCENARIO_SCRIPTS["Cold Call"];
      const personaContext = PERSONA_CONTEXTS[session.persona] || PERSONA_CONTEXTS["Restaurant Owner"];
      const difficultyModifier = DIFFICULTY_MODIFIERS[session.difficulty || "standard"] || "";

      const systemPrompt = `${scenarioScript}

PERSONA: ${personaContext}

SCENARIO: ${session.scenario}${difficultyModifier}

SCORING: After your merchant reply, on a new line, output a JSON block like this (ALWAYS include it):
SCORE_JSON: {"toneScore": 1-10, "clarityScore": 1-10, "objectionAddressed": true|false, "feedback": "one sentence coaching tip for the rep"}

Stay in character as the merchant. Be realistic, not a pushover. Don't make it too easy for the rep.`;

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const messages: any[] = [
        { role: "system", content: systemPrompt },
        ...(conversationHistory || []).map((m: any) => ({ role: m.role, content: m.content })),
        { role: "user", content: repMessage },
      ];

      const completion = await logAiCall(
        { triggerType: "training-generation", actorType: (req as any).user?.role || "agent", actorId: (req as any).user?.id?.toString() },
        () => openai.chat.completions.create({
          model: "gpt-4o",
          messages,
          max_tokens: 600,
        })
      );

      const raw = completion.choices[0]?.message?.content || "";

      // Parse SCORE_JSON from the response
      let merchantReply = raw;
      let scoreData = { toneScore: 7, clarityScore: 7, objectionAddressed: false, feedback: "" };

      const scoreMatch = raw.match(/SCORE_JSON:\s*(\{[\s\S]*?\})/);
      if (scoreMatch) {
        try {
          scoreData = JSON.parse(scoreMatch[1]);
          merchantReply = raw.replace(/SCORE_JSON:[\s\S]*$/, "").trim();
        } catch { /* use defaults */ }
      }

      // Save exchange to DB
      const [exchange] = await db.insert(roleplayExchanges).values({
        sessionId: Number(sessionId),
        repMessage,
        merchantReply,
        toneScore: scoreData.toneScore,
        clarityScore: scoreData.clarityScore,
        objectionAddressed: scoreData.objectionAddressed,
        feedback: scoreData.feedback,
      }).returning();

      // Update session exchange count
      await db.update(roleplaySessions)
        .set({ totalExchanges: (session.totalExchanges || 0) + 1 })
        .where(eq(roleplaySessions.id, session.id));

      res.json({
        merchantReply,
        exchange,
        score: scoreData,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // End session and get coaching summary
  app.post("/api/training/roleplay/end", isDashboardUser, async (req, res) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) return res.status(400).json({ message: "sessionId required" });

      const userId = (req.user as any)?.id;
      const [session] = await db.select().from(roleplaySessions).where(eq(roleplaySessions.id, Number(sessionId)));
      if (!session) return res.status(404).json({ message: "Session not found" });
      if (session.userId !== userId) return res.status(403).json({ message: "Not your session" });

      const exchanges = await db.select().from(roleplayExchanges)
        .where(eq(roleplayExchanges.sessionId, Number(sessionId)))
        .orderBy(roleplayExchanges.createdAt);

      if (exchanges.length === 0) {
        await db.update(roleplaySessions)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(roleplaySessions.id, session.id));
        return res.json({ summary: "No exchanges to analyze.", strengths: [], gaps: [], suggestedPhrasing: [], overallScore: 0 });
      }

      const avgTone = Math.round(exchanges.reduce((s, e) => s + (e.toneScore || 0), 0) / exchanges.length);
      const avgClarity = Math.round(exchanges.reduce((s, e) => s + (e.clarityScore || 0), 0) / exchanges.length);
      const overallScore = Math.round((avgTone + avgClarity) / 2);
      const objectionRate = Math.round((exchanges.filter(e => e.objectionAddressed).length / exchanges.length) * 100);

      const exchangeSummary = exchanges.map((e, i) =>
        `Turn ${i + 1}: Rep said: "${e.repMessage.slice(0, 120)}" | Tone: ${e.toneScore}/10 | Clarity: ${e.clarityScore}/10 | Objection addressed: ${e.objectionAddressed} | Coach note: ${e.feedback || "none"}`
      ).join("\n");

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const completion = await logAiCall(
        { triggerType: "training-generation", actorType: (req as any).user?.role || "agent", actorId: (req as any).user?.id?.toString() },
        () => openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `You are a Liberty Bancard sales coach. Analyze this roleplay session and provide a coaching summary.
Return valid JSON with:
- summary: 2-3 sentence overall assessment
- strengths: array of 2-3 specific strengths the rep demonstrated
- gaps: array of 2-3 areas to improve
- suggestedPhrasing: array of 2-3 specific phrases or lines the rep should use next time`,
            },
            {
              role: "user",
              content: `Scenario: ${session.scenario}\nPersona: ${session.persona}\nTotal turns: ${exchanges.length}\nAvg tone score: ${avgTone}/10\nAvg clarity score: ${avgClarity}/10\nObjection addressed rate: ${objectionRate}%\n\nExchange log:\n${exchangeSummary}`,
            },
          ],
          max_tokens: 600,
        })
      );

      const raw = completion.choices[0]?.message?.content || "";
      let coachingResult = { summary: raw, strengths: [] as string[], gaps: [] as string[], suggestedPhrasing: [] as string[] };
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { coachingResult = JSON.parse(jsonMatch[0]); } catch { /* use defaults */ }
      }

      await db.update(roleplaySessions).set({
        status: "completed",
        completedAt: new Date(),
        overallScore,
        coachingSummary: coachingResult.summary,
        strengths: coachingResult.strengths,
        gaps: coachingResult.gaps,
        suggestedPhrasing: coachingResult.suggestedPhrasing,
      }).where(eq(roleplaySessions.id, session.id));

      res.json({ ...coachingResult, overallScore, avgTone, avgClarity, objectionRate });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get session history for current user
  app.get("/api/training/roleplay/sessions", isDashboardUser, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      const sessions = await db.select().from(roleplaySessions)
        .where(eq(roleplaySessions.userId, userId))
        .orderBy(desc(roleplaySessions.createdAt))
        .limit(20);
      res.json(sessions);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get exchanges for a session (ownership enforced)
  app.get("/api/training/roleplay/sessions/:sessionId/exchanges", isDashboardUser, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      const [session] = await db.select().from(roleplaySessions).where(eq(roleplaySessions.id, Number(req.params.sessionId)));
      if (!session) return res.status(404).json({ message: "Session not found" });
      if (session.userId !== userId) return res.status(403).json({ message: "Not your session" });
      const exchanges = await db.select().from(roleplayExchanges)
        .where(eq(roleplayExchanges.sessionId, Number(req.params.sessionId)))
        .orderBy(roleplayExchanges.createdAt);
      res.json(exchanges);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === MANAGER COACHING DASHBOARD ===

  // Get all roleplay sessions across all users (admin/manager only)
  app.get("/api/training/roleplay/admin/sessions", isAdminOrManager, async (req, res) => {
    try {
      const rows = await db
        .select({
          id: roleplaySessions.id,
          userId: roleplaySessions.userId,
          scenario: roleplaySessions.scenario,
          persona: roleplaySessions.persona,
          status: roleplaySessions.status,
          totalExchanges: roleplaySessions.totalExchanges,
          overallScore: roleplaySessions.overallScore,
          coachingSummary: roleplaySessions.coachingSummary,
          strengths: roleplaySessions.strengths,
          gaps: roleplaySessions.gaps,
          suggestedPhrasing: roleplaySessions.suggestedPhrasing,
          createdAt: roleplaySessions.createdAt,
          completedAt: roleplaySessions.completedAt,
          userEmail: users.email,
          userFirstName: users.firstName,
          userLastName: users.lastName,
          userRole: users.role,
        })
        .from(roleplaySessions)
        .leftJoin(users, eq(roleplaySessions.userId, users.id))
        .orderBy(desc(roleplaySessions.createdAt))
        .limit(500);

      // Per-session avg tone/clarity from exchanges
      const sessionIds = rows.map(r => r.id);
      let exchangesBySession = new Map<number, { tone: number[]; clarity: number[] }>();
      if (sessionIds.length > 0) {
        const allEx = await db.select({
          sessionId: roleplayExchanges.sessionId,
          toneScore: roleplayExchanges.toneScore,
          clarityScore: roleplayExchanges.clarityScore,
        }).from(roleplayExchanges).where(inArray(roleplayExchanges.sessionId, sessionIds));
        for (const ex of allEx) {
          const bucket = exchangesBySession.get(ex.sessionId) || { tone: [], clarity: [] };
          if (ex.toneScore !== null) bucket.tone.push(ex.toneScore);
          if (ex.clarityScore !== null) bucket.clarity.push(ex.clarityScore);
          exchangesBySession.set(ex.sessionId, bucket);
        }
      }

      const sessions = rows.map(r => {
        const ex = exchangesBySession.get(r.id);
        const avg = (arr: number[]) => arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null;
        return {
          ...r,
          avgTone: ex ? avg(ex.tone) : null,
          avgClarity: ex ? avg(ex.clarity) : null,
        };
      });

      res.json(sessions);
    } catch (err: any) {
      console.error("Admin roleplay sessions error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Get exchanges for any session (admin/manager only)
  app.get("/api/training/roleplay/admin/sessions/:sessionId/exchanges", isAdminOrManager, async (req, res) => {
    try {
      const sessionId = Number(req.params.sessionId);
      const [session] = await db.select().from(roleplaySessions).where(eq(roleplaySessions.id, sessionId));
      if (!session) return res.status(404).json({ message: "Session not found" });
      const exchanges = await db.select().from(roleplayExchanges)
        .where(eq(roleplayExchanges.sessionId, sessionId))
        .orderBy(roleplayExchanges.createdAt);
      res.json(exchanges);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === MASTER BUSINESS VAULT ===

  // Master Business Vault — check status
  app.get("/api/vault/status", isDashboardUser, async (req, res) => {
    try {
      const status = await getVaultStatus();
      res.json(status);
    } catch (error: any) {
      console.error("Vault status error:", error);
      res.status(500).json({ message: error.message || "Failed to get vault status" });
    }
  });

  // Master Business Vault — create/build all folders and documents
  app.post("/api/vault/setup", isAdminOrManager, async (req, res) => {
    try {
      console.log("[Vault] Starting Master Business Vault creation...");
      const result = await createMasterVault();
      console.log(`[Vault] Completed: ${result.documentsCreated}/${result.totalDocuments} docs created`);
      res.json(result);
    } catch (error: any) {
      console.error("Vault setup error:", error);
      res.status(500).json({ message: error.message || "Failed to create Master Business Vault" });
    }
  });
}
