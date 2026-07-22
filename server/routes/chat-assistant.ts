/**
 * Liberty Bancard AI Assistant — API Routes
 *
 * Public (no auth required): POST /api/assistant/chat, POST /api/assistant/feedback,
 *   GET/POST /api/assistant/session
 * Authenticated merchant/staff: same routes with richer context
 * Admin knowledge management: see knowledge-admin.ts
 *
 * SECURITY:
 * - Session token never exposes user identity to other sessions
 * - Rate limiting enforced per session
 * - PII redacted before storage
 * - System prompts never returned to clients
 * - Injection attempts logged and blocked
 */

import type { Express, Request, Response } from "express";
// auth middleware not needed here — we use req.isAuthenticated() (Passport) directly
import {
  assistantChat,
  getOrCreateSession,
  getSessionHistory,
  recordFeedback,
  getAssistantReadiness,
  type Audience,
} from "../services/chat-assistant";
import { rateLimit } from "express-rate-limit";

// Stricter rate limit for the chat endpoint (layered on top of per-session limiting)
// Uses default IP-based key generator to satisfy express-rate-limit IPv6 validation.
const chatRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait before sending another message." },
});

function resolveAudience(req: Request): Audience {
  if (!req.isAuthenticated()) return "public";
  const role = (req.user as any)?.role;
  if (["admin", "manager", "agent"].includes(role)) return "staff";
  if (role === "merchant") return "merchant";
  return "public";
}

export function registerChatAssistantRoutes(app: Express) {
  // ── GET /api/assistant/readiness — no auth, no secrets exposed ──────────────
  app.get("/api/assistant/readiness", (req: Request, res: Response) => {
    res.json(getAssistantReadiness());
  });

  // ── POST /api/assistant/session — create or retrieve a session ──────────────
  app.post("/api/assistant/session", chatRateLimit, async (req: Request, res: Response) => {
    try {
      const audience = resolveAudience(req);
      const userId = (req.user as any)?.id;
      const existingSessionId = req.body?.sessionId;
      const ip = req.ip;

      const sessionId = await getOrCreateSession({
        sessionId: existingSessionId,
        audience,
        userId,
        ip,
      });

      res.json({ sessionId, audience });
    } catch (e: any) {
      console.error("[Assistant] Session creation error:", e.message);
      res.status(500).json({ error: "Unable to create session." });
    }
  });

  // ── POST /api/assistant/chat — main chat endpoint ───────────────────────────
  app.post("/api/assistant/chat", chatRateLimit, async (req: Request, res: Response) => {
    try {
      const { sessionId, message } = req.body;

      if (!sessionId || typeof sessionId !== "string") {
        return res.status(400).json({ error: "sessionId is required." });
      }
      if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ error: "message is required." });
      }

      const audience = resolveAudience(req);
      const user = req.user as any;

      const result = await assistantChat({
        sessionId,
        userMessage: message.trim(),
        audience,
        userId: user?.id,
        userRole: user?.role,
        ip: req.ip,
      });

      // Never return sources for injection-flagged responses
      if (result.flaggedInjection) {
        return res.json({
          answer: result.answer,
          sources: [],
          messageId: result.messageId,
          sessionId: result.sessionId,
          lowConfidence: false,
          handoffSuggested: false,
        });
      }

      res.json({
        answer: result.answer,
        sources: result.sources,
        messageId: result.messageId,
        sessionId: result.sessionId,
        lowConfidence: result.lowConfidence,
        handoffSuggested: result.handoffSuggested,
        flaggedPii: result.flaggedPii,
      });
    } catch (e: any) {
      console.error("[Assistant] Chat error:", e.message);
      res.status(500).json({ error: "The assistant is temporarily unavailable. Please try again." });
    }
  });

  // ── GET /api/assistant/history — session message history ────────────────────
  app.get("/api/assistant/history", async (req: Request, res: Response) => {
    try {
      const sessionId = req.query.sessionId as string;
      if (!sessionId) return res.status(400).json({ error: "sessionId is required." });

      const history = await getSessionHistory(sessionId);
      // Return only role + content — no tokens, no PII metadata to client
      res.json({ messages: history.map(h => ({ role: h.role, content: h.content })) });
    } catch (e: any) {
      res.status(500).json({ error: "Unable to retrieve history." });
    }
  });

  // ── POST /api/assistant/feedback — thumbs up/down ────────────────────────────
  app.post("/api/assistant/feedback", async (req: Request, res: Response) => {
    try {
      const { messageId, sessionId, rating, comment } = req.body;

      if (!messageId || !sessionId || !rating) {
        return res.status(400).json({ error: "messageId, sessionId, and rating are required." });
      }
      if (!["thumbs_up", "thumbs_down"].includes(rating)) {
        return res.status(400).json({ error: "rating must be thumbs_up or thumbs_down." });
      }

      await recordFeedback({
        messageId: Number(messageId),
        sessionId: String(sessionId),
        rating: rating as "thumbs_up" | "thumbs_down",
        comment: comment ? String(comment).slice(0, 500) : undefined,
      });

      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: "Unable to save feedback." });
    }
  });

  // ── GET /api/assistant/handoff — escalation contact info ─────────────────────
  app.get("/api/assistant/handoff", (req: Request, res: Response) => {
    res.json({
      contacts: [
        { label: "General Support", email: "support@libertybancard.com", hours: "Mon–Fri 9 AM–6 PM ET" },
        { label: "Billing & Accounts", email: "accounts@libertybancard.com", hours: "Mon–Fri 9 AM–5 PM ET" },
        { label: "Sales", email: "sales@libertybancard.com", hours: "Mon–Fri 9 AM–6 PM ET" },
        { label: "Compliance", email: "compliance@libertybancard.com", hours: "Mon–Fri 9 AM–5 PM ET" },
      ],
      chatAvailable: isBusinessHours(),
    });
  });
}

function isBusinessHours(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay(); // 0=Sun, 6=Sat
  const hour = et.getHours();
  return day >= 1 && day <= 5 && hour >= 9 && hour < 18;
}
