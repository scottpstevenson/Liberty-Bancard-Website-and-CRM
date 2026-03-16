import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { contacts } from "@shared/schema";
import { and } from "drizzle-orm";
import { notifyRepWithBriefing, sendProposalEmail } from "../services/proposal-engine";
import { parse } from "csv-parse/sync";
import path from "path";
import type { ProposalData, ProposalPlan } from "./helpers";

export function registerAiRoutes(app: Express) {
  // === AI ADVISOR ===
  app.post("/api/ai/chat", isAuthenticated, async (req, res) => {
    try {
      const { department, messages } = req.body;
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
        sales: "You are the Sales Advisor. Prioritize statement upload + booked calls; draft follow-ups; recommend offer path based on vertical and volume.",
        support: "You are the Support Advisor. Classify tickets by category (Funding, Terminal, Chargeback, PCI, Other); request missing details; suggest macro response; escalate urgent issues.",
        onboarding: "You are the Onboarding Advisor. Generate doc checklists; go-live plans; terminal setup steps; Day 2/7/14/30 check-in messages.",
        marketing: "You are the Marketing Advisor. Create weekly content plans; repurpose proof into briefs; draft landing page variants; write ad copy (no claims without proof).",
        finance: "You are the Finance Advisor. Provide reconciliation checklists; commission tracking guidance; anomaly detection tips. Never give tax advice.",
        compliance: "You are the Compliance Advisor. Review copy and messages for claim risk; ensure disclaimers and consent language are present.",
        executive: "You are the Executive Advisor. Provide weekly KPI digests + bottleneck analysis + recommended changes (approval required for all external changes).",
      };

      const systemPrompt = `${basePrompt}\n\n${departmentPrompts[department] || departmentPrompts.sales}`;

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          ...(messages || []).map((m: any) => ({ role: m.role, content: m.content })),
        ],
        max_tokens: 1500,
      });

      res.json({ response: completion.choices[0]?.message?.content || "No response generated." });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "AI service error" });
    }
  });


  // === AI DASHBOARD COPILOT ===
  app.post("/api/ai/insights", isAuthenticated, async (req, res) => {
    try {
      const [allDeals, allTickets, allContacts, allTasks, allProspects] = await Promise.all([
        storage.getDeals(),
        storage.getTickets(),
        storage.getContacts(),
        storage.getTasks(),
        storage.getProspects(),
      ]);

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

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
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
          { role: "user", content: dataContext }
        ],
        max_tokens: 800,
      });

      res.json({ insights: completion.choices[0]?.message?.content || "No insights available." });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "AI insights error" });
    }
  });


  // === AI EMAIL COMPOSER ===
  app.post("/api/ai/compose-email", isAuthenticated, async (req, res) => {
    try {
      const { contactId, prospectId, context, tone } = req.body;

      let recipientData = "";
      if (contactId) {
        const contact = await storage.getContact(Number(contactId));
        if (contact) recipientData = `Recipient: ${contact.firstName} ${contact.lastName}, Company: ${contact.companyName || "N/A"}, Email: ${contact.email}, Status: ${contact.status}, Vertical: ${contact.vertical || "N/A"}`;
      } else if (prospectId) {
        const prospect = await storage.getProspect(Number(prospectId));
        if (prospect) recipientData = `Prospect: ${prospect.companyName}, Contact: ${prospect.ownerFirstName || ""} ${prospect.ownerLastName || ""}, Email: ${prospect.email || "N/A"}, Vertical: ${prospect.vertical || "N/A"}, Score: ${prospect.score || "N/A"}, Website: ${prospect.website || "N/A"}`;
      }

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are Liberty Bancard's AI Email Composer. Draft a professional outreach email.
RULES:
- Tone: ${tone || "consultative and professional"}
- Never promise savings without statement review
- Include this disclaimer at the bottom: "Eligibility, underwriting, card brand rules, and applicable laws apply."
- Keep subject line under 60 characters
- Email body should be 3-5 short paragraphs
- Be value-first: lead with what you can do for them
- End with a clear call-to-action (book a call or reply)
FORMAT your response as JSON: {"subject": "...", "body": "..."}`
          },
          { role: "user", content: `${recipientData}\n\nAdditional context: ${context || "General outreach for payment processing services."}` }
        ],
        max_tokens: 800,
      });

      const raw = completion.choices[0]?.message?.content || "";
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { subject: "Liberty Bancard - Let's Talk Processing", body: raw };
        res.json(parsed);
      } catch {
        res.json({ subject: "Liberty Bancard - Let's Talk Processing", body: raw });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Email compose error" });
    }
  });


  // === AI SMART TASK GENERATOR ===
  app.post("/api/ai/generate-tasks", isAuthenticated, async (req, res) => {
    try {
      const [allDeals, allTickets, allTasks, allContacts] = await Promise.all([
        storage.getDeals(),
        storage.getTickets(),
        storage.getTasks(),
        storage.getContacts(),
      ]);

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

      const created = [];
      for (const task of newTasks.slice(0, 10)) {
        const result = await storage.createTask({
          title: task.title,
          description: task.description,
          priority: task.priority,
          status: "pending",
          dueDate: task.dueDate,
        });
        created.push(result);
      }

      res.json({ generated: created.length, tasks: created });
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

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
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
            role: "user",
            content: `Subject: ${ticket.subject}\nDescription: ${ticket.description}\nCurrent Category: ${ticket.category}\nCurrent Priority: ${ticket.priority}`
          }
        ],
        max_tokens: 600,
      });

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
      const { contactId, dealId, statementData } = req.body;
      if (!statementData) return res.status(400).json({ message: "statementData required" });

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are Liberty Bancard's AI Statement Analyst. Analyze merchant processing statement data and provide a detailed fee analysis.
RULES:
- Never promise specific savings without full statement review
- Include disclaimer: "Eligibility, underwriting, card brand rules, and applicable laws apply."
- Be specific about fee types and rates found
- Recommend the best offer path based on the data

Return JSON with:
- effectiveRate: estimated effective rate as percentage string
- monthlyVolume: estimated monthly volume
- currentFees: object with fee breakdowns { interchange: string, markup: string, monthlyFees: string, pciFees: string, otherFees: string }
- recommendedPath: one of ["Cash Discount", "Dual Pricing", "Tiered Reduction", "Interchange Plus"]
- keyFindings: array of 3-5 specific findings about their current processing
- riskFlags: array of any concerning items (high rates, non-compliant fees, etc.)
- nextSteps: array of recommended next steps
- overallAssessment: 2-3 sentence summary`
          },
          { role: "user", content: `Statement Data:\n${typeof statementData === 'string' ? statementData : JSON.stringify(statementData)}` }
        ],
        max_tokens: 1000,
      });

      const raw = completion.choices[0]?.message?.content || "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { overallAssessment: raw };

      if (dealId) {
        await storage.updateDeal(Number(dealId), {
          effectiveRate: analysis.effectiveRate,
          recommendedPath: analysis.recommendedPath,
        });
      }

      await storage.createAuditLog({
        action: "statement_analyzed",
        entityType: dealId ? "deal" : "contact",
        entityId: dealId ? Number(dealId) : (contactId ? Number(contactId) : undefined),
        details: analysis,
      });

      res.json(analysis);
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

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
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
            role: "user",
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
        ],
        max_tokens: 2000,
      });

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
      });

      await storage.createAuditLog({
        action: "proposal_generated",
        entityType: "deal",
        entityId: deal.id,
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

      res.json(proposal);
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
      const allDeals = await storage.getDeals();
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

      await storage.updateDeal(dealId, { savingsProposal: existing });
      await storage.createAuditLog({
        action: "proposal_edited",
        entityType: "deal",
        entityId: dealId,
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
      res.json(setting || { enabled: true });
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
      const allDeals = await storage.getDeals();
      const onboardingDeals = allDeals.filter(d => d.pipeline === "onboarding" && d.stage !== "Cancelled");
      const allTasks = await storage.getTasks();

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

        return {
          dealId: deal.id,
          contactId: deal.contactId,
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

}
