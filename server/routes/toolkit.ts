import type { Express } from "express";
import { isAuthenticated, isAdmin } from "../replit_integrations/auth";
import { storage } from "../storage";

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

const ROUND_ROBIN_KEY = "round_robin_pool";

interface RoundRobinRep {
  userId: string;
  name: string;
  email: string;
  paused: boolean;
  assignedCount: number;
}

interface RoundRobinPool {
  reps: RoundRobinRep[];
  currentIndex: number;
  enabled: boolean;
  log: Array<{
    contactId: number;
    contactName: string;
    assignedTo: string;
    assignedName: string;
    assignedAt: string;
  }>;
}

export async function getRoundRobinPool(): Promise<RoundRobinPool> {
  const saved = await storage.getSystemSetting(ROUND_ROBIN_KEY);
  return saved || { reps: [], currentIndex: 0, enabled: false, log: [] };
}

export async function assignNextRep(contactId: number, contactName: string): Promise<string | null> {
  const pool = await getRoundRobinPool();
  if (!pool.enabled || pool.reps.length === 0) return null;

  const activeReps = pool.reps.filter((r) => !r.paused);
  if (activeReps.length === 0) return null;

  const currentActiveIdx = pool.currentIndex % activeReps.length;
  const chosenRep = activeReps[currentActiveIdx];

  chosenRep.assignedCount = (chosenRep.assignedCount || 0) + 1;
  pool.currentIndex = (pool.currentIndex + 1) % activeReps.length;

  const logEntry = {
    contactId,
    contactName,
    assignedTo: chosenRep.userId,
    assignedName: chosenRep.name,
    assignedAt: new Date().toISOString(),
  };
  pool.log = [logEntry, ...(pool.log || [])].slice(0, 200);

  await storage.setSystemSetting(ROUND_ROBIN_KEY, pool);
  return chosenRep.userId;
}

