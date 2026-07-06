import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { contacts } from "@shared/schema";
import { and } from "drizzle-orm";
import { notifyRepWithBriefing, sendProposalEmail } from "../services/proposal-engine";
import { logAiCall } from "../services/ai-audit-logger";
import { parse } from "csv-parse/sync";
import path from "path";
import type { ProposalData, ProposalPlan } from "./helpers";
import { buildVerticalSystemPromptBlock, isVerticalSupported } from "../services/vertical-advisor-prompts";

export function registerAiRoutes(app: Express) {
  // === AI ADVISOR ===
  app.post("/api/ai/chat", isAuthenticated, async (req, res) => {
    try {
      const { department, messages, vertical } = req.body;
      const basePrompt = `ROLE: Liberty Bancard AI Advisor - ${department || "General"}
GOAL: Increase conversion and operational efficiency while staying compliance-safe.
NON-NEGOTIABLES:
- Never promise savings, approval, or funding speed.
- Any mention of pricing, 0% programs, or next-day funding must include: "Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review."
- Do not provide legal or tax advice.
- Do not request or store PCI data, full card numbers, bank account numbers, or SSNs.
- Prefer structured outputs: next best action, draft message, checklist, tasks, routing.
- When uncertain: ask for a statement upload or suggest a 10-minute call.
OUTPUT FORMAT:
1) Summary (2-4 bullets)
2) Recommended action (single best next step)
3) Draft message (SMS + email; compliance-safe)
4) Internal tasks (with due times)`;

      const departmentPrompts: Record<string, string> = {
        sales: "You are the Sales Advisor. Prioritize statement upload + booked calls; draft follow-ups; recommend offer path based on vertical and volume. When a vertical context block is provided, use the pain points, objections/rebuttals, and talking points to tailor every response to that specific industry.",
        support: "You are the Support Advisor. Classify tickets by category (Funding, Terminal, Chargeback, PCI, Other); request missing details; suggest macro response; escalate urgent issues. When a vertical context block is provided, factor in industry-specific chargeback patterns and compliance notes.",
        onboarding: "You are the Onboarding Advisor. Generate doc checklists; go-live plans; terminal setup steps; Day 2/7/14/30 check-in messages. When a vertical context block is provided, tailor onboarding checklists to that industry's specific compliance and operational requirements.",
        marketing: "You are the Marketing Advisor. Create weekly content plans; repurpose proof into briefs; draft landing page variants; write ad copy (no claims without proof). When a vertical context block is provided, use the vertical's pain points and talking points to create industry-specific messaging.",
        finance: "You are the Finance Advisor. Provide reconciliation checklists; commission tracking guidance; anomaly detection tips. Never give tax advice.",
        compliance: "You are the Compliance Advisor. Review copy and messages for claim risk; ensure disclaimers and consent language are present. When a vertical context block is provided, apply all vertical-specific compliance notes rigorously — especially IOLTA rules for legal, lodging addendum requirements for hotels, and NACHA rules for gym/subscription businesses.",
        executive: "You are the Executive Advisor. Provide weekly KPI digests + bottleneck analysis + recommended changes (approval required for all external changes).",
      };

      const resolvedVertical = vertical && isVerticalSupported(vertical) ? vertical : null;
      if (vertical && !resolvedVertical) {
        console.warn(`[AI Chat] Unknown vertical slug "${vertical}" — context block skipped.`);
      }
      const verticalBlock = resolvedVertical ? buildVerticalSystemPromptBlock(resolvedVertical) : "";
      const systemPrompt = `${basePrompt}\n\n${departmentPrompts[department] || departmentPrompts.sales}${verticalBlock}`;

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const msgArray = [
        { role: "system", content: systemPrompt },
        ...(messages || []).map((m: any) => ({ role: m.role, content: m.content })),
      ];
      const { completion } = await logAiCall(
        {
          triggerType: "advisor-chat",
          actorType: (req as any).user?.role || "agent",
          actorId: (req as any).user?.id?.toString(),
          rawPrompt: JSON.stringify(msgArray),
        },
        () => openai.chat.completions.create({
          model: "gpt-5",
          messages: msgArray,
          max_completion_tokens: 5000,
        })
      );

      res.json({ response: completion.choices[0]?.message?.content || "No response generated." });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "AI service error" });
    }
  });


  // === AI DASHBOARD COPILOT ===
  app.post("/api/ai/insights", isAuthenticated, async (req, res) => {
    try {
      const [dealsR, ticketsR, contactsR, allTasks, prospectsR] = await Promise.all([
        storage.getDeals({ limit: 500 }),
        storage.getTickets({ limit: 500 }),
        storage.getContacts({ limit: 500 }),
        storage.getTasks(),
        storage.getProspects(undefined, { limit: 500 }),
      ]);
      const allDeals = dealsR.data;
      const allTickets = ticketsR.data;
      const allContacts = contactsR.data;
      const allProspects = prospectsR.data;

      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const salesDeals = allDeals.filter(d => d.pipeline === "sales");
      const activeDeals = salesDeals.filter(d => d.stage !== "Closed Won" && d.stage !== "Closed Lost");
      const stallingDeals = activeDeals.filter(d => d.updatedAt && new Date(d.updatedAt) < sevenDaysAgo);
      const openTickets = allTickets.filter(t => t.status !== "Resolved" && t.status !== "Closed");
      const breachedTickets = allTickets.filter(t => t.slaDeadline && new Date(t.slaDeadline) < now && !t.resolvedAt && t.status !== "Resolved" && t.status !== "Closed");
      const overdueTasks = allTasks.filter(t => t.status === "pending" && t.dueDate && new Date(t.dueDate) < now);
      const hotProspects = allProspects.filter(p => p.score === "hot" && p.status !== "converted");

      const dataContext = `CURRENT BUSINESS STATE:
- Active sales deals: ${activeDeals.length}
- Stalling deals (no activity 7+ days): ${stallingDeals.length}${stallingDeals.length > 0 ? ` (IDs: ${stallingDeals.slice(0, 5).map(d => d.id).join(", ")})` : ""}
- Open support tickets: ${openTickets.length}
- SLA breaches: ${breachedTickets.length}
- Overdue tasks: ${overdueTasks.length}
- Hot prospects not yet converted: ${hotProspects.length}
- Total contacts: ${allContacts.length}
- Pipeline stages: ${JSON.stringify(Object.fromEntries(activeDeals.reduce((acc, d) => { acc.set(d.stage, (acc.get(d.stage) || 0) + 1); return acc; }, new Map())))}
- Deal stages with most stalling: ${JSON.stringify(Object.fromEntries(stallingDeals.reduce((acc, d) => { acc.set(d.stage, (acc.get(d.stage) || 0) + 1); return acc; }, new Map())))}`;

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const insightMessages = [
        {
          role: "system" as const,
          content: `You are the Liberty Bancard AI Operations Copilot. Analyze the current business metrics and provide actionable insights.
RULES:
- Be specific and data-driven. Reference actual numbers.
- Prioritize urgent items (SLA breaches, stalling deals, overdue tasks).
- Give 3-5 insights, each with a clear action recommendation.
- Use short, punchy language. No filler.
- Never promise savings or make compliance-unsafe claims.
- Format each insight as: **Title** followed by 1-2 sentences with action.
- End with a single "Priority Action" that is the most important thing to do right now.`
        },
        { role: "user" as const, content: dataContext }
      ];
      const { completion } = await logAiCall(
        {
          triggerType: "insights",
          actorType: (req as any).user?.role || "agent",
          actorId: (req as any).user?.id?.toString(),
          rawPrompt: JSON.stringify(insightMessages),
        },
        () => openai.chat.completions.create({
          model: "gpt-5",
          messages: insightMessages,
          max_completion_tokens: 3200,
        })
      );

      const insightsContent = completion.choices[0]?.message?.content || "No insights available.";

      await storage.createAuditLog({
        action: "ai_insights_generated",
        entityType: "system",
        entityId: 0,
        details: {
          actorId: (req as any).user?.id,
          resultState: "success",
          activeDeals: activeDeals.length,
          stallingDeals: stallingDeals.length,
          openTickets: openTickets.length,
          breachedTickets: breachedTickets.length,
        },
      }).catch((err: any) => console.error("[AI] Failed to write ai_insights_generated audit log:", err.message));

      res.json({ insights: insightsContent });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "AI insights error" });
    }
  });


  // === AI EMAIL COMPOSER ===
  app.post("/api/ai/compose-email", isAuthenticated, async (req, res) => {
    try {
      const { contactId, prospectId, context, tone, vertical: verticalParam } = req.body;

      let recipientData = "";
      let resolvedVertical: string | null = verticalParam && isVerticalSupported(verticalParam) ? verticalParam : null;

      if (contactId) {
        const contact = await storage.getContact(Number(contactId));
        if (contact) {
          recipientData = `Recipient: ${contact.firstName} ${contact.lastName}, Company: ${contact.companyName || "N/A"}, Email: ${contact.email}, Status: ${contact.status}, Vertical: ${contact.vertical || "N/A"}`;
          if (!resolvedVertical && contact.vertical && isVerticalSupported(contact.vertical)) {
            resolvedVertical = contact.vertical;
          }
        }
      } else if (prospectId) {
        const prospect = await storage.getProspect(Number(prospectId));
        if (prospect) {
          recipientData = `Prospect: ${prospect.companyName}, Contact: ${prospect.ownerFirstName || ""} ${prospect.ownerLastName || ""}, Email: ${prospect.email || "N/A"}, Vertical: ${prospect.vertical || "N/A"}, Score: ${prospect.score || "N/A"}, Website: ${prospect.website || "N/A"}`;
          if (!resolvedVertical && prospect.vertical && isVerticalSupported(prospect.vertical)) {
            resolvedVertical = prospect.vertical;
          }
        }
      }

      const verticalBlock = resolvedVertical ? buildVerticalSystemPromptBlock(resolvedVertical) : "";

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const emailMessages = [
        {
          role: "system" as const,
          content: `You are Liberty Bancard's AI Email Composer. Draft a professional outreach email.
RULES:
- Tone: ${tone || "consultative and professional"}
- Never promise savings without statement review
- Include this disclaimer at the bottom: "Eligibility, underwriting, card brand rules, and applicable laws apply."
- Keep subject line under 60 characters
- Email body should be 3-5 short paragraphs
- Be value-first: lead with what you can do for them
- End with a clear call-to-action (book a call or reply)
- When a vertical context block is provided, reference the industry-specific pain points and talking points naturally in the email body; apply all compliance notes (e.g., IOLTA disclaimers for legal, lodging notes for hotels)
FORMAT your response as JSON: {"subject": "...", "body": "..."}${verticalBlock}`
        },
        { role: "user" as const, content: `${recipientData}\n\nAdditional context: ${context || "General outreach for payment processing services."}` }
      ];
      const { completion, flagged: composeFlagged, reviewQueueId: composeReviewId } = await logAiCall(
        {
          triggerType: "compose-email",
          actorType: (req as any).user?.role || "agent",
          actorId: (req as any).user?.id?.toString(),
          rawPrompt: JSON.stringify(emailMessages),
        },
        () => openai.chat.completions.create({
          model: "gpt-5",
          messages: emailMessages,
          max_completion_tokens: 3200,
        })
      );

      const raw = completion.choices[0]?.message?.content || "";
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { subject: "Liberty Bancard - Let's Talk Processing", body: raw };
        res.json({ ...parsed, _flagged: composeFlagged, _reviewQueueId: composeReviewId });
      } catch {
        res.json({ subject: "Liberty Bancard - Let's Talk Processing", body: raw, _flagged: composeFlagged, _reviewQueueId: composeReviewId });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Email compose error" });
    }
  });


  // === AI SMART TASK GENERATOR ===
  app.post("/api/ai/generate-tasks", isAuthenticated, async (req, res) => {
    try {
      const [dealsR2, ticketsR2, allTasks, contactsR2] = await Promise.all([
        storage.getDeals({ limit: 500 }),
        storage.getTickets({ limit: 500 }),
        storage.getTasks(),
        storage.getContacts({ limit: 500 }),
      ]);
      const allDeals = dealsR2.data;
      const allTickets = ticketsR2.data;
      const allContacts = contactsR2.data;

      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

      const newTasks: Array<{ title: string; description: string; priority: string; dueDate: Date; relatedType: string; relatedId: number }> = [];
      const existingTaskTitles = new Set(allTasks.map(t => t.title));

      const salesDeals = allDeals.filter(d => d.pipeline === "sales" && d.stage !== "Closed Won" && d.stage !== "Closed Lost");
      for (const deal of salesDeals) {
        if (deal.updatedAt && new Date(deal.updatedAt) < sevenDaysAgo) {
          const title = `Follow up on stalling Deal #${deal.id}`;
          if (!existingTaskTitles.has(title)) {
            newTasks.push({ title, description: `Deal #${deal.id} (${deal.stage}) has had no activity for 7+ days. Reach out to re-engage.`, priority: "high", dueDate: new Date(now.getTime() + 24 * 60 * 60 * 1000), relatedType: "deal", relatedId: deal.id });
          }
        }
      }

      const openTickets = allTickets.filter(t => t.status !== "Resolved" && t.status !== "Closed");
      for (const ticket of openTickets) {
        if (ticket.slaDeadline && new Date(ticket.slaDeadline) < now) {
          const title = `Urgent: SLA breached on ticket "${ticket.subject}"`;
          if (!existingTaskTitles.has(title)) {
            newTasks.push({ title, description: `Ticket #${ticket.id} "${ticket.subject}" has breached its SLA deadline. Immediate action required.`, priority: "urgent", dueDate: now, relatedType: "ticket", relatedId: ticket.id });
          }
        }
      }

      const newLeads = allContacts.filter(c => c.status === "new" && c.createdAt && new Date(c.createdAt) < threeDaysAgo);
      for (const lead of newLeads) {
        const title = `Contact new lead: ${lead.firstName} ${lead.lastName}`;
        if (!existingTaskTitles.has(title)) {
          newTasks.push({ title, description: `${lead.firstName} ${lead.lastName} (${lead.companyName || lead.email}) has been a new lead for 3+ days with no contact. Reach out before they go cold.`, priority: "high", dueDate: new Date(now.getTime() + 24 * 60 * 60 * 1000), relatedType: "contact", relatedId: lead.id });
        }
      }

      // Create all tasks concurrently instead of sequentially to avoid N round-trips
      const created = await Promise.all(
        newTasks.slice(0, 10).map(task =>
          storage.createTask({
            title: task.title,
            description: task.description,
            priority: task.priority,
            status: "pending",
            dueDate: task.dueDate,
          })
        )
      );

      const noOpReason = created.length === 0
        ? "No stalling deals, SLA-breached tickets, or stale new leads matched the generation criteria."
        : undefined;

      await storage.createAuditLog({
        action: "ai_tasks_generated",
        entityType: "system",
        entityId: 0,
        details: {
          generated: created.length,
          taskIds: created.map(t => t.id),
          actorId: (req as any).user?.id,
          resultState: created.length > 0 ? "success" : "no_op_with_reason",
          reason: noOpReason,
        },
      }).catch((err: any) => console.error("[AI] Failed to write ai_tasks_generated audit log:", err.message));

      res.json({ generated: created.length, tasks: created, reason: noOpReason });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === AI TICKET CLASSIFICATION ===
  app.post("/api/ai/classify-ticket", isAuthenticated, async (req, res) => {
    try {
      const { ticketId } = req.body;
      if (!ticketId) return res.status(400).json({ message: "ticketId required" });
      const ticket = await storage.getTicket(Number(ticketId));
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const classifyMessages = [
        {
          role: "system" as const,
          content: `You are a support ticket classifier for Liberty Bancard, a merchant payment processing company.
Analyze the ticket and return JSON with these fields:
- category: one of ["Billing & Fees", "Terminal / Equipment", "Deposits & Funding", "Chargebacks & Disputes", "Compliance / PCI", "Onboarding", "Account Changes", "Other"]
- priority: one of ["Low", "Normal", "High", "Urgent"]
- suggestedResponse: a professional, helpful draft response (3-5 sentences) addressing the merchant's concern
- tags: array of 2-4 relevant tags
- estimatedResolutionHours: number estimate
Respond ONLY with valid JSON.`
        },
        {
          role: "user" as const,
          content: `Subject: ${ticket.subject}\nDescription: ${ticket.description}\nCurrent Category: ${ticket.category}\nCurrent Priority: ${ticket.priority}`
        }
      ];
      const { completion } = await logAiCall(
        {
          triggerType: "ticket-classify",
          actorType: (req as any).user?.role || "agent",
          actorId: (req as any).user?.id?.toString(),
          rawPrompt: JSON.stringify(classifyMessages),
        },
        () => openai.chat.completions.create({
          model: "gpt-5",
          messages: classifyMessages,
          max_completion_tokens: 3000,
        })
      );

      const raw = completion.choices[0]?.message?.content || "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(500).json({ message: "AI returned invalid response" });

      const result = JSON.parse(jsonMatch[0]);
      await storage.updateTicket(Number(ticketId), {
        category: result.category,
        priority: result.priority,
      });
      await storage.createAuditLog({
        action: "ticket_ai_classified",
        entityType: "ticket",
        entityId: ticket.id,
        details: result,
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Classification error" });
    }
  });


  // === AI COMMAND CENTER STATUS ===
  app.get("/api/ai/command-center", isAuthenticated, async (req, res) => {
    try {
      const logs = await storage.getAuditLogs();
      const aiActions = [
        { key: "generate_tasks", label: "Smart Task Generation", actionType: "ai_tasks_generated" },
        { key: "auto_progress", label: "Deal Auto-Progression", actionType: "deal_auto_progressed" },
        { key: "route_prospects", label: "Prospect Routing", actionType: "prospect_routed" },
        { key: "classify_tickets", label: "Ticket Classification", actionType: "ticket_ai_classified" },
        { key: "insights", label: "AI Insights", actionType: "ai_insights_generated" },
        { key: "statement_analysis", label: "Statement Analysis", actionType: "statement_analyzed" },
      ];

      const result = aiActions.map(action => {
        const relevant = logs.filter(l => l.action === action.actionType);
        const lastRun = relevant.length > 0 ? relevant[0].createdAt : null;
        return {
          ...action,
          totalRuns: relevant.length,
          lastRun,
        };
      });

      const workflowRunsList = await storage.getWorkflowRuns();
      const totalWorkflowRuns = workflowRunsList.length;
      const recentRuns = workflowRunsList.filter(r => {
        const created = new Date(r.createdAt || 0);
        return created > new Date(Date.now() - 24 * 60 * 60 * 1000);
      }).length;

      res.json({
        aiActions: result,
        workflowStats: { totalRuns: totalWorkflowRuns, last24h: recentRuns },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === AI STATEMENT ANALYSIS ===
  app.post("/api/ai/analyze-statement", isAuthenticated, async (req, res) => {
    try {
      const { contactId, dealId, statementData, vertical: verticalParam } = req.body;
      if (!statementData) return res.status(400).json({ message: "statementData required" });

      let resolvedVertical: string | null = verticalParam && isVerticalSupported(verticalParam) ? verticalParam : null;

      if (!resolvedVertical && contactId) {
        const contact = await storage.getContact(Number(contactId));
        if (contact?.vertical && isVerticalSupported(contact.vertical)) {
          resolvedVertical = contact.vertical;
        }
      }
      if (!resolvedVertical && dealId) {
        const deal = await storage.getDeal(Number(dealId));
        if (deal?.contactId) {
          const contact = await storage.getContact(deal.contactId);
          if (contact?.vertical && isVerticalSupported(contact.vertical)) {
            resolvedVertical = contact.vertical;
          }
        }
      }

      const verticalBlock = resolvedVertical ? buildVerticalSystemPromptBlock(resolvedVertical) : "";

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const stmtMessages = [
        {
          role: "system" as const,
          content: `You are Liberty Bancard's AI Statement Analyst. Analyze merchant processing statement data and provide a detailed fee analysis.
RULES:
- Never promise specific savings without full statement review
- Include disclaimer: "Eligibility, underwriting, card brand rules, and applicable laws apply."
- Be specific about fee types and rates found
- Recommend the best offer path based on the data
- When a vertical context block is provided, use the recommended offer paths and compliance notes specific to that industry when selecting recommendedPath and writing keyFindings; apply vertical-specific compliance requirements (e.g., IOLTA notes for legal, lodging interchange notes for hotels)

Return JSON with:
- effectiveRate: estimated effective rate as percentage string
- monthlyVolume: estimated monthly volume
- currentFees: object with fee breakdowns { interchange: string, markup: string, monthlyFees: string, pciFees: string, otherFees: string }
- recommendedPath: one of ["Cash Discount", "Dual Pricing", "Tiered Reduction", "Interchange Plus"]
- keyFindings: array of 3-5 specific findings about their current processing
- riskFlags: array of any concerning items (high rates, non-compliant fees, etc.)
- nextSteps: array of recommended next steps
- overallAssessment: 2-3 sentence summary${verticalBlock}`
        },
        { role: "user" as const, content: `Statement Data:\n${typeof statementData === 'string' ? statementData : JSON.stringify(statementData)}` }
      ];
      const { completion, flagged: stmtFlagged, reviewQueueId: stmtReviewId } = await logAiCall(
        {
          triggerType: "statement-analysis",
          actorType: (req as any).user?.role || "agent",
          actorId: (req as any).user?.id?.toString(),
          rawPrompt: JSON.stringify(stmtMessages),
        },
        () => openai.chat.completions.create({
          model: "gpt-5",
          messages: stmtMessages,
          max_completion_tokens: 10000,
        })
      );

      const raw = completion.choices[0]?.message?.content || "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { overallAssessment: raw };

      if (dealId && !stmtFlagged) {
        await storage.updateDeal(Number(dealId), {
          effectiveRate: analysis.effectiveRate,
          recommendedPath: analysis.recommendedPath,
        }, { actorType: "ai", actorId: "statement-analyzer", userId: null });
      } else if (dealId && stmtFlagged) {
        console.warn(`[AI Governance] Statement analysis flagged (reviewQueueId=${stmtReviewId}) — skipping deal auto-update for deal ${dealId} pending review`);
      }

      await storage.createAuditLog({
        action: "statement_analyzed",
        entityType: dealId ? "deal" : "contact",
        entityId: dealId ? Number(dealId) : (contactId ? Number(contactId) : undefined),
        actorType: "ai",
        actorId: "statement-analyzer",
        details: analysis,
      });

      res.json({ ...analysis, _flagged: stmtFlagged, _reviewQueueId: stmtReviewId, _vertical: resolvedVertical });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Analysis error" });
    }
  });

  app.post("/api/ai/generate-proposal", isAuthenticated, async (req, res) => {
    try {
      const { dealId, statementData } = req.body;
      if (!dealId) return res.status(400).json({ message: "dealId required" });

      const deal = await storage.getDeal(Number(dealId));
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;

      const volume = parseFloat((statementData?.monthlyVolume || deal.totalVolume || "0").toString().replace(/[^0-9.]/g, ""));
      const effectiveRate = parseFloat((statementData?.effectiveRate || deal.effectiveRate || "3.0").toString().replace(/[^0-9.]/g, ""));
      const avgTicket = parseFloat((statementData?.avgTicket || deal.avgTicket || "50").toString().replace(/[^0-9.]/g, ""));
      const currentMonthlyFees = volume * (effectiveRate / 100);

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const proposalMessages = [
        {
          role: "system" as const,
          content: `You are Liberty Bancard's AI Pricing Strategist. Generate a competitive savings proposal for a merchant.

BUSINESS CONTEXT:
- Liberty Bancard is a merchant payment processor offering better rates
- Goal: Show the merchant EXACTLY where they save and how much per year
- Pricing should be 20-30% lower than their current processing fees
- Liberty Bancard still needs healthy margin (target 15-25 basis points net profit on volume)
- Generate THREE pricing plans the sales rep can present

PLAN TYPES:
1. "Cash Discount / Compliant Surcharging" - Merchant effectively pays 0% processing. Customer pays a small service fee at point of sale. Liberty Bancard earns from the surcharge program management fee.
2. "Interchange Plus" - Transparent pricing: interchange cost + small fixed markup. Merchant still saves significantly vs their current tiered/bundled pricing. This is the "honest" plan.
3. "Tiered Reduction" - Simplified tiered pricing but with rates 20-30% lower than current. Good for merchants who want simplicity.

RULES:
- All savings must be realistic and mathematically sound
- Include disclaimer: "Eligibility, underwriting, card brand rules, and applicable laws apply. Savings estimates based on statement data provided. Actual results may vary."
- Never promise exact savings without full underwriting
- Be specific with dollar amounts
- Include strong urgency CTAs

Return valid JSON with this exact structure:
{
  "merchantName": "string",
  "currentState": {
    "monthlyVolume": number,
    "effectiveRate": "string (e.g. 3.2%)",
    "monthlyFees": number,
    "annualFees": number,
    "avgTicket": number,
    "topIssues": ["string array of 3-5 specific fee problems found"]
  },
  "plans": [
    {
      "name": "Cash Discount / Compliant Surcharging",
      "shortName": "cashDiscount",
      "headline": "string - compelling one-liner",
      "effectiveRate": "string (e.g. 0.00%)",
      "monthlyFees": number,
      "monthlySavings": number,
      "annualSavings": number,
      "savingsPercent": number,
      "howItWorks": "string - 2-3 sentence explanation",
      "pros": ["string array"],
      "cons": ["string array"],
      "bestFor": "string",
      "libertyMarginBps": number,
      "libertyMonthlyRevenue": number
    },
    {
      "name": "Interchange Plus",
      "shortName": "interchangePlus",
      "headline": "string",
      "effectiveRate": "string",
      "monthlyFees": number,
      "monthlySavings": number,
      "annualSavings": number,
      "savingsPercent": number,
      "howItWorks": "string",
      "pros": ["string array"],
      "cons": ["string array"],
      "bestFor": "string",
      "libertyMarginBps": number,
      "libertyMonthlyRevenue": number
    },
    {
      "name": "Tiered Reduction",
      "shortName": "tieredReduction",
      "headline": "string",
      "effectiveRate": "string",
      "monthlyFees": number,
      "monthlySavings": number,
      "annualSavings": number,
      "savingsPercent": number,
      "howItWorks": "string",
      "pros": ["string array"],
      "cons": ["string array"],
      "bestFor": "string",
      "libertyMarginBps": number,
      "libertyMonthlyRevenue": number
    }
  ],
  "recommendedPlan": "shortName of best plan for this merchant",
  "recommendedReason": "string - why this plan is best",
  "urgencyCtas": ["3 strong CTA messages to close the deal ASAP"],
  "complianceDisclaimer": "string",
  "feeBreakdown": {
    "currentInterchange": "string estimate",
    "currentMarkup": "string estimate",
    "currentMonthlyFees": "string estimate",
    "currentPciFees": "string estimate",
    "hiddenFees": ["string array of fees they're overpaying"]
  }
}`
        },
        {
          role: "user" as const,
          content: `Generate a savings proposal for this merchant:
Merchant: ${contact?.companyName || contact?.firstName + " " + contact?.lastName || "Unknown Business"}
Industry: ${contact?.vertical || "General Retail"}
Monthly Volume: $${volume.toLocaleString()}
Current Effective Rate: ${effectiveRate}%
Current Monthly Fees: $${currentMonthlyFees.toFixed(2)}
Average Ticket: $${avgTicket.toFixed(2)}
Current Provider: ${contact?.currentProvider || "Unknown"}
Additional Statement Data: ${statementData ? JSON.stringify(statementData) : "None provided"}
Notes: ${deal.notes || "None"}`
        }
      ];
      const { completion, flagged: proposalFlagged, reviewQueueId: proposalReviewId } = await logAiCall(
        {
          triggerType: "proposal",
          actorType: (req as any).user?.role || "agent",
          actorId: (req as any).user?.id?.toString(),
          rawPrompt: JSON.stringify(proposalMessages),
        },
        () => openai.chat.completions.create({
          model: "gpt-5",
          messages: proposalMessages,
          max_completion_tokens: 8000,
        }));

      const raw = completion.choices[0]?.message?.content || "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.status(500).json({ message: "Failed to generate structured proposal" });
      }

      let proposal: any;
      try {
        proposal = JSON.parse(jsonMatch[0]);
      } catch (parseErr) {
        return res.status(500).json({ message: "AI returned malformed JSON. Please try again." });
      }

      if (!proposal.plans || !Array.isArray(proposal.plans) || proposal.plans.length === 0) {
        return res.status(500).json({ message: "Proposal missing required plan data. Please try again." });
      }

      for (const plan of proposal.plans) {
        plan.monthlySavings = typeof plan.monthlySavings === "number" ? plan.monthlySavings : 0;
        plan.annualSavings = typeof plan.annualSavings === "number" ? plan.annualSavings : plan.monthlySavings * 12;
        plan.savingsPercent = typeof plan.savingsPercent === "number" ? plan.savingsPercent : 0;
        plan.libertyMarginBps = typeof plan.libertyMarginBps === "number" ? plan.libertyMarginBps : 0;
        plan.libertyMonthlyRevenue = typeof plan.libertyMonthlyRevenue === "number" ? plan.libertyMonthlyRevenue : 0;
      }

      if (!proposal.currentState) {
        proposal.currentState = { monthlyVolume: volume, effectiveRate: `${effectiveRate}%`, monthlyFees: currentMonthlyFees, annualFees: currentMonthlyFees * 12, avgTicket, topIssues: [] };
      }

      proposal.generatedAt = new Date().toISOString();
      proposal.dealId = deal.id;

      const bestPlan = proposal.plans?.find((p: any) => p.shortName === proposal.recommendedPlan) || proposal.plans?.[0];

      const crypto = await import("crypto");
      const proposalToken = deal.proposalToken || crypto.randomBytes(24).toString("hex");

      await storage.updateDeal(deal.id, {
        savingsProposal: proposal,
        proposalGeneratedAt: new Date(),
        proposalToken,
        proposalStatus: "generated",
        recommendedPath: bestPlan?.name || deal.recommendedPath,
        effectiveRate: deal.effectiveRate || `${effectiveRate}%`,
        totalVolume: deal.totalVolume || `$${volume.toLocaleString()}`,
        totalFees: deal.totalFees || `$${currentMonthlyFees.toFixed(2)}`,
        avgTicket: deal.avgTicket || `$${avgTicket.toFixed(2)}`,
        estimatedGrossProfitBps: bestPlan?.libertyMarginBps || deal.estimatedGrossProfitBps,
        estimatedGrossProfitMonthly: bestPlan?.libertyMonthlyRevenue ? `$${bestPlan.libertyMonthlyRevenue.toFixed(2)}` : deal.estimatedGrossProfitMonthly,
        lastStatementReviewDate: new Date(),
      }, { actorType: "ai", actorId: "proposal-generator", userId: null });

      await storage.createAuditLog({
        action: "proposal_generated",
        entityType: "deal",
        entityId: deal.id,
        actorType: "ai",
        actorId: "proposal-generator",
        details: {
          recommendedPlan: proposal.recommendedPlan,
          plans: proposal.plans?.map((p: any) => ({ name: p.name, annualSavings: p.annualSavings, savingsPercent: p.savingsPercent })),
        },
      });

      await storage.createNotification({
        channel: "internal",
        title: "Savings Proposal Generated",
        message: `Proposal ready for ${contact?.companyName || contact?.firstName || "Unknown"} - recommended: ${bestPlan?.name || "N/A"}, annual savings: $${bestPlan?.annualSavings?.toLocaleString() || "N/A"}`,
        type: "info",
        metadata: { dealId: deal.id, contactId: deal.contactId },
      });

      res.json({ ...proposal, _flagged: proposalFlagged, _reviewQueueId: proposalReviewId });
    } catch (err: any) {
      console.error("Proposal generation error:", err);
      res.status(500).json({ message: err.message || "Proposal generation error" });
    }
  });

  app.get("/api/deals/:id/proposal", isAuthenticated, async (req, res) => {
    try {
      const deal = await storage.getDeal(Number(req.params.id));
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      if (!deal.savingsProposal) return res.status(404).json({ message: "No proposal generated yet" });
      res.json(deal.savingsProposal);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/public/proposal/:token", async (req, res) => {
    try {
      const token = req.params.token;
      if (!token || token.length < 10) return res.status(400).json({ message: "Invalid token" });
      const { data: allDeals } = await storage.getDeals({ limit: 500 });
      const deal = allDeals.find(d => d.proposalToken === token);
      if (!deal || !deal.savingsProposal) return res.status(404).json({ message: "Proposal not found" });
      const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;
      const proposal = deal.savingsProposal as ProposalData;

      const sanitizedPlans = (proposal.plans || []).map((p: ProposalPlan) => ({
        name: p.name,
        shortName: p.shortName,
        headline: p.headline,
        effectiveRate: p.effectiveRate,
        monthlyFees: p.monthlyFees,
        monthlySavings: p.monthlySavings,
        annualSavings: p.annualSavings,
        savingsPercent: p.savingsPercent,
        howItWorks: p.howItWorks,
        pros: p.pros,
        cons: p.cons,
        bestFor: p.bestFor,
      }));

      res.json({
        merchantName: proposal.merchantName || contact?.companyName || `${contact?.firstName || ""} ${contact?.lastName || ""}`.trim() || "Merchant",
        contactFirstName: contact?.firstName || "",
        vertical: contact?.vertical || "",
        generatedAt: proposal.generatedAt,
        currentState: proposal.currentState,
        plans: sanitizedPlans,
        recommendedPlan: proposal.recommendedPlan,
        recommendedReason: proposal.recommendedReason,
        recommendedTerminal: proposal.recommendedTerminal,
        urgencyCtas: proposal.urgencyCtas,
        complianceDisclaimer: proposal.complianceDisclaimer,
        feeBreakdown: proposal.feeBreakdown ? {
          currentInterchange: proposal.feeBreakdown.currentInterchange,
          currentMarkup: proposal.feeBreakdown.currentMarkup,
          currentMonthlyFees: proposal.feeBreakdown.currentMonthlyFees,
          currentPciFees: proposal.feeBreakdown.currentPciFees,
          hiddenFees: proposal.feeBreakdown.hiddenFees,
        } : undefined,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/deals/:id/edit-proposal", isAuthenticated, async (req, res) => {
    try {
      const userRole = (req.user as any)?.role;
      if (!['admin', 'manager', 'sales'].includes(userRole)) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }
      const dealId = Number(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      if (!deal.savingsProposal) return res.status(400).json({ message: "No proposal to edit" });

      const { plans, recommendedPlan, recommendedReason, recommendedTerminal } = req.body;
      const existing = deal.savingsProposal as ProposalData;

      if (plans && Array.isArray(plans)) {
        for (let i = 0; i < plans.length && i < existing.plans.length; i++) {
          const editedPlan = plans[i];
          if (editedPlan) {
            Object.assign(existing.plans[i], editedPlan);
          }
        }
      }
      if (recommendedPlan) existing.recommendedPlan = recommendedPlan;
      if (recommendedReason) existing.recommendedReason = recommendedReason;
      if (recommendedTerminal) existing.recommendedTerminal = recommendedTerminal;

      const userEmail = (req.user as Express.User & { email?: string })?.email || "rep";
      existing.lastEditedAt = new Date().toISOString();
      existing.editedBy = userEmail;

      await storage.updateDeal(dealId, { savingsProposal: existing }, { actorType: "user", userId: (req.user as any)?.id ?? null });
      await storage.createAuditLog({
        action: "proposal_edited",
        entityType: "deal",
        entityId: dealId,
        actorType: "user",
        userId: (req.user as any)?.id ?? null,
        details: { editedBy: userEmail },
      });

      res.json({ success: true, proposal: existing });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/deals/:id/send-proposal", isAuthenticated, async (req, res) => {
    try {
      const userRole = (req.user as any)?.role;
      if (!['admin', 'manager', 'sales'].includes(userRole)) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }
      const dealId = Number(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      if (!deal.savingsProposal) return res.status(400).json({ message: "No proposal generated yet. Generate a proposal first." });
      const sent = await sendProposalEmail(dealId);
      if (sent) {
        await notifyRepWithBriefing(dealId);
        res.json({ success: true, message: "Proposal sent to merchant" });
      } else {
        res.status(500).json({ message: "Failed to send proposal email" });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/settings/proposal-auto-send", isAuthenticated, async (req, res) => {
    try {
      const setting = await storage.getSystemSetting("proposal_auto_send");
      res.json({ enabled: setting?.enabled === true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/settings/proposal-auto-send", isAuthenticated, async (req, res) => {
    try {
      if (!['admin', 'manager'].includes((req.user as any)?.role)) {
        return res.status(403).json({ message: "Admin/Manager only" });
      }
      const { enabled } = req.body;
      await storage.setSystemSetting("proposal_auto_send", { enabled: enabled === true });
      res.json({ success: true, enabled: enabled === true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === AI ONBOARDING STATUS ===
  app.get("/api/ai/onboarding-status", isAuthenticated, async (req, res) => {
    try {
      const [{ data: allDeals }, allTasks] = await Promise.all([
        storage.getDeals({ limit: 500 }),
        storage.getTasks(),
      ]);
      const onboardingDeals = allDeals.filter(d => d.pipeline === "onboarding" && d.stage !== "Cancelled");

      // Batch-fetch all related contacts in a single IN (...) query instead of N individual lookups
      const dealContactIds = onboardingDeals
        .map(d => d.contactId)
        .filter((id): id is number => id != null);
      const contactRows = await storage.getContactsByIds(dealContactIds);
      const contactMap = new Map(contactRows.map(c => [c.id, c]));

      const stageOrder = [
        "Contract Sent", "Application Started", "Underwriting Submitted",
        "Approved", "Terminal Ordered", "Go-Live Scheduled",
        "Live (First Batch)", "Active (7 Days)", "Active (30 Days)"
      ];

      const statuses = onboardingDeals.map(deal => {
        const currentStageIndex = stageOrder.indexOf(deal.stage);
        const milestones = [
          { name: "Contract Sent", done: currentStageIndex >= 0 },
          { name: "Application Submitted", done: currentStageIndex >= 1 || deal.appCompleted === true },
          { name: "Documents Collected", done: deal.statementReceived === true && deal.voidedCheckReceived === true && deal.idReceived === true },
          { name: "Underwriting Submitted", done: currentStageIndex >= 2 },
          { name: "Approved", done: currentStageIndex >= 3 },
          { name: "Terminal Ordered", done: currentStageIndex >= 4 },
          { name: "Go-Live Scheduled", done: currentStageIndex >= 5 },
          { name: "Live & Processing", done: currentStageIndex >= 6 },
        ];
        const completedMilestones = milestones.filter(m => m.done).length;
        const progress = Math.round((completedMilestones / milestones.length) * 100);

        const dealTasks = allTasks.filter(t => t.dealId === deal.id);
        const pendingTasks = dealTasks.filter(t => t.status !== "completed");

        const daysSinceSignup = deal.createdAt
          ? Math.floor((Date.now() - new Date(deal.createdAt).getTime()) / (1000 * 60 * 60 * 24))
          : 0;

        let nextStep = "All milestones complete";
        const nextMilestone = milestones.find(m => !m.done);
        if (nextMilestone) nextStep = nextMilestone.name;

        const docReadiness = {
          statement: deal.statementReceived === true,
          voidedCheck: deal.voidedCheckReceived === true,
          id: deal.idReceived === true,
          appCompleted: deal.appCompleted === true,
          score: deal.docReadinessScore || 0,
        };

        // Contact name resolved from the pre-fetched batch map — no extra queries
        const contact = deal.contactId != null ? contactMap.get(deal.contactId) : null;

        return {
          dealId: deal.id,
          contactId: deal.contactId,
          contactName: contact
            ? (contact.companyName || `${contact.firstName} ${contact.lastName}`.trim() || null)
            : null,
          stage: deal.stage,
          progress,
          milestones,
          pendingTasks: pendingTasks.length,
          nextStep,
          daysSinceSignup,
          docReadiness,
          goLiveDate: deal.goLiveDate,
          updatedAt: deal.updatedAt,
          createdAt: deal.createdAt,
        };
      });

      res.json(statuses);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === AI COST SUMMARY (today + month + daily rollup) ===
  app.get("/api/operator/ai-cost-summary", isDashboardUser, async (req, res) => {
    try {
      const rawDays = parseInt(String(req.query.days ?? ""), 10);
      const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, 90) : 30;
      const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : undefined;
      const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : undefined;
      const [summary, dailyRollup] = await Promise.all([
        storage.getAiCostSummary(startDate, endDate),
        storage.getAiCostDailyRollup(days),
      ]);
      res.json({ summary, dailyRollup });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === AI CHARGEBACK COPILOT ===
  app.post("/api/ai/chargeback-copilot/:id", isDashboardUser, async (req, res) => {
    try {
      const chargebackId = Number(req.params.id);
      const cb = await storage.getChargeback(chargebackId);
      if (!cb) return res.status(404).json({ message: "Chargeback not found" });

      const { db } = await import("../db");
      const { midDailyStats } = await import("@shared/schema");
      const { eq: eqOp, desc: descOp } = await import("drizzle-orm");

      const [contact, deal, allKb] = await Promise.all([
        cb.contactId ? storage.getContact(cb.contactId) : Promise.resolve(null),
        cb.dealId ? storage.getDeal(cb.dealId) : Promise.resolve(null),
        storage.getKnowledgeBaseArticles ? storage.getKnowledgeBaseArticles() : Promise.resolve([]),
      ]);

      let recentMidStats: any[] = [];
      if (deal?.mid) {
        recentMidStats = await db.select().from(midDailyStats)
          .where(eqOp(midDailyStats.mid, deal.mid))
          .orderBy(descOp(midDailyStats.date))
          .limit(30);
      } else if (cb.dealId) {
        recentMidStats = await db.select().from(midDailyStats)
          .where(eqOp(midDailyStats.dealId, cb.dealId))
          .orderBy(descOp(midDailyStats.date))
          .limit(30);
      } else if (cb.contactId) {
        recentMidStats = await db.select().from(midDailyStats)
          .where(eqOp(midDailyStats.contactId, cb.contactId))
          .orderBy(descOp(midDailyStats.date))
          .limit(30);
      }

      const merchantHistory = contact ? [
        `Merchant: ${contact.companyName || `${contact.firstName} ${contact.lastName}`}`,
        `Vertical: ${contact.vertical || "N/A"}`,
        `Monthly Volume: ${contact.monthlyVolume || "N/A"}`,
        `Current Provider: ${contact.currentProvider || "N/A"}`,
        `Status: ${contact.status}`,
        `Business Age: ${contact.businessAge || "N/A"}`,
      ].join("\n") : "No merchant profile available.";

      const dealHistory = deal ? [
        `Deal Stage: ${deal.stage}`,
        `Effective Rate: ${deal.effectiveRate || "N/A"}`,
        `Total Volume: ${deal.totalVolume || "N/A"}`,
        `Health Score: ${deal.healthScore || "N/A"}`,
        `Risk Tier: ${deal.riskTier || "N/A"}`,
        `MID: ${deal.mid || "N/A"}`,
      ].join("\n") : "No deal data available.";

      const evidenceFilesList = ((cb.evidenceFiles as any[]) || [])
        .map((f: any) => `- ${f.name} (uploaded ${f.uploadedAt || "N/A"})`).join("\n") || "None attached";

      const reasonCodeMap: Record<string, { category: string; evidenceNeeded: string[]; rebuttalletter: string }> = {
        "13.1": { category: "Item Not Received", evidenceNeeded: ["Proof of delivery", "Shipping tracking confirmation", "Carrier confirmation", "Customer communication logs", "Delivery address verification"], rebuttalletter: "Focus on delivery confirmation and tracking evidence. If digital goods, show access logs and download records." },
        "13.2": { category: "Canceled Recurring", evidenceNeeded: ["Cancellation policy disclosure", "Subscription terms agreed at signup", "Proof cardholder did not cancel", "Last active usage date", "Renewal notification sent"], rebuttalletter: "Demonstrate the cancellation policy was clearly disclosed at signup, the cardholder did not follow the cancellation process, and/or the charge was for a period prior to any cancellation request." },
        "13.3": { category: "Not as Described", evidenceNeeded: ["Product/service description at time of sale", "Customer acknowledgment of receipt", "Photos/documentation of item", "Customer communications", "Return policy disclosure"], rebuttalletter: "Document that the goods or services were delivered exactly as described. Include any communications showing the customer was satisfied or did not report issues within a reasonable timeframe." },
        "13.4": { category: "Counterfeit/Fraud", evidenceNeeded: ["Original transaction receipt", "Customer signature or authorization", "AVS/CVV match data", "IP address and device fingerprint", "Prior purchase history with same card"], rebuttalletter: "Present evidence of authentic transaction authorization including card-present data, AVS match, and prior transaction history with the same cardholder." },
        "13.5": { category: "Misrepresentation", evidenceNeeded: ["Marketing materials at time of sale", "Product/service terms", "Customer acknowledgment", "Communication logs"], rebuttalletter: "Provide documentation showing accurate representation was made at the time of sale, and the customer agreed to the terms." },
        "13.6": { category: "Credit Not Processed", evidenceNeeded: ["Refund/credit confirmation", "Credit posting date", "Customer communication re: credit", "Processing records"], rebuttalletter: "Show proof that the credit was issued and provide the transaction ID and date it was processed." },
        "13.7": { category: "Canceled Merchandise/Services", evidenceNeeded: ["Return/cancellation policy", "Evidence cancellation terms were disclosed", "Date of service/shipment vs. cancellation date", "Customer communication"], rebuttalletter: "Document the cancellation/return policy that was agreed to at purchase, and show the timeline of events." },
        "4853": { category: "Cardholder Dispute", evidenceNeeded: ["Transaction receipt", "Customer communication", "Delivery/service confirmation", "Refund policy"], rebuttalletter: "Provide comprehensive transaction documentation showing goods/services were delivered as expected and the cardholder had an opportunity to resolve the dispute directly." },
        "4855": { category: "Non-Receipt of Merchandise", evidenceNeeded: ["Shipping records", "Tracking number and carrier confirmation", "Delivery address", "Customer communication"], rebuttalletter: "Demonstrate delivery with carrier tracking, delivery confirmation, and any customer communications acknowledging receipt." },
        "4831": { category: "Transaction Amount Differs", evidenceNeeded: ["Original transaction receipt", "Price quote or estimate", "Customer-authorized amount", "Invoice"], rebuttalletter: "Provide the original receipt or invoice showing the cardholder authorized the exact amount charged." },
        "4834": { category: "Duplicate Processing", evidenceNeeded: ["Transaction records showing unique transactions", "Receipts for each charge", "Customer communications"], rebuttalletter: "Show that each charge represents a unique, separate transaction and was not a duplicate." },
        "4863": { category: "Cardholder Does Not Recognize", evidenceNeeded: ["Transaction receipt", "Prior purchases from same card", "Customer communication history", "AVS/CVV data"], rebuttalletter: "Provide evidence of the transaction, prior relationship with the cardholder, and any contact information that can help the cardholder recognize the charge." },
        "C08": { category: "Goods/Services Not Received", evidenceNeeded: ["Proof of delivery", "Tracking information", "Service logs", "Customer communication"], rebuttalletter: "Provide delivery confirmation, service completion documentation, and any customer communications acknowledging receipt." },
        "C14": { category: "Paid by Other Means", evidenceNeeded: ["Payment ledger showing only one payment received", "Transaction records", "Customer communication"], rebuttalletter: "Demonstrate that no duplicate payment was received and only one transaction was processed." },
        "C28": { category: "Canceled Recurring", evidenceNeeded: ["Cancellation policy", "Subscription terms", "Renewal notifications", "Usage logs"], rebuttalletter: "Document the cancellation terms disclosed at signup and evidence the cardholder did not follow the cancellation process." },
        "C31": { category: "Goods/Services Not as Described", evidenceNeeded: ["Description at sale", "Customer agreement", "Photos or service record", "Communication logs"], rebuttalletter: "Provide evidence the goods or services matched the description provided at the time of sale." },
      };

      const reasonKey = Object.keys(reasonCodeMap).find(k => cb.reasonCode.includes(k)) || "";
      const codeContext = reasonCodeMap[reasonKey] || {
        category: "General Dispute",
        evidenceNeeded: ["Transaction receipt", "Customer communication", "Proof of delivery or service", "Authorization records"],
        rebuttalletter: "Provide comprehensive documentation of the transaction, authorization, and delivery/service completion.",
      };

      const kbRelevant = (allKb as any[]).filter((a: any) =>
        (a.title || "").toLowerCase().includes("chargeback") ||
        (a.content || "").toLowerCase().includes("dispute") ||
        (a.category || "").toLowerCase().includes("compliance")
      ).slice(0, 3).map((a: any) => `[${a.title}]: ${(a.content || "").slice(0, 200)}`).join("\n");

      const systemPrompt = `You are Liberty Bancard's AI Chargeback Copilot — an expert in payment dispute representment.
Your job is to analyze a chargeback case and produce a professional evidence packet.

COMPLIANCE RULES:
- Be factual and evidence-based only. Do not make claims without supporting evidence.
- Never guarantee a win outcome — only provide a probability estimate with rationale.
- Use professional, formal language appropriate for card brand arbitration.
- Structure the rebuttal letter for the issuing bank's review panel.

OUTPUT: Return ONLY valid JSON matching this exact structure:
{
  "rebuttalletter": "Full formal rebuttal letter text (3-6 paragraphs, professional tone, referencing specific evidence)",
  "evidenceChecklist": [
    { "item": "Evidence item name", "status": "included|missing|partial", "notes": "optional explanation" }
  ],
  "winLikelihood": {
    "estimate": "High|Moderate|Low",
    "rationale": "2-3 sentence explanation of win probability based on available evidence and reason code"
  },
  "reasonCodeContext": "1-2 sentence explanation of this dispute type and what card brands look for"
}`;

      const userPrompt = `CHARGEBACK CASE:
Reason Code: ${cb.reasonCode}
Dispute Category: ${codeContext.category}
Card Brand: ${cb.cardBrand}
Transaction Date: ${cb.transactionDate ? new Date(cb.transactionDate).toLocaleDateString() : "N/A"}
Amount: $${cb.amount.toFixed(2)}
Response Deadline: ${cb.responseDeadline ? new Date(cb.responseDeadline).toLocaleDateString() : "N/A"}
Reason Description: ${cb.reasonDescription || "None provided"}
Status: ${cb.status}
Notes: ${cb.notes || "None"}

MERCHANT PROFILE:
${merchantHistory}

DEAL / PROCESSING HISTORY:
${dealHistory}

EVIDENCE FILES ATTACHED:
${evidenceFilesList}

MID / TRANSACTION HISTORY (last 30 days):
${recentMidStats.length > 0
  ? recentMidStats.map(s =>
      `${s.date}: Vol=$${(s.volume || 0).toFixed(2)}, Txns=${s.txCount || 0}, AvgTicket=$${(s.avgTicket || 0).toFixed(2)}, ChargebackCount=${s.chargebackCount || 0}, ChargebackAmt=$${(s.chargebackAmount || 0).toFixed(2)}`
    ).join("\n")
  : "No MID daily stats available for this merchant."}

REBUTTAL STRATEGY FOR THIS REASON CODE:
${codeContext.rebuttalletter}

EVIDENCE RECOMMENDED FOR THIS DISPUTE TYPE:
${codeContext.evidenceNeeded.map((e, i) => `${i + 1}. ${e}`).join("\n")}

${kbRelevant ? `RELEVANT KNOWLEDGE BASE ENTRIES:\n${kbRelevant}` : ""}

Based on the above, generate the evidence packet. For the evidenceChecklist, check each recommended evidence type against what's been attached. Mark as "included" if there's a matching evidence file, "missing" if not present, "partial" if partly addressed. Draft the rebuttal letter on behalf of ${contact?.companyName || "the merchant"}, addressing the ${cb.cardBrand} dispute panel.`;

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const chargebackMessages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userPrompt },
      ];
      const { completion, flagged: cbFlagged, reviewQueueId: cbReviewId } = await logAiCall(
        { triggerType: "chargeback-copilot", actorType: (req as any).user?.role || "agent", actorId: (req as any).user?.id?.toString(), rawPrompt: JSON.stringify(chargebackMessages) },
        () => openai.chat.completions.create({
          model: "gpt-5",
          messages: chargebackMessages,
          max_completion_tokens: 8000,
          response_format: { type: "json_object" },
        })
      );

      const raw = completion.choices[0]?.message?.content || "{}";
      let packet: any;
      try {
        packet = JSON.parse(raw);
      } catch {
        return res.status(500).json({ message: "AI returned malformed response. Please try again." });
      }

      const aiEvidencePacket = {
        rebuttalletter: packet.rebuttalletter || "",
        evidenceChecklist: packet.evidenceChecklist || [],
        winLikelihood: packet.winLikelihood || { estimate: "Unknown", rationale: "" },
        reasonCodeContext: packet.reasonCodeContext || "",
        generatedAt: new Date().toISOString(),
        merchantProfile: contact ? {
          merchantName: contact.companyName || `${contact.firstName} ${contact.lastName}`,
          address: contact.address || undefined,
          city: contact.city || undefined,
          state: contact.state || undefined,
          website: contact.website || undefined,
          vertical: contact.vertical || undefined,
          mid: deal?.mid || undefined,
        } : undefined,
        auditTrail: {
          systemPrompt,
          userPrompt,
          rawModelOutput: raw,
          model: completion.model || "gpt-5",
          promptTokens: completion.usage?.prompt_tokens,
          completionTokens: completion.usage?.completion_tokens,
          generatedByUserId: (req as any).user?.id?.toString(),
          generatedByRole: (req as any).user?.role,
        },
      };

      const updated = await storage.updateChargeback(chargebackId, {
        aiEvidencePacket: aiEvidencePacket as any,
      });

      await storage.createAuditLog({
        action: "chargeback_ai_packet_generated",
        entityType: "chargeback",
        entityId: chargebackId,
        details: {
          reasonCode: cb.reasonCode,
          cardBrand: cb.cardBrand,
          winLikelihood: aiEvidencePacket.winLikelihood.estimate,
          checkedItems: aiEvidencePacket.evidenceChecklist.length,
          model: aiEvidencePacket.auditTrail.model,
          promptTokens: aiEvidencePacket.auditTrail.promptTokens,
          completionTokens: aiEvidencePacket.auditTrail.completionTokens,
          generatedByUserId: aiEvidencePacket.auditTrail.generatedByUserId,
          midStatsRecordsUsed: recentMidStats.length,
          evidenceFilesCount: ((cb.evidenceFiles as any[]) || []).length,
        },
      });

      res.json({ packet: aiEvidencePacket, chargeback: updated, _flagged: cbFlagged, _reviewQueueId: cbReviewId });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Chargeback copilot error" });
    }
  });

  app.patch("/api/ai/chargeback-copilot/:id/finalize", isDashboardUser, async (req, res) => {
    try {
      const chargebackId = Number(req.params.id);
      const { editedRebuttal, editedChecklist } = req.body;
      const cb = await storage.getChargeback(chargebackId);
      if (!cb) return res.status(404).json({ message: "Not found" });

      const existing = cb.aiEvidencePacket as any;
      if (!existing) return res.status(400).json({ message: "No AI packet exists for this chargeback. Generate one first." });

      const now = new Date().toISOString();
      const hadEdits = (!!editedRebuttal && editedRebuttal !== existing.rebuttalletter) ||
        (Array.isArray(editedChecklist) && JSON.stringify(editedChecklist) !== JSON.stringify(existing.evidenceChecklist));

      const updated = await storage.updateChargeback(chargebackId, {
        aiEvidencePacket: {
          ...existing,
          editedRebuttal: editedRebuttal || existing.rebuttalletter,
          evidenceChecklist: Array.isArray(editedChecklist) ? editedChecklist : existing.evidenceChecklist,
          finalizedAt: now,
          finalizationTrail: {
            finalizedByUserId: (req as any).user?.id?.toString(),
            finalizedByRole: (req as any).user?.role,
            hadEdits,
            finalizedAt: now,
          },
        } as any,
      });

      await storage.createAuditLog({
        action: "chargeback_ai_packet_finalized",
        entityType: "chargeback",
        entityId: chargebackId,
        details: {
          finalizedAt: now,
          hadEdits,
          finalizedByUserId: (req as any).user?.id?.toString(),
          finalizedByRole: (req as any).user?.role,
        },
      });

      res.json({ chargeback: updated });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === AI AUDIT LOGS ===
  app.get("/api/operator/ai-audit", isDashboardUser, async (req, res) => {
    try {
      const { triggerType, startDate, endDate, limit, offset, flaggedOnly } = req.query;
      const filters: Parameters<typeof storage.getAiAuditLogs>[0] = {
        limit: limit ? Math.min(Number(limit), 200) : 50,
        offset: offset ? Number(offset) : 0,
      };
      if (triggerType && triggerType !== "all") filters.triggerType = String(triggerType);
      if (startDate) filters.startDate = new Date(String(startDate));
      if (endDate) filters.endDate = new Date(String(endDate));
      if (flaggedOnly === "true") filters.flaggedOnly = true;

      const totalsFilters: Parameters<typeof storage.getAiAuditLogTotals>[0] = {};
      if (startDate) totalsFilters.startDate = new Date(String(startDate));
      if (endDate) totalsFilters.endDate = new Date(String(endDate));

      const [logs, totals] = await Promise.all([
        storage.getAiAuditLogs(filters),
        storage.getAiAuditLogTotals(totalsFilters),
      ]);
      res.json({ logs, totals });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === AI HEALTH METRICS ===
  app.get("/api/operator/ai-health", isDashboardUser, async (req, res) => {
    try {
      const { startDate, endDate, range } = req.query;
      let start: Date | undefined;
      let end: Date | undefined;

      if (range) {
        const now = new Date();
        if (range === "24h") {
          start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        } else if (range === "7d") {
          start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        } else if (range === "30d") {
          start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        } else if (range === "today") {
          start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        }
      } else {
        if (startDate) start = new Date(String(startDate));
        if (endDate) end = new Date(String(endDate));
      }

      const metrics = await storage.getAiHealthMetrics(start, end);
      res.json(metrics);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === AI AUDIT LOG DETAIL ===
  app.get("/api/operator/ai-audit/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const log = await storage.getAiAuditLog(Number(req.params.id));
      if (!log) return res.status(404).json({ message: "Log not found" });
      res.json(log);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === AI PROMPT REPLAY ===
  app.post("/api/operator/ai-audit/:id/replay", requireRole("admin", "manager"), async (req, res) => {
    try {
      const log = await storage.getAiAuditLog(Number(req.params.id));
      if (!log) return res.status(404).json({ message: "Log not found" });
      if (!log.rawPrompt) return res.status(400).json({ message: "No raw prompt stored for this log entry. Replay requires prompt storage." });

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const model = log.model || "gpt-5";
      const start = Date.now();

      let messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      try {
        const parsed = JSON.parse(log.rawPrompt);
        if (Array.isArray(parsed)) {
          messages = parsed;
        } else {
          messages = [{ role: "user", content: log.rawPrompt }];
        }
      } catch {
        messages = [{ role: "user", content: log.rawPrompt }];
      }

      const completion = await openai.chat.completions.create({
        model,
        messages,
        max_completion_tokens: 5000,
      });

      const durationMs = Date.now() - start;
      const newResponse = completion.choices?.[0]?.message?.content || "";
      const usage = completion.usage;

      res.json({
        originalResponse: log.rawResponse,
        newResponse,
        originalLogId: log.id,
        model,
        durationMs,
        usage: {
          promptTokens: usage?.prompt_tokens || 0,
          completionTokens: usage?.completion_tokens || 0,
        },
        diff: {
          changed: newResponse !== log.rawResponse,
          originalLength: (log.rawResponse || "").length,
          newLength: newResponse.length,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Replay failed" });
    }
  });

}
