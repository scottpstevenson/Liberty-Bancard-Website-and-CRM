import type { Express } from "express";
import { isAuthenticated, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { contacts, insertCalendarEventSchema, insertCallLogSchema, insertCommentSchema, insertEmailLogSchema, insertNoteSchema } from "@shared/schema";
import { and } from "drizzle-orm";
import { sendGhlEmail, sendGhlSms } from "../services/ghl";
import { advanceDealStage } from "../services/deal-stage-service";
import { parse } from "csv-parse/sync";
import { logAiCall } from "../services/ai-audit-logger";
import { resolveCollateralPacket } from "../services/workflow-executor";

export function registerActivityRoutes(app: Express) {

  // === STATEMENT UPLOAD CHAIN FAILURES (Operator Dashboard) ===
  app.get("/api/operator/statement-upload-failures", requireRole("admin", "manager"), async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const allLogs = await storage.getAuditLogs({ limit: 500 });
      const failures = allLogs
        .filter(l => l.action === "statement_chain_step_failed")
        .slice(0, limit)
        .map(l => {
          const d = (l.details || {}) as Record<string, unknown>;
          return {
            id: l.id,
            dealId: l.entityId || null,
            step: d.step ?? null,
            stepName: d.stepName ?? null,
            error: d.error ?? null,
            timestamp: d.timestamp ?? l.createdAt,
            createdAt: l.createdAt,
          };
        });
      res.json(failures);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === ACTIVITY TIMELINE ===
  app.get("/api/activity", isAuthenticated, async (req, res) => {
    try {
      const { entityType, entityId } = req.query;
      const allLogs = await storage.getAuditLogs();
      let filtered = allLogs;
      if (entityType && entityId) {
        filtered = allLogs.filter(l =>
          l.entityType === entityType && l.entityId === Number(entityId)
        );
      }
      const ghlLogs = await storage.getGhlActivityLogs(entityType === "contact" && entityId ? Number(entityId) : undefined);
      const timeline = [
        ...filtered.map(l => ({
          id: `audit-${l.id}`,
          type: "audit" as const,
          action: l.action,
          entityType: l.entityType,
          entityId: l.entityId,
          details: l.details,
          createdAt: l.createdAt,
        })),
        ...ghlLogs.map(g => ({
          id: `ghl-${g.id}`,
          type: "ghl" as const,
          action: g.channel,
          entityType: "contact",
          entityId: g.contactId,
          details: { direction: g.direction, channel: g.channel, subject: g.subject },
          createdAt: g.createdAt,
        })),
      ];
      timeline.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      res.json(timeline.slice(0, 100));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === CONTACT ACTIVITY TIMELINE ===
  app.get("/api/contacts/:id/activity", isAuthenticated, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const events: any[] = [];

      const auditEntries = await storage.getAuditLogs();
      const contactAudit = auditEntries.filter(a =>
        (a.entityType === "contact" && a.entityId === contactId) ||
        (a.details as any)?.contactId === contactId
      );
      contactAudit.forEach(a => {
        events.push({
          id: `audit_${a.id}`,
          type: "audit",
          action: a.action,
          entityType: a.entityType,
          entityId: a.entityId || 0,
          details: a.details || {},
          createdAt: a.createdAt,
        });
      });

      const contactNotes = await storage.getNotes("contact", contactId);
      contactNotes.forEach(n => {
        events.push({
          id: `note_${n.id}`,
          type: "note",
          action: "note_added",
          entityType: "note",
          entityId: n.id,
          details: { content: (n.content || "").substring(0, 200), author: n.authorId || "" },
          createdAt: n.createdAt,
        });
      });

      const contactEmails = await storage.getEmailLogs(contactId);
      contactEmails.forEach(e => {
        events.push({
          id: `email_${e.id}`,
          type: "ghl",
          action: "email",
          entityType: "email",
          entityId: e.id,
          details: { subject: e.subject, direction: e.direction, status: e.status },
          createdAt: e.createdAt,
        });
      });

      const contactCalls = await storage.getCallLogs(contactId);
      contactCalls.forEach(c => {
        events.push({
          id: `call_${c.id}`,
          type: "call",
          action: "call_logged",
          entityType: "call",
          entityId: c.id,
          details: { outcome: c.outcome, duration: c.duration, notes: (c as any).notes },
          createdAt: c.createdAt,
        });
      });

      events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.json(events);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === NOTES ===
  app.get("/api/notes", isAuthenticated, async (req, res) => {
    try {
      const { entityType, entityId } = req.query;
      if (!entityType || !entityId) return res.status(400).json({ message: "entityType and entityId required" });
      const notesList = await storage.getNotes(String(entityType), Number(entityId));
      res.json(notesList);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/notes", isAuthenticated, async (req, res) => {
    try {
      const input = insertNoteSchema.parse(req.body);
      const note = await storage.createNote(input);
      res.status(201).json(note);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/notes/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.deleteNote(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === COMMENTS (Threaded) ===
  app.get("/api/comments", isAuthenticated, async (req, res) => {
    const { entityType, entityId } = req.query;
    if (!entityType || !entityId) return res.status(400).json({ message: "entityType and entityId required" });
    const result = await storage.getComments(String(entityType), Number(entityId));
    res.json(result);
  });

  app.post("/api/comments", isAuthenticated, async (req, res) => {
    try {
      const input = insertCommentSchema.parse(req.body);
      const comment = await storage.createComment({
        ...input,
        authorId: (req.user as any)?.id || null,
        authorName: (req.user as any)?.firstName ? `${(req.user as any).firstName} ${(req.user as any).lastName || ''}`.trim() : (req.user as any)?.email || 'System',
      });
      res.status(201).json(comment);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.delete("/api/comments/:id", isAuthenticated, async (req, res) => {
    await storage.deleteComment(Number(req.params.id));
    res.json({ success: true });
  });

  app.put("/api/comments/:id", isAuthenticated, async (req, res) => {
    const updated = await storage.updateComment(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });


  // === EMAIL LOGS ===
  app.get("/api/email-logs", isAuthenticated, async (req, res) => {
    const contactId = req.query.contactId ? Number(req.query.contactId) : undefined;
    const logs = await storage.getEmailLogs(contactId);
    res.json(logs);
  });

  app.get("/api/email-logs/contact/:contactId", isAuthenticated, async (req, res) => {
    const logs = await storage.getEmailLogs(Number(req.params.contactId));
    res.json(logs);
  });

  app.post("/api/email-logs", isAuthenticated, async (req, res) => {
    try {
      const input = insertEmailLogSchema.parse(req.body);
      const log = await storage.createEmailLog(input);
      await storage.createAuditLog({ action: "email_logged", entityType: "contact", entityId: log.contactId || 0, details: { direction: log.direction, subject: log.subject || "" } });
      res.status(201).json(log);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });


  // === CALL LOGS ===
  app.get("/api/call-logs", isAuthenticated, async (req, res) => {
    const contactId = req.query.contactId ? Number(req.query.contactId) : undefined;
    const logs = await storage.getCallLogs(contactId);
    res.json(logs);
  });

  app.get("/api/call-logs/contact/:contactId", isAuthenticated, async (req, res) => {
    const logs = await storage.getCallLogs(Number(req.params.contactId));
    res.json(logs);
  });

  app.post("/api/call-logs", isAuthenticated, async (req, res) => {
    try {
      const input = insertCallLogSchema.parse(req.body);
      const log = await storage.createCallLog(input);
      await storage.createAuditLog({ action: "call_logged", entityType: "contact", entityId: log.contactId || 0, details: { direction: log.direction, outcome: log.outcome || "", duration: String(log.duration || 0) } });
      if (log.outcome === "Appointment Set" || log.outcome === "Interested") {
        await storage.createNotification({ channel: "internal", title: "Positive Call Outcome", message: `Call with contact #${log.contactId}: ${log.outcome}`, type: "info", metadata: { contactId: log.contactId || undefined, entityType: "contact", entityId: log.contactId || undefined } });
      }
      res.status(201).json(log);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.post("/api/call-follow-ups/generate", isAuthenticated, async (req, res) => {
    try {
      const { contactId, dealId, outcome, callNotes, firefliesRecap, duration } = req.body;
      if (!contactId || !outcome) return res.status(400).json({ message: "contactId and outcome are required" });

      const contact = await storage.getContact(Number(contactId));
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      let deal = null;
      if (dealId) deal = await storage.getDeal(Number(dealId));

      const contactName = `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "there";
      const companyName = contact.companyName || "";
      const vertical = contact.vertical || "";
      const monthlyVolume = contact.monthlyVolume || deal?.totalVolume || "";

      const outcomeContext: Record<string, string> = {
        "Connected - Send Review Summary": "The merchant had a good call and wants to see a summary of how Liberty Bancard can save them money. They're interested but want to see the numbers. Follow up should reference the conversation specifics and promise the detailed review is coming.",
        "Connected - Needs Proposal": "The merchant is ready for a formal proposal. They're comparing options and want specifics on pricing. Follow up should be confident, reference what was discussed, and set expectations for when they'll receive the proposal.",
        "Connected - Not a Fit": "The merchant isn't a match for our services right now. Send a polite, professional wrap-up thanking them for their time. Leave the door open in case things change.",
        "No Show": "The merchant missed the scheduled call. Follow up should be understanding (not guilt-trippy), offer to reschedule, and gently convey that you had valuable info to share.",
        "Not Now (Nurture)": "The merchant is interested but the timing isn't right. Maybe they're in a contract, busy season, or just not ready to switch. Follow up should be warm, no-pressure, and position you as someone they can reach out to when they're ready.",
        "Closed Won": "Congratulations! The merchant signed up. Send a warm welcome message, set expectations for onboarding next steps, and make them feel confident about their decision.",
        "Closed Lost": "The merchant decided to go another direction. Send a gracious, professional message. No hard feelings. Leave the door open and wish them well.",
      };

      const context = outcomeContext[outcome] || "Follow up after a sales call. Be professional and personable.";

      const recapSection = firefliesRecap
        ? `\n\nCALL TRANSCRIPT/RECAP FROM FIREFLIES:\n${firefliesRecap.slice(0, 3000)}`
        : "";
      const notesSection = callNotes ? `\n\nAGENT'S CALL NOTES:\n${callNotes}` : "";

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const autoReplyMessages = [
        {
          role: "system" as const,
          content: `You are a sales follow-up writer for Liberty Bancard, a merchant payment processing company. You write follow-up emails and texts that sound like they're from a real person — not a template, not a bot.

Rules:
- Use the merchant's first name naturally
- Reference specific things from the call if recap/notes are provided
- Keep SMS under 300 characters, conversational, no formal sign-offs
- Emails should be 3-5 short paragraphs, warm but professional
- Never use phrases like "per our conversation" or "as discussed" — those sound corporate
- Include the phone number 954-266-8214 for direct contact
- Sign emails as "The Liberty Bancard Team" or the agent's name if available
- For SMS, end with "- Liberty Bancard" and "Reply STOP to opt out"
- Never promise specific savings percentages or make unsubstantiated claims
- Always include: "Reply STOP to opt out" in SMS messages`
        },
        {
          role: "user" as const,
          content: `Generate a follow-up email AND SMS for this sales call:

MERCHANT: ${contactName}${companyName ? ` (${companyName})` : ""}
INDUSTRY: ${vertical || "Not specified"}
MONTHLY VOLUME: ${monthlyVolume || "Not specified"}
CALL OUTCOME: ${outcome}
CALL DURATION: ${duration ? `${duration} minutes` : "Not recorded"}

CONTEXT: ${context}${recapSection}${notesSection}

Respond in this exact JSON format:
{
  "emailSubject": "...",
  "emailBody": "...",
  "smsBody": "...",
  "callSummary": "Brief 2-3 sentence summary of the call for internal records",
  "nextSteps": "What should happen next with this lead",
  "sentiment": "positive/neutral/negative"
}`
        },
      ];
      const { completion: aiResponse, flagged: autoReplyFlagged, reviewQueueId: autoReplyReviewId } = await logAiCall(
        { triggerType: "auto-reply", actorType: (req as any).user?.role || "agent", actorId: (req as any).user?.id?.toString(), rawPrompt: JSON.stringify(autoReplyMessages) },
        () => openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0.7,
          messages: autoReplyMessages,
        }));

      let parsed;
      try {
        const raw = aiResponse.choices[0]?.message?.content || "{}";
        const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = {
          emailSubject: `Following up on our call, ${contactName}`,
          emailBody: `Hi ${contactName},\n\nThanks for taking the time to chat today. I wanted to follow up while everything's fresh.\n\nI'll be pulling together the details we talked about and will have something over to you shortly. In the meantime, if anything comes to mind or you have questions, just reply here or call me directly at 954-266-8214.\n\nTalk soon,\nThe Liberty Bancard Team`,
          smsBody: `Hey ${contactName}, thanks for the call today! I'll have those details over to you soon. Questions? Call me at 954-266-8214. - Liberty Bancard. Reply STOP to opt out`,
          callSummary: `Call with ${contactName}. Outcome: ${outcome}.`,
          nextSteps: "Follow up with details discussed on the call.",
          sentiment: "neutral",
        };
      }

      res.json({
        email: {
          subject: parsed.emailSubject || `Following up, ${contactName}`,
          body: parsed.emailBody || "",
        },
        sms: {
          body: parsed.smsBody || "",
        },
        callSummary: parsed.callSummary || "",
        nextSteps: parsed.nextSteps || "",
        sentiment: parsed.sentiment || "neutral",
        contactName,
        companyName,
        _flagged: autoReplyFlagged,
        _reviewQueueId: autoReplyReviewId,
      });
    } catch (err: any) {
      console.error("Follow-up generation error:", err);
      res.status(500).json({ message: err.message || "Failed to generate follow-ups" });
    }
  });

  app.post("/api/call-follow-ups/send", isAuthenticated, async (req, res) => {
    try {
      const {
        contactId, dealId, outcome, callNotes, firefliesRecap, duration,
        emailSubject, emailBody, smsBody,
        sendEmail, sendSms,
        callSummary, nextSteps, sentiment,
        nextFollowUpDate,
        interestedIn0Percent, needsTerminal, sendPacketNow, packetId,
      } = req.body;

      if (!contactId || !outcome) return res.status(400).json({ message: "contactId and outcome are required" });

      const contact = await storage.getContact(Number(contactId));
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      const OUTCOME_TO_STAGE: Record<string, string> = {
        "Connected - Send Review Summary": "Review In Progress",
        "Connected - Needs Proposal": "Proposal Sent",
        "Connected - Not a Fit": "Closed Lost",
        "No Show": "Negotiation / Follow-Up",
        "Not Now (Nurture)": "Nurture / Not Now",
        "Closed Won": "Closed Won",
        "Closed Lost": "Closed Lost",
      };

      const callLog = await storage.createCallLog({
        contactId: Number(contactId),
        dealId: dealId ? Number(dealId) : undefined,
        direction: "outbound",
        duration: duration ? Number(duration) : undefined,
        outcome,
        summary: callNotes || undefined,
        aiSummary: callSummary || undefined,
        nextSteps: nextSteps || undefined,
        sentiment: sentiment || undefined,
        metadata: firefliesRecap ? { firefliesRecap: firefliesRecap.slice(0, 5000) } : undefined,
      });

      await storage.createAuditLog({
        action: "call_logged",
        entityType: "contact",
        entityId: Number(contactId),
        details: { direction: "outbound", outcome, duration: String(duration || 0), hasRecap: !!firefliesRecap },
      });

      if (dealId) {
        const newStage = OUTCOME_TO_STAGE[outcome];
        if (newStage) {
          await advanceDealStage(Number(dealId), newStage, "call_log_outcome");
          if (nextFollowUpDate) {
            await storage.updateDeal(Number(dealId), { nextFollowUp: new Date(nextFollowUpDate) });
          }
        }
      }

      let emailSent = false;
      let smsSent = false;
      // Truthful SMS result state — the UI must never say "sent" unless a real
      // provider send was attempted and confirmed successful.
      let smsResult: "sent" | "not_configured" | "failed" | "skipped" = "skipped";
      let smsMessage = "Follow-up SMS was not requested.";

      if (sendEmail && emailBody && contact.email) {
        try {
          const { sendGhlEmail } = await import("../services/ghl");
          const result = await sendGhlEmail({
            contactId: Number(contactId),
            subject: emailSubject || "Following up on our call",
            body: emailBody,
          });
          emailSent = result?.success === true;
        } catch (emailErr: any) {
          console.log("[Call Follow-Up] GHL email not configured, logging locally:", emailErr.message);
        }
        if (!emailSent) {
          await storage.createEmailLog({
            contactId: Number(contactId),
            dealId: dealId ? Number(dealId) : undefined,
            direction: "outbound",
            subject: emailSubject || "Following up on our call",
            body: emailBody,
            status: "pending",
          });
          emailSent = true;
        }
      }

      if (sendSms) {
        const { isGhlConfigured } = await import("../services/ghl");
        if (!smsBody) {
          smsResult = "skipped";
          smsMessage = "Follow-up SMS was not sent — no message body was provided.";
        } else if (!contact.phone) {
          smsResult = "skipped";
          smsMessage = "Follow-up SMS was not sent — contact has no phone number on file.";
        } else if (!contact.consentSms) {
          smsResult = "skipped";
          smsMessage = "Follow-up SMS was not sent — contact has not consented to SMS.";
        } else if (!isGhlConfigured()) {
          smsResult = "not_configured";
          smsMessage = "Follow-up SMS was not sent — SMS provider is not configured.";
        } else {
          try {
            const { sendGhlSms } = await import("../services/ghl");
            const result = await sendGhlSms({
              contactId: Number(contactId),
              body: smsBody,
            });
            if (result?.success === true) {
              smsSent = true;
              smsResult = "sent";
              smsMessage = "Follow-up SMS sent.";
            } else {
              smsResult = "failed";
              smsMessage = `Follow-up SMS failed to send${result?.error ? `: ${result.error}` : "."}`;
            }
          } catch (smsErr: any) {
            console.log("[Call Follow-Up] SMS send error:", smsErr.message);
            smsResult = "failed";
            smsMessage = `Follow-up SMS failed to send: ${smsErr.message}`;
          }
        }
      }

      if (nextFollowUpDate) {
        await storage.createTask({
          contactId: Number(contactId),
          dealId: dealId ? Number(dealId) : undefined,
          title: `Follow up: ${outcome} - ${contact.firstName} ${contact.lastName || ""}`.trim(),
          description: nextSteps || `Follow up after call. Outcome: ${outcome}`,
          dueDate: new Date(nextFollowUpDate),
          priority: "normal",
        });
      }

      // Truthful packet-send state — mirrors the smsResult pattern above.
      // The rep may optionally override which packet gets sent via
      // `packetId`; otherwise it falls back to the same
      // offerPath -> vertical -> General/Local Business resolution used by
      // the automated send_packet workflow action.
      let packetResult: "sent" | "not_requested" | "not_configured" | "no_match" | "failed" = "not_requested";
      let packetMessage = "Packet send was not requested.";
      let packetName: string | null = null;
      if (sendPacketNow) {
        const { isGhlConfigured } = await import("../services/ghl");
        if (!isGhlConfigured()) {
          packetResult = "not_configured";
          packetMessage = "Packet was not sent — email provider is not configured.";
        } else {
          const packets = await storage.getCollateralPackets();
          const deal = dealId ? await storage.getDeal(Number(dealId)) : undefined;
          const matchedPacket = resolveCollateralPacket(packets, {
            packetId: packetId ? Number(packetId) : undefined,
            deal,
          });
          if (!matchedPacket) {
            packetResult = "no_match";
            packetMessage = "Packet was not sent — no matching collateral packet was found.";
          } else {
            packetName = matchedPacket.name;
            try {
              const result = await sendGhlEmail({
                contactId: Number(contactId),
                dealId: dealId ? Number(dealId) : undefined,
                subject: `Your Custom Pricing Breakdown - ${matchedPacket.name}`,
                body: `<p>Hi {{contact.firstName}},</p><p>Here is your personalized information packet.</p><p>Best,<br/>Liberty Bancard</p><p style="font-size:11px;color:#999;">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>`,
              });
              if (result?.success) {
                packetResult = "sent";
                packetMessage = `Packet sent: ${matchedPacket.name}.`;
              } else {
                packetResult = "failed";
                packetMessage = `Packet failed to send${result?.error ? `: ${result.error}` : "."}`;
              }
            } catch (packetErr: any) {
              packetResult = "failed";
              packetMessage = `Packet failed to send: ${packetErr.message}`;
            }
          }
        }
        await storage.createAuditLog({
          action: "call_outcome_packet_send",
          entityType: "contact",
          entityId: Number(contactId),
          details: { dealId: dealId ? Number(dealId) : undefined, packetIdOverride: packetId ? Number(packetId) : undefined, packetResult, packetName },
        });
      }

      const OUTCOME_TO_SEQUENCE: Record<string, string> = {
        "Connected - Send Review Summary": "Post-Call Review Follow-Up",
        "Connected - Needs Proposal": "Proposal Follow-Up",
        "No Show": "No-Show Reschedule",
        "Not Now (Nurture)": "Long-Term Nurture",
      };

      let sequenceEnrolled: string | null = null;
      if (sendEmail || sendSms) {
        const sequenceName = OUTCOME_TO_SEQUENCE[outcome];
        if (sequenceName) {
          const allSequences = await storage.getFollowUpSequences();
          const matchedSeq = allSequences.find((s) => s.name === sequenceName);
          if (matchedSeq) {
            await storage.createSequenceEnrollment({
              sequenceId: matchedSeq.id,
              contactId: Number(contactId),
              currentStep: 0,
              status: "active",
            });
            sequenceEnrolled = sequenceName;
          }
        }
      }

      const isPositive = ["Connected - Send Review Summary", "Connected - Needs Proposal", "Closed Won"].includes(outcome);
      if (isPositive) {
        await storage.createNotification({
          channel: "#sales",
          title: "Positive Call Outcome",
          message: `${contact.firstName} ${contact.lastName || ""} (${contact.companyName || "N/A"}) — ${outcome}. ${nextSteps || ""}`.trim(),
          type: "info",
          metadata: { contactId: Number(contactId), dealId: dealId ? Number(dealId) : undefined, callLogId: callLog.id },
        });
      }

      res.json({
        success: true,
        callLogId: callLog.id,
        emailSent,
        smsSent,
        smsResult,
        smsMessage,
        packetResult,
        packetMessage,
        packetName,
        stageUpdated: !!dealId && !!OUTCOME_TO_STAGE[outcome],
        newStage: dealId ? (OUTCOME_TO_STAGE[outcome] || null) : null,
        sequenceEnrolled,
      });
    } catch (err: any) {
      console.error("Call follow-up send error:", err);
      res.status(500).json({ message: err.message || "Failed to process call follow-up" });
    }
  });


  // === CALENDAR EVENTS ===
  app.get("/api/calendar-events", isAuthenticated, async (req, res) => {
    try {
      const { start, end } = req.query;
      if (start && end) {
        const events = await storage.getCalendarEventsByDateRange(new Date(start as string), new Date(end as string));
        res.json(events);
      } else {
        const events = await storage.getCalendarEvents();
        res.json(events);
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/calendar-events", isAuthenticated, async (req, res) => {
    try {
      const input = insertCalendarEventSchema.parse(req.body);
      const event = await storage.createCalendarEvent(input);
      res.status(201).json(event);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.put("/api/calendar-events/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateCalendarEvent(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/calendar-events/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.deleteCalendarEvent(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

}
