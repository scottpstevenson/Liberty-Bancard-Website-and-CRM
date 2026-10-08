import type { Express } from "express";
import crypto from "crypto";
import { isAuthenticated, isDashboardUser, isAdmin, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { serverError, safeMessage } from "../utils/server-error";
import { getRoundRobinPool, assignNextRep, mutateRoundRobinPool, getEligibleRoundRobinReps } from "../services/round-robin-policy";
import { resolveWorkAssignee, WorkCommandError } from "../services/work-item-command";
import { canAccessOwner } from "../services/crm-object-access";
import { db } from "../db";
import { contacts } from "@shared/schema";
import { inArray } from "drizzle-orm";
export {getRoundRobinPool,assignNextRep};

const GHL_API_BASE = "https://services.leadconnectorhq.com";

function getGhlConfig() {
  const apiKey = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) return null;
  return { apiKey, locationId, calendarId: process.env.GHL_CALENDAR_ID };
}

async function ghlFetch(path: string, options: RequestInit = {}): Promise<any> {
  const config = getGhlConfig();
  if (!config) throw new Error("GHL not configured");
  const url = `${GHL_API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
    ...(options.headers as Record<string, string> || {}),
  };
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GHL ${response.status}: ${body}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

export function registerToolkitRoutes(app: Express, readerDependencies?: {
  appointments?: {config:()=>ReturnType<typeof getGhlConfig>;read:(path:string)=>Promise<any>};
}) {
  // Read-only presentation of transport restrictions; not an authorization,
  // release approval, provider probe, or replacement for command-side gates.
  app.get("/api/tools/capabilities", isDashboardUser, (_req, res) => {
    const denied = process.env.VG_PROVIDER_DENY_MODE === "1";
    const generationConfigured = !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    res.json({
      ai: { blocked: denied, reason: denied
        ? "Provider transport is denied in this isolated candidate; AI execution is unavailable."
        : "AI execution uses the existing assistant authority; configuration is not release approval." },
      followups: { blocked: denied || !generationConfigured, reason: denied
        ? "Provider transport is denied in this isolated candidate; follow-up generation is unavailable."
        : generationConfigured ? "Generating drafts uses an AI provider; it does not send or enroll."
          : "Follow-up generation is unavailable because its AI provider is not configured." },
      bin: { blocked: denied, reason: denied
        ? "Public provider transport is denied in this isolated candidate; BIN lookup is unavailable."
        : "BIN lookup queries an external directory; no payment or card processing is performed." },
      asOf: new Date().toISOString(), capability: "transport_observation_only",
    });
  });
  // === SMS INBOX ===
  // C-01 (#1626): all SMS inbox routes are admin/manager only. These routes
  // read GHL conversations (PII) and can send SMS to arbitrary contacts —
  // requireRole gates them; the reply route also validates that the target
  // conversation/contact maps to a known local CRM contact before sending.
  app.get("/api/sms-inbox/threads", requireRole("admin", "manager"), async (req, res) => {
    try {
      const config = getGhlConfig();
      if (!config) {
        return res.json({ threads: [], configured: false });
      }
      const limit = Number(req.query.limit) || 20;
      const result = await ghlFetch(
        `/conversations/search?locationId=${config.locationId}&limit=${limit}&type=SMS`
      );
      const conversations = result?.conversations || result?.data || [];
      const threads = conversations.map((c: any) => ({
        id: c.id,
        contactId: c.contactId,
        contactName: c.fullName || c.contactName || `${c.firstName || ""} ${c.lastName || ""}`.trim() || "Unknown",
        lastMessage: c.lastMessage || c.lastMessageBody || "",
        lastMessageDate: c.lastMessageDate || c.dateUpdated || null,
        unread: c.unreadCount > 0 || c.unread === true,
        unreadCount: c.unreadCount || 0,
        phone: c.phone || "",
      }));
      const totalUnread = threads.reduce((acc: number, t: any) => acc + (t.unreadCount || 0), 0);
      res.json({ threads, configured: true, totalUnread });
    } catch (err: any) {
      console.error("[SMS Inbox] threads error:", err.message);
      res.json({ threads: [], configured: false, error: safeMessage(err.message, "SMS inbox unavailable") });
    }
  });

  app.get("/api/sms-inbox/thread/:conversationId", requireRole("admin", "manager"), async (req, res) => {
    try {
      const config = getGhlConfig();
      if (!config) return res.status(503).json({ message: "GHL not configured" });
      // A provider conversation ID is not sufficient authority: resolve it to
      // the configured account's local CRM contact before returning its PII.
      const conversation = await ghlFetch(`/conversations/${req.params.conversationId}`);
      const ghlContactId = conversation?.contactId || conversation?.conversation?.contactId;
      if (!ghlContactId || !await storage.getContactByGhlContactId(ghlContactId)) {
        return res.status(404).json({ message: "Conversation is not linked to a CRM contact" });
      }
      const result = await ghlFetch(
        `/conversations/${req.params.conversationId}/messages?limit=50`
      );
      const messages = result?.messages || result?.data || [];
      res.json({ messages });
    } catch (err: any) {
      console.error("[SMS Inbox] thread error:", err.message);
      serverError(res, err);
    }
  });

  app.post("/api/sms-inbox/reply", requireRole("admin", "manager"), async (req, res) => {
    try {
      const config = getGhlConfig();
      if (!config) return res.status(503).json({ message: "GHL not configured" });
      const { conversationId, contactId, message } = req.body;
      if (!message || (!conversationId && !contactId)) {
        return res.status(400).json({ message: "message and conversationId or contactId required" });
      }

      // ── C-01 (#1626): ownership/identity validation ────────────────────────
      // The target must resolve to a known local CRM contact. Arbitrary GHL
      // contact/conversation IDs that don't map to our CRM are rejected.
      let ghlContactId: string | undefined;
      let localContact: Awaited<ReturnType<typeof storage.getContact>> | undefined;

      // Whenever a conversationId is supplied it is the actual send target, so
      // it must ALWAYS be resolved and verified — even when a contactId is
      // also supplied. Otherwise a caller could pair a benign contactId with
      // an unrelated conversation and send into that conversation.
      let convoGhlContactId: string | undefined;
      if (conversationId) {
        try {
          const convo = await ghlFetch(`/conversations/${conversationId}`);
          convoGhlContactId = convo?.contactId || convo?.conversation?.contactId;
          if (!convoGhlContactId) {
            return res.status(403).json({ message: "Conversation does not resolve to a contact" });
          }
        } catch (convoErr: any) {
          console.error("[SMS Inbox] conversation ownership lookup failed:", convoErr.message);
          return res.status(403).json({ message: "Conversation could not be verified" });
        }
      }

      if (contactId) {
        localContact = await storage.getContact(Number(contactId));
        if (!localContact) {
          return res.status(403).json({ message: "Contact is not a known CRM contact" });
        }
        if (!localContact.ghlContactId) {
          return res.status(400).json({ message: "Contact has no linked GHL contact" });
        }
        // If both identifiers were supplied, they must refer to the same
        // contact — reject mismatched pairs.
        if (convoGhlContactId && convoGhlContactId !== localContact.ghlContactId) {
          return res.status(403).json({ message: "Conversation does not belong to the specified contact" });
        }
        ghlContactId = localContact.ghlContactId;
      } else {
        // conversationId-only send: the conversation's contact must map to a
        // local CRM contact. Contactability is applied to that contact.
        localContact = await storage.getContactByGhlContactId(convoGhlContactId!);
        if (!localContact) {
          return res.status(403).json({ message: "Conversation contact is not a known CRM contact" });
        }
        ghlContactId = convoGhlContactId;
      }

      // ── C-12 (#1626): canonical contactability gate before dispatch ────────
      const { evaluateContactability } = await import("../services/contactability");
      const contactability = await evaluateContactability({
        contactId: localContact.id,
        channel: "sms",
        campaignType: "manual_reply",
        mode: "enforcement",
      });
      if (!contactability.allowed) {
        console.warn(`[SMS Inbox] reply denied by contactability: ${contactability.reason} (contactId=${localContact.id})`);
        return res.status(409).json({
          message: "Send blocked by contactability policy",
          reason: contactability.reason,
        });
      }

      // ── Pause authority gate (transport boundary) ──────────────────────────
      const { authorize, recheckEpoch } = await import("../services/outbound-pause-authority");
      const { registerInflight, deregisterInflight } = await import("../services/outbound-control-service");
      const pauseDecision = await authorize({});
      if (!pauseDecision.allowed) {
        return res.status(503).json({ message: `Outbound paused: ${pauseDecision.reasonCode}` });
      }
      const inflightToken = crypto.randomUUID();
      await registerInflight(inflightToken, pauseDecision.epoch);
      let result: any;
      try {
        const epochOk = await recheckEpoch(pauseDecision.epoch);
        if (!epochOk) {
          return res.status(503).json({ message: "Outbound paused: epoch changed before send" });
        }
        const payload: any = {
          type: "SMS",
          message,
        };
        if (conversationId) payload.conversationId = conversationId;
        else payload.contactId = ghlContactId;
        result = await ghlFetch("/conversations/messages", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } finally {
        deregisterInflight(inflightToken);
      }
      res.json({ success: true, messageId: result?.messageId });
    } catch (err: any) {
      console.error("[SMS Inbox] reply error:", err.message);
      serverError(res, err);
    }
  });

  app.get("/api/sms-inbox/unread-count", requireRole("admin", "manager"), async (req, res) => {
    try {
      const config = getGhlConfig();
      if (!config) return res.json({ count: 0 });
      let totalUnread = 0;
      let lastId: string | null = null;
      const MAX_PAGES = 5;
      for (let page = 0; page < MAX_PAGES; page++) {
        const qs = lastId
          ? `/conversations/search?locationId=${config.locationId}&limit=100&type=SMS&startAfterId=${lastId}`
          : `/conversations/search?locationId=${config.locationId}&limit=100&type=SMS`;
        const result = await ghlFetch(qs);
        const conversations: any[] = result?.conversations || result?.data || [];
        totalUnread += conversations.reduce((acc: number, c: any) => acc + (c.unreadCount || (c.unread ? 1 : 0)), 0);
        if (!result?.nextPage || conversations.length === 0) break;
        lastId = result?.lastId || conversations[conversations.length - 1]?.id || null;
        if (!lastId) break;
      }
      res.json({ count: totalUnread });
    } catch {
      res.json({ count: 0 });
    }
  });

  app.post("/api/sms-inbox/mark-read/:conversationId", requireRole("admin", "manager"), async (req, res) => {
    try {
      const config = getGhlConfig();
      if (!config) return res.status(503).json({ message: "GHL not configured" });
      const { conversationId } = req.params;
      const conversation = await ghlFetch(`/conversations/${conversationId}`);
      const ghlContactId = conversation?.contactId || conversation?.conversation?.contactId;
      if (!ghlContactId || !await storage.getContactByGhlContactId(ghlContactId)) {
        return res.status(404).json({ message: "Conversation is not linked to a CRM contact" });
      }
      await ghlFetch(`/conversations/${conversationId}`, {
        method: "PUT",
        body: JSON.stringify({ unreadCount: 0 }),
      });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[SMS Inbox] mark-read error:", err.message);
      serverError(res, err);
    }
  });


  // === CALENDAR / APPOINTMENTS ===
  app.get("/api/appointments", isDashboardUser, async (req, res) => {
    let configured=false;
    try {
      const config = readerDependencies?.appointments ? readerDependencies.appointments.config() : getGhlConfig();
      configured=!!config;
      if (!config) return res.json({ appointments: [], configured: false, status:"not_configured",
        source:"ghl_appointments", completeness:"unavailable", queueLimit:10 });

      const now = Date.now();
      const lookbackMs = 24 * 60 * 60 * 1000;
      const startTime = now - lookbackMs;
      const endTime = now + 30 * 24 * 60 * 60 * 1000;
      const calendarId = config.calendarId;

      // GHL rejects an unsupported `limit` on this endpoint with HTTP 422.
      // Bound the local queue below; do not claim a provider-side page limit.
      let path = `/calendars/events?locationId=${encodeURIComponent(config.locationId)}&startTime=${startTime}&endTime=${endTime}`;
      if (calendarId) path += `&calendarId=${encodeURIComponent(calendarId)}`;

      const result = await (readerDependencies?.appointments?.read ?? ghlFetch)(path);
      const events = result?.events ?? result?.data;
      if(!Array.isArray(events)) throw new Error("APPOINTMENT_PROVIDER_SHAPE_INVALID");
      const externalIds = [...new Set(events.map((e:any)=>e.contact?.id || e.contactId).filter((id:unknown)=>typeof id==="string"))] as string[];
      const localContacts = externalIds.length ? await db.select({id:contacts.id,ghlId:contacts.ghlContactId,owner:contacts.assignedTo})
        .from(contacts).where(inArray(contacts.ghlContactId,externalIds)) : [];
      const authorizedContacts = new Map(localContacts.filter(c=>canAccessOwner(req.user as any,c.owner,false)).map(c=>[c.ghlId,c.id]));
      const agent = (req.user as any)?.role==="agent";

      const appointments = events
        .filter((e: any) => e.status !== "cancelled" && (!agent || authorizedContacts.has(e.contact?.id || e.contactId)))
        .map((e: any) => {
          const isNoShow =
            e.status === "noShow" ||
            e.appointmentStatus === "noShow" ||
            e.appointmentStatus === "no_show" ||
            e.status === "no_show";
          const startTs = e.startTime || e.start?.dateTime || e.startDate;
          const startMs = typeof startTs === "number" ? startTs : (startTs ? Date.parse(startTs) : NaN);
          const isPast = !isNaN(startMs) && startMs < now;
          return {
            id: e.id,
            title: e.title || e.summary || "Appointment",
            contactName: e.contact?.name || e.contactName || e.attendees?.[0]?.name || "Contact",
            contactId: authorizedContacts.get(e.contact?.id || e.contactId) ?? null,
            externalContactId: e.contact?.id || e.contactId || null,
            source:"ghl_appointments",
            startTime: startTs,
            endTime: e.endTime || e.end?.dateTime || e.endDate,
            status: e.status || "booked",
            calendarType: e.calendarType || e.appointmentStatus || "booked",
            ghlLink: e.meetingLocationType === "zoom" || e.locationType === "zoom"
              ? e.zoomLink || null
              : null,
            noShow: isNoShow && isPast,
            locationName: e.calendarName || e.calendarId || null,
          };
        })
        .sort((a: any, b: any) => {
          const toMs = (ts: any) => typeof ts === "number" ? ts : (ts ? Date.parse(ts) : 0);
          return toMs(a.startTime) - toMs(b.startTime);
        })
        .slice(0, 10);

      res.json({ appointments, configured: true, status:"available", source:"ghl_appointments",
        queueLimit:10, providerLimit:null, completeness:"bounded_queue", exact:false,
        scope:agent?"authorized_local_mapping":"management", asOf:new Date(now).toISOString(),
        window:{start:new Date(startTime).toISOString(),endExclusive:new Date(endTime).toISOString(),timezone:"UTC"} });
    } catch (err: any) {
      console.error("[Appointments] error:", err.message);
      res.status(503).json({ appointments: [], configured, status:"provider_failed",
        source:"ghl_appointments", completeness:"unavailable", error:"Appointments unavailable" });
    }
  });


  // === BIN LOOKUP ===
  app.get("/api/tools/bin-lookup", isAuthenticated, async (req, res) => {
    try {
      const bin = String(req.query.bin || "").replace(/\D/g, "").slice(0, 8);
      if (bin.length < 6) return res.status(400).json({ message: "BIN must be at least 6 digits" });

      const response = await fetch(`https://lookup.binlist.net/${bin}`, {
        headers: { "Accept-Version": "3" },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return res.json({ found: false, message: "BIN not found in database" });
        }
        return res.status(response.status).json({ message: "BIN lookup service error" });
      }

      const data = await response.json() as any;

      const brandRaw = (data?.scheme || data?.network || "").toLowerCase();
      const brandMap: Record<string, string> = {
        visa: "Visa",
        mastercard: "Mastercard",
        amex: "American Express",
        american_express: "American Express",
        discover: "Discover",
        jcb: "JCB",
        diners: "Diners Club",
        unionpay: "UnionPay",
      };
      const brand = brandMap[brandRaw] || (brandRaw ? brandRaw.charAt(0).toUpperCase() + brandRaw.slice(1) : "Unknown");

      const cardType = (data?.type || "").toLowerCase();
      const cardTypeMapped = cardType === "debit" ? "Debit" : cardType === "credit" ? "Credit" : cardType || "Unknown";

      const prepaid = data?.prepaid === true ? "Prepaid" : null;
      const commercial = data?.commercial === true ? "Commercial" : "Consumer";

      let interchangeCategory = "Standard";
      if (data?.commercial) interchangeCategory = "Commercial / Corporate";
      else if (data?.type === "debit") interchangeCategory = "PIN Debit / Debit";
      else if (data?.prepaid) interchangeCategory = "Prepaid";
      else if (data?.type === "credit") interchangeCategory = "Credit / Rewards";

      res.json({
        found: true,
        bin: bin.slice(0, 6),
        brand,
        cardType: cardTypeMapped,
        usage: commercial,
        prepaid: !!data?.prepaid,
        country: data?.country?.name || null,
        countryCode: data?.country?.alpha2 || null,
        bank: data?.bank?.name || null,
        bankPhone: data?.bank?.phone || null,
        bankUrl: data?.bank?.url || null,
        interchangeCategory,
        rewardsIndicator: data?.type === "credit" && data?.scheme === "visa" ? "Possible rewards card — verify at POS" : null,
        raw: {
          scheme: data?.scheme,
          type: data?.type,
          brand: data?.brand,
          prepaid: data?.prepaid,
          commercial: data?.commercial,
        },
      });
    } catch (err: any) {
      console.error("[BIN Lookup] error:", err.message);
      serverError(res, err);
    }
  });


  // === ROUND-ROBIN ASSIGNMENT ===
  app.get("/api/admin/round-robin/eligible-reps",requireRole("admin","manager"),async(req,res)=>{
    try {res.json(await getEligibleRoundRobinReps(req.user as any));}
    catch(err) {if(err instanceof WorkCommandError) return res.status(err.status).json({message:err.message}); serverError(res,err);}
  });
  app.get("/api/admin/round-robin", requireRole("admin", "manager"), async (req, res) => {
    try { res.json(await getRoundRobinPool()); } catch (err) { serverError(res,err); }
  });

  app.put("/api/admin/round-robin", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { reps, enabled } = req.body;
      if ((enabled!==undefined && typeof enabled!=="boolean") || (reps!==undefined && !Array.isArray(reps))) return res.status(400).json({message:"Unsupported pool configuration"});
      const updated = await mutateRoundRobinPool(req.user as any,req.body.expectedVersion,async (pool,tx)=>{
        if (reps!==undefined) {
          if (reps.length>200 || new Set(reps.map((r:any)=>r.userId)).size!==reps.length) throw new WorkCommandError("Duplicate or oversized roster. Reload before saving.",409);
          const next=[];
          for (const rep of reps) {
            const current=await resolveWorkAssignee(rep.userId,tx,undefined,true);
            if (typeof rep.paused!=="boolean") throw new WorkCommandError("Paused must be a boolean.",409);
            next.push({userId:current.id,name:String(rep.name || current.email),email:current.email!,
              paused:rep.paused,assignedCount:pool.reps.find(r=>r.userId===current.id)?.assignedCount ?? 0});
          }
          pool.reps=next;
        }
        if (enabled!==undefined) pool.enabled=enabled;
      });
      res.json(updated);
    } catch (err: any) {
      if (err instanceof WorkCommandError) return res.status(err.status).json({message:err.message});
      serverError(res, err);
    }
  });

  app.patch("/api/admin/round-robin/rep/:userId", requireRole("admin", "manager"), async (req, res) => {
    try {
      const userId = String(req.params.userId);
      const { paused, name, email } = req.body;
      const pool=await mutateRoundRobinPool(req.user as any,req.body.expectedVersion,async (pool,tx)=>{
        const rep=pool.reps.find(r=>r.userId===userId);
        if (!rep) throw new WorkCommandError("Rep unavailable in this pool.",404);
        if (paused!==undefined && typeof paused!=="boolean") throw new WorkCommandError("Paused must be a boolean.",409);
        if (paused===false || email!==undefined) {
          const current=await resolveWorkAssignee(userId,tx,undefined,true);
          rep.email=current.email!;
        }
        if (paused!==undefined) rep.paused=paused;
        if (name!==undefined) rep.name=String(name);
      });
      res.json(pool);
    } catch (err: any) {
      if (err instanceof WorkCommandError) return res.status(err.status).json({message:err.message});
      serverError(res, err);
    }
  });

  app.delete("/api/admin/round-robin/rep/:userId", requireRole("admin", "manager"), async (req, res) => {
    try {
      const pool=await mutateRoundRobinPool(req.user as any,req.body.expectedVersion,pool=>{
        pool.reps=pool.reps.filter(r=>r.userId!==req.params.userId); pool.currentIndex=0;
      });
      res.json(pool);
    } catch (err: any) {
      if (err instanceof WorkCommandError) return res.status(err.status).json({message:err.message});
      serverError(res, err);
    }
  });

  app.post("/api/admin/round-robin/rep", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { userId, name, email } = req.body;
      if (!userId || !name) return res.status(400).json({ message: "userId and name required" });
      const pool=await mutateRoundRobinPool(req.user as any,req.body.expectedVersion,async(pool,tx)=>{
        const current=await resolveWorkAssignee(userId,tx,undefined,true);
        if (pool.reps.some(r=>r.userId===current.id)) throw new WorkCommandError("Rep already in pool.",409);
        pool.reps.push({userId:current.id,name:String(name),email:current.email!,paused:false,assignedCount:0});
      });
      res.json(pool);
    } catch (err: any) {
      if (err instanceof WorkCommandError) return res.status(err.status).json({message:err.message});
      serverError(res, err);
    }
  });

  app.get("/api/admin/round-robin/log", requireRole("admin", "manager"), async (req, res) => {
    const pool = await getRoundRobinPool();
    let log = pool.log || [];

    const { rep, startDate, endDate, page, pageSize, export: exportFormat } = req.query;

    if (rep && typeof rep === "string" && rep.trim()) {
      const repLower = rep.trim().toLowerCase();
      log = log.filter((e) => e.assignedName.toLowerCase().includes(repLower));
    }

    if (startDate && typeof startDate === "string") {
      const start = new Date(startDate).getTime();
      if (!isNaN(start)) {
        log = log.filter((e) => new Date(e.assignedAt).getTime() >= start);
      }
    }

    if (endDate && typeof endDate === "string") {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      if (!isNaN(end.getTime())) {
        log = log.filter((e) => new Date(e.assignedAt).getTime() <= end.getTime());
      }
    }

    if (exportFormat === "csv") {
      const header = "Contact,Assigned To,Assigned At\n";
      const rows = log
        .map((e) => `"${e.contactName.replace(/"/g, '""')}","${e.assignedName.replace(/"/g, '""')}","${new Date(e.assignedAt).toLocaleString()}"`)
        .join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=\"round-robin-log.csv\"");
      return res.send(header + rows);
    }

    const total = log.length;
    const parsedPage = Math.max(1, parseInt(String(page || "1"), 10));
    const parsedPageSize = Math.min(200, Math.max(1, parseInt(String(pageSize || "25"), 10)));
    const offset = (parsedPage - 1) * parsedPageSize;
    const paginated = log.slice(offset, offset + parsedPageSize);

    res.json({
      log: paginated,
      total,
      page: parsedPage,
      pageSize: parsedPageSize,
      totalPages: Math.ceil(total / parsedPageSize),
    });
  });
}
