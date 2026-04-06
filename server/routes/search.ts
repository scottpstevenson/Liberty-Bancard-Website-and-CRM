import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { contacts } from "@shared/schema";

export function registerSearchRoutes(app: Express) {
  // === UNIVERSAL SMART SEARCH ===
  app.get("/api/search", isAuthenticated, async (req, res) => {
    try {
      const q = (req.query.q as string || "").toLowerCase().trim();
      if (!q || q.length < 2) return res.json({ results: [] });

      const [contactsResult, dealsResult, ticketsResult, tasks, prospectsResult] = await Promise.all([
        storage.getContacts({ limit: 500 }),
        storage.getDeals({ limit: 500 }),
        storage.getTickets({ limit: 500 }),
        storage.getTasks(),
        storage.getProspects(undefined, { limit: 500 }),
      ]);
      const contacts = contactsResult.data;
      const deals = dealsResult.data;
      const tickets = ticketsResult.data;
      const prospects = prospectsResult.data;

      const results: Array<{ type: string; id: number; title: string; subtitle: string; href: string }> = [];

      contacts.forEach(c => {
        const searchStr = `${c.firstName} ${c.lastName} ${c.email} ${c.companyName || ""} ${c.phone || ""}`.toLowerCase();
        if (searchStr.includes(q)) results.push({ type: "contact", id: c.id, title: `${c.firstName} ${c.lastName}`, subtitle: c.companyName || c.email, href: "/dashboard/contacts" });
      });

      deals.forEach(d => {
        const searchStr = `${d.offerPath || ""} ${d.stage} ${d.pipeline} deal #${d.id}`.toLowerCase();
        if (searchStr.includes(q)) results.push({ type: "deal", id: d.id, title: `Deal #${d.id}`, subtitle: `${d.stage} - ${d.offerPath || d.pipeline}`, href: "/dashboard/pipeline" });
      });

      tickets.forEach(t => {
        const searchStr = `${t.subject} ${t.category || ""} ${t.status}`.toLowerCase();
        if (searchStr.includes(q)) results.push({ type: "ticket", id: t.id, title: t.subject, subtitle: `${t.status} - ${t.category || "General"}`, href: "/dashboard/tickets" });
      });

      tasks.forEach(t => {
        const searchStr = `${t.title} ${t.description || ""} ${t.status}`.toLowerCase();
        if (searchStr.includes(q)) results.push({ type: "task", id: t.id, title: t.title, subtitle: t.status || "pending", href: "/dashboard/tasks" });
      });

      prospects.forEach(p => {
        const searchStr = `${p.companyName || ""} ${p.ownerFirstName || ""} ${p.ownerLastName || ""} ${p.email || ""} ${p.vertical || ""}`.toLowerCase();
        if (searchStr.includes(q)) results.push({ type: "prospect", id: p.id, title: p.companyName || "Unknown", subtitle: `${p.vertical || "Unknown"} - ${p.score || "unscored"}`, href: "/dashboard/prospects" });
      });

      res.json({ results: results.slice(0, 20) });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === GLOBAL SEARCH ===
  app.get("/api/search", isAuthenticated, async (req, res) => {
    try {
      const q = String(req.query.q || "").toLowerCase().trim();
      if (!q) return res.json({ contacts: [], deals: [], tickets: [], tasks: [] });
      
      const [contactsRes, dealsRes, ticketsRes, allTasks] = await Promise.all([
        storage.getContacts({ limit: 500 }),
        storage.getDeals({ limit: 500 }),
        storage.getTickets({ limit: 500 }),
        storage.getTasks(),
      ]);
      const allContacts = contactsRes.data;
      const allDeals = dealsRes.data;
      const allTickets = ticketsRes.data;
      
      const matchContacts = allContacts.filter(c => 
        c.firstName.toLowerCase().includes(q) || c.lastName.toLowerCase().includes(q) || 
        c.email?.toLowerCase().includes(q) || c.companyName?.toLowerCase().includes(q) || c.phone?.includes(q)
      ).slice(0, 10);
      
      const matchDeals = allDeals.filter(d => 
        d.stage?.toLowerCase().includes(q) || d.offerPath?.toLowerCase().includes(q) || 
        d.notes?.toLowerCase().includes(q) || d.pipeline?.toLowerCase().includes(q)
      ).slice(0, 10);
      
      const matchTickets = allTickets.filter(t => 
        t.subject?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q) || 
        t.category?.toLowerCase().includes(q)
      ).slice(0, 10);
      
      const matchTasks = allTasks.filter(t => 
        t.title?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q) || 
        t.assignedTo?.toLowerCase().includes(q)
      ).slice(0, 10);
      
      res.json({ contacts: matchContacts, deals: matchDeals, tickets: matchTickets, tasks: matchTasks });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === ADVANCED SEARCH ===
  app.get("/api/search/advanced", isAuthenticated, async (req, res) => {
    const { q, dateFrom, dateTo, assignedTo, entityType, tags } = req.query;
    const query = String(q || '').toLowerCase().trim();
    const results: any = { contacts: [], deals: [], tickets: [], tasks: [] };

    if (!entityType || entityType === 'contact') {
      const { data: allContacts } = await storage.getContacts({ limit: 500 });
      results.contacts = allContacts.filter(c => {
        if (query && !`${c.firstName} ${c.lastName} ${c.email} ${c.companyName || ''}`.toLowerCase().includes(query)) return false;
        if (dateFrom && new Date(c.createdAt!) < new Date(String(dateFrom))) return false;
        if (dateTo && new Date(c.createdAt!) > new Date(String(dateTo))) return false;
        if (tags) {
          const tagList = String(tags).split(',');
          if (!c.tags?.some(t => tagList.includes(t))) return false;
        }
        return true;
      }).slice(0, 50);
    }

    if (!entityType || entityType === 'deal') {
      const { data: allDeals } = await storage.getDeals({ limit: 500 });
      results.deals = allDeals.filter(d => {
        if (query && !`${d.stage} ${d.pipeline} ${d.notes || ''} ${d.owner || ''}`.toLowerCase().includes(query)) return false;
        if (assignedTo && d.owner !== String(assignedTo)) return false;
        if (dateFrom && new Date(d.createdAt!) < new Date(String(dateFrom))) return false;
        if (dateTo && new Date(d.createdAt!) > new Date(String(dateTo))) return false;
        return true;
      }).slice(0, 50);
    }

    if (!entityType || entityType === 'ticket') {
      const { data: allTickets } = await storage.getTickets({ limit: 500 });
      results.tickets = allTickets.filter(t => {
        if (query && !`${t.subject} ${t.description} ${t.category || ''}`.toLowerCase().includes(query)) return false;
        if (assignedTo && t.assignedTo !== String(assignedTo)) return false;
        if (dateFrom && new Date(t.createdAt!) < new Date(String(dateFrom))) return false;
        if (dateTo && new Date(t.createdAt!) > new Date(String(dateTo))) return false;
        return true;
      }).slice(0, 50);
    }

    if (!entityType || entityType === 'task') {
      const allTasks = await storage.getTasks();
      results.tasks = allTasks.filter(t => {
        if (query && !`${t.title} ${t.description || ''}`.toLowerCase().includes(query)) return false;
        if (assignedTo && t.assignedTo !== String(assignedTo)) return false;
        if (dateFrom && new Date(t.createdAt!) < new Date(String(dateFrom))) return false;
        if (dateTo && new Date(t.createdAt!) > new Date(String(dateTo))) return false;
        return true;
      }).slice(0, 50);
    }

    res.json(results);
  });


  // === AUTO-LEAD ROUTING ===
  app.post("/api/ai/route-prospect", isAuthenticated, async (req, res) => {
    try {
      const { prospectId } = req.body;
      if (!prospectId) return res.status(400).json({ message: "prospectId required" });

      const prospect = await storage.getProspect(Number(prospectId));
      if (!prospect) return res.status(404).json({ message: "Prospect not found" });

      const campaigns = await storage.getCampaigns();
      const activeCampaigns = campaigns.filter(c => c.name.startsWith("SDR-"));

      let bestCampaign = activeCampaigns[0];
      const vert = (prospect.vertical || "").toLowerCase();

      for (const camp of activeCampaigns) {
        const campVerticals = (camp.targetVerticals || []).join(" ").toLowerCase();
        const campName = camp.name.toLowerCase();
        if (campVerticals.includes(vert) || campName.includes(vert)) {
          bestCampaign = camp;
          break;
        }
        if (vert.includes("restaurant") && campName.includes("restaurant")) { bestCampaign = camp; break; }
        if ((vert.includes("medical") || vert.includes("dental") || vert.includes("healthcare")) && campName.includes("medical")) { bestCampaign = camp; break; }
        if ((vert.includes("retail") || vert.includes("ecommerce")) && campName.includes("retail")) { bestCampaign = camp; break; }
        if ((vert.includes("salon") || vert.includes("spa") || vert.includes("beauty")) && campName.includes("salon")) { bestCampaign = camp; break; }
        if ((vert.includes("auto") || vert.includes("trades")) && campName.includes("auto")) { bestCampaign = camp; break; }
        if ((vert.includes("professional") || vert.includes("legal") || vert.includes("accounting")) && campName.includes("professional")) { bestCampaign = camp; break; }
      }

      if (!bestCampaign) {
        bestCampaign = activeCampaigns.find(c => c.name.includes("Statement Review")) || activeCampaigns[0];
      }

      await storage.updateProspect(Number(prospectId), { status: "campaign_assigned" });

      res.json({ campaignId: bestCampaign?.id, campaignName: bestCampaign?.name, prospectId: prospect.id });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Routing error" });
    }
  });

  app.post("/api/ai/route-prospects-bulk", isAuthenticated, async (req, res) => {
    try {
      const { prospectIds } = req.body;
      if (!prospectIds || !Array.isArray(prospectIds)) return res.status(400).json({ message: "prospectIds array required" });

      const campaigns = await storage.getCampaigns();
      const sdrCampaigns = campaigns.filter(c => c.name.startsWith("SDR-"));
      const results: Array<{ prospectId: number; campaignId: number; campaignName: string }> = [];

      for (const pid of prospectIds.slice(0, 100)) {
        const prospect = await storage.getProspect(Number(pid));
        if (!prospect) continue;

        const vert = (prospect.vertical || "").toLowerCase();
        let matched = sdrCampaigns.find(c => {
          const name = c.name.toLowerCase();
          const verts = (c.targetVerticals || []).join(" ").toLowerCase();
          return verts.includes(vert) || name.includes(vert);
        });
        if (!matched) matched = sdrCampaigns.find(c => c.name.includes("Statement Review")) || sdrCampaigns[0];

        if (matched) {
          await storage.updateProspect(Number(pid), { status: "campaign_assigned" });
          results.push({ prospectId: prospect.id, campaignId: matched.id, campaignName: matched.name });
        }
      }

      res.json({ routed: results.length, results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

}