export function registerToolkitRoutes(app: Express) {
  // === SMS INBOX ===
  app.get("/api/sms-inbox/threads", isAuthenticated, async (req, res) => {
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
      res.json({ threads: [], configured: false, error: err.message });
    }
  });

  app.get("/api/sms-inbox/thread/:conversationId", isAuthenticated, async (req, res) => {
    try {
      const config = getGhlConfig();
      if (!config) return res.status(503).json({ message: "GHL not configured" });
      const result = await ghlFetch(
        `/conversations/${req.params.conversationId}/messages?limit=50`
      );
      const messages = result?.messages || result?.data || [];
      res.json({ messages });
    } catch (err: any) {
      console.error("[SMS Inbox] thread error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sms-inbox/reply", isAuthenticated, async (req, res) => {
    try {
      const config = getGhlConfig();
      if (!config) return res.status(503).json({ message: "GHL not configured" });
      const { conversationId, contactId, message } = req.body;
      if (!message || (!conversationId && !contactId)) {
        return res.status(400).json({ message: "message and conversationId or contactId required" });
      }
      let ghlContactId = conversationId;
      if (contactId) {
        const contact = await storage.getContact(Number(contactId));
        if (contact?.ghlContactId) ghlContactId = contact.ghlContactId;
      }
      const payload: any = {
        type: "SMS",
        message,
      };
      if (conversationId) payload.conversationId = conversationId;
      else payload.contactId = ghlContactId;
      const result = await ghlFetch("/conversations/messages", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      res.json({ success: true, messageId: result?.messageId });
    } catch (err: any) {
      console.error("[SMS Inbox] reply error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sms-inbox/unread-count", isAuthenticated, async (req, res) => {
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

  app.post("/api/sms-inbox/mark-read/:conversationId", isAuthenticated, async (req, res) => {
    try {
      const config = getGhlConfig();
      if (!config) return res.status(503).json({ message: "GHL not configured" });
      const { conversationId } = req.params;
      await ghlFetch(`/conversations/${conversationId}`, {
        method: "PUT",
        body: JSON.stringify({ unreadCount: 0 }),
      });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[SMS Inbox] mark-read error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });


  // === CALENDAR / APPOINTMENTS ===
  app.get("/api/appointments", isAuthenticated, async (req, res) => {
    try {
      const config = getGhlConfig();
      if (!config) return res.json({ appointments: [], configured: false });

      const now = Date.now();
      const endTime = now + 30 * 24 * 60 * 60 * 1000;
      const calendarId = config.calendarId;

      let path = `/calendars/events?locationId=${config.locationId}&startTime=${now}&endTime=${endTime}&limit=20`;
      if (calendarId) path += `&calendarId=${calendarId}`;

      const result = await ghlFetch(path);
      const events = result?.events || result?.data || [];

      const appointments = events
        .filter((e: any) => e.status !== "cancelled")
        .slice(0, 10)
        .map((e: any) => ({
          id: e.id,
          title: e.title || e.summary || "Appointment",
          contactName: e.contact?.name || e.contactName || e.attendees?.[0]?.name || "Contact",
          contactId: e.contact?.id || e.contactId || null,
          startTime: e.startTime || e.start?.dateTime || e.startDate,
          endTime: e.endTime || e.end?.dateTime || e.endDate,
          status: e.status || "booked",
          calendarType: e.calendarType || e.appointmentStatus || "booked",
          ghlLink: e.meetingLocationType === "zoom" || e.locationType === "zoom"
            ? e.zoomLink || null
            : null,
          noShow: e.status === "noShow" || e.appointmentStatus === "no_show",
          locationName: e.calendarName || e.calendarId || null,
        }));

      res.json({ appointments, configured: true });
    } catch (err: any) {
      console.error("[Appointments] error:", err.message);
      res.json({ appointments: [], configured: false, error: err.message });
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
      res.status(500).json({ message: "BIN lookup failed: " + err.message });
    }
  });


  // === ROUND-ROBIN ASSIGNMENT ===
  app.get("/api/admin/round-robin", isAuthenticated, async (req, res) => {
    if (!["admin", "manager"].includes((req.user as any)?.role)) {
      return res.status(403).json({ message: "Admin/Manager only" });
    }
    const pool = await getRoundRobinPool();
    res.json(pool);
  });

  app.put("/api/admin/round-robin", isAuthenticated, async (req, res) => {
    if (!["admin", "manager"].includes((req.user as any)?.role)) {
      return res.status(403).json({ message: "Admin/Manager only" });
    }
    try {
      const existing = await getRoundRobinPool();
      const { reps, enabled } = req.body;
      const updated: RoundRobinPool = {
        reps: Array.isArray(reps)
          ? reps.map((r: any) => ({
              userId: String(r.userId || ""),
              name: String(r.name || ""),
              email: String(r.email || ""),
              paused: !!r.paused,
              assignedCount: r.assignedCount || 0,
            }))
          : existing.reps,
        currentIndex: existing.currentIndex,
        enabled: enabled !== undefined ? !!enabled : existing.enabled,
        log: existing.log || [],
      };
      await storage.setSystemSetting(ROUND_ROBIN_KEY, updated);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/round-robin/rep/:userId", isAuthenticated, async (req, res) => {
    if (!["admin", "manager"].includes((req.user as any)?.role)) {
      return res.status(403).json({ message: "Admin/Manager only" });
    }
    try {
      const pool = await getRoundRobinPool();
      const { userId } = req.params;
      const { paused, name, email } = req.body;
      const rep = pool.reps.find((r) => r.userId === userId);
      if (!rep) return res.status(404).json({ message: "Rep not found in pool" });
      if (paused !== undefined) rep.paused = !!paused;
      if (name !== undefined) rep.name = name;
      if (email !== undefined) rep.email = email;
      await storage.setSystemSetting(ROUND_ROBIN_KEY, pool);
      res.json(pool);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/round-robin/rep/:userId", isAuthenticated, async (req, res) => {
    if (!["admin", "manager"].includes((req.user as any)?.role)) {
      return res.status(403).json({ message: "Admin/Manager only" });
    }
    try {
      const pool = await getRoundRobinPool();
      pool.reps = pool.reps.filter((r) => r.userId !== req.params.userId);
      pool.currentIndex = 0;
      await storage.setSystemSetting(ROUND_ROBIN_KEY, pool);
      res.json(pool);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/round-robin/rep", isAuthenticated, async (req, res) => {
    if (!["admin", "manager"].includes((req.user as any)?.role)) {
      return res.status(403).json({ message: "Admin/Manager only" });
    }
    try {
      const pool = await getRoundRobinPool();
      const { userId, name, email } = req.body;
      if (!userId || !name) return res.status(400).json({ message: "userId and name required" });
      if (pool.reps.find((r) => r.userId === userId)) {
        return res.status(409).json({ message: "Rep already in pool" });
      }
      pool.reps.push({ userId, name, email: email || "", paused: false, assignedCount: 0 });
      await storage.setSystemSetting(ROUND_ROBIN_KEY, pool);
      res.json(pool);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/round-robin/log", isAuthenticated, async (req, res) => {
    if (!["admin", "manager"].includes((req.user as any)?.role)) {
      return res.status(403).json({ message: "Admin/Manager only" });
    }
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
