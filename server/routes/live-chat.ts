import type { Express } from "express";
import { storage } from "../storage";
import { isAuthenticated } from "../replit_integrations/auth";
import { z } from "zod";
import { randomUUID } from "crypto";
import { createContactGhlFirst } from "../services/contact-writer";
import type { LiveChat } from "../../shared/schema";

interface AuthUser {
  firstName?: string;
  lastName?: string;
  email?: string;
}

function isBusinessHours(): boolean {
  const now = new Date();
  const eastern = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = eastern.getDay();
  const hour = eastern.getHours();
  return day >= 1 && day <= 5 && hour >= 9 && hour < 18;
}

export function registerLiveChatRoutes(app: Express) {

  // === PUBLIC: Start a new chat session ===
  app.post("/api/public/chat/session", async (req, res) => {
    try {
      const schema = z.object({
        pageUrl: z.string().optional(),
        visitorName: z.string().optional(),
        visitorEmail: z.string().email().optional(),
      });
      const { pageUrl, visitorName, visitorEmail } = schema.parse(req.body);
      const sessionId = randomUUID();

      const chat = await storage.createLiveChat({
        sessionId,
        visitorName: visitorName || null,
        visitorEmail: visitorEmail || null,
        pageUrl: pageUrl || null,
        status: "active",
        contactId: null,
      });

      await storage.createNotification({
        channel: "internal",
        title: "New Live Chat Started",
        message: `Visitor started a chat${visitorName ? ` — ${visitorName}` : ""}${pageUrl ? ` on ${pageUrl}` : ""}`,
        type: "info",
        metadata: { chatId: chat.id, sessionId },
      });

      res.status(201).json({ sessionId, chatId: chat.id, isBusinessHours: isBusinessHours() });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // === PUBLIC: Send a visitor message ===
  app.post("/api/public/chat/session/:sessionId/message", async (req, res) => {
    try {
      const schema = z.object({ content: z.string().min(1).max(2000) });
      const { content } = schema.parse(req.body);
      const chat = await storage.getLiveChatBySession(req.params.sessionId);
      if (!chat) return res.status(404).json({ message: "Chat session not found" });
      if (chat.status === "closed") return res.status(410).json({ message: "Chat session closed" });

      const message = await storage.createLiveChatMessage({
        chatId: chat.id,
        senderType: "visitor",
        senderName: chat.visitorName || "Visitor",
        content,
      });

      await storage.updateLiveChat(chat.id, { lastMessageAt: new Date() });

      await storage.createNotification({
        channel: "internal",
        title: "New Chat Message",
        message: `${chat.visitorName || "Visitor"}: ${content.slice(0, 100)}`,
        type: "info",
        metadata: { chatId: chat.id, sessionId: chat.sessionId },
      });

      res.json(message);
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // === PUBLIC: Poll for new messages ===
  app.get("/api/public/chat/session/:sessionId/messages", async (req, res) => {
    try {
      const chat = await storage.getLiveChatBySession(req.params.sessionId);
      if (!chat) return res.status(404).json({ message: "Chat session not found" });

      const afterId = req.query.afterId ? Number(req.query.afterId) : undefined;
      const messages = await storage.getLiveChatMessages(chat.id, afterId);
      res.json({ messages, status: chat.status, isBusinessHours: isBusinessHours() });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // === PUBLIC: Identify visitor (set email/name → creates/matches CRM contact) ===
  app.post("/api/public/chat/session/:sessionId/identify", async (req, res) => {
    try {
      const schema = z.object({
        name: z.string().min(1),
        email: z.string().email(),
      });
      const { name, email } = schema.parse(req.body);
      const chat = await storage.getLiveChatBySession(req.params.sessionId);
      if (!chat) return res.status(404).json({ message: "Chat session not found" });

      const nameParts = name.trim().split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      let contactId = chat.contactId;
      try {
        const contact = await createContactGhlFirst({
          firstName,
          lastName,
          email,
          phone: "",
          status: "New",
          tags: ["src_live_chat", "lead_website_chat"],
          landingPage: chat.pageUrl || "/",
        });
        contactId = contact.id;

        await storage.createNote({
          entityType: "contact",
          entityId: contact.id,
          content: `Live chat initiated from ${chat.pageUrl || "website"} on ${new Date(chat.createdAt).toLocaleString()}`,
          authorName: "System",
          pinned: false,
        });
      } catch (_) {
        const existing = await storage.getContactByEmail(email).catch(() => undefined);
        if (existing) contactId = existing.id;
      }

      await storage.updateLiveChat(chat.id, {
        visitorName: name,
        visitorEmail: email,
        contactId,
      });

      res.json({ success: true, contactId });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // === PUBLIC: Close a chat session ===
  app.post("/api/public/chat/session/:sessionId/close", async (req, res) => {
    try {
      const chat = await storage.getLiveChatBySession(req.params.sessionId);
      if (!chat) return res.status(404).json({ message: "Chat session not found" });

      if (chat.contactId) {
        const messages = await storage.getLiveChatMessages(chat.id);
        if (messages.length > 0) {
          const transcript = messages
            .map(m => `[${m.senderType === "agent" ? "Agent" : "Visitor"}] ${m.content}`)
            .join("\n");
          await storage.createNote({
            entityType: "contact",
            entityId: chat.contactId,
            content: `Live chat transcript (${new Date(chat.createdAt).toLocaleString()}):\n\n${transcript}`,
            authorName: "System",
            pinned: false,
          });
        }
      }

      await storage.updateLiveChat(chat.id, { status: "closed", closedAt: new Date() });
      res.json({ success: true });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // === PUBLIC: Offline form capture ===
  app.post("/api/public/chat/offline", async (req, res) => {
    try {
      const schema = z.object({
        name: z.string().min(1),
        email: z.string().email(),
        message: z.string().min(1).max(2000),
        pageUrl: z.string().optional(),
      });
      const { name, email, message, pageUrl } = schema.parse(req.body);

      const nameParts = name.trim().split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      let contactId: number | undefined;
      try {
        const contact = await createContactGhlFirst({
          firstName,
          lastName,
          email,
          phone: "",
          status: "New",
          tags: ["src_live_chat", "offline_chat_message"],
          landingPage: pageUrl || "/",
          notes: `Offline chat message: ${message}`,
        });
        contactId = contact.id;
      } catch (_) {
        const existing = await storage.getContactByEmail(email).catch(() => undefined);
        if (existing) contactId = existing.id;
      }

      const sessionId = randomUUID();
      const chat = await storage.createLiveChat({
        sessionId,
        visitorName: name,
        visitorEmail: email,
        pageUrl: pageUrl || null,
        status: "offline_captured",
        contactId: contactId || null,
      });

      await storage.createLiveChatMessage({
        chatId: chat.id,
        senderType: "visitor",
        senderName: name,
        content: message,
      });

      if (contactId) {
        await storage.createNote({
          entityType: "contact",
          entityId: contactId,
          content: `Offline chat message (${new Date().toLocaleString()}):\n${message}`,
          authorName: "System",
          pinned: false,
        });
      }

      await storage.createNotification({
        channel: "internal",
        title: "Offline Chat Message",
        message: `${name} (${email}) left a message: ${message.slice(0, 120)}`,
        type: "info",
        metadata: { chatId: chat.id, contactId },
      });

      res.status(201).json({ success: true });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // === AGENT: List all chat sessions ===
  app.get("/api/live-chat/sessions", isAuthenticated, async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      let chats: LiveChat[];
      if (status === "active") {
        chats = await storage.getActiveLiveChats();
      } else {
        chats = await storage.getAllLiveChats({ limit: 100 });
      }
      res.json(chats);
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // === AGENT: Get messages for a session ===
  app.get("/api/live-chat/sessions/:id/messages", isAuthenticated, async (req, res) => {
    try {
      const chatId = Number(req.params.id);
      const afterId = req.query.afterId ? Number(req.query.afterId) : undefined;
      const messages = await storage.getLiveChatMessages(chatId, afterId);
      const chat = await storage.getLiveChat(chatId);
      res.json({ messages, chat });
    } catch (err: unknown) {
      res.status(500).json({ message: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // === AGENT: Reply to a chat ===
  app.post("/api/live-chat/sessions/:id/reply", isAuthenticated, async (req, res) => {
    try {
      const schema = z.object({ content: z.string().min(1).max(2000) });
      const { content } = schema.parse(req.body);
      const chatId = Number(req.params.id);
      const chat = await storage.getLiveChat(chatId);
      if (!chat) return res.status(404).json({ message: "Chat not found" });

      const user = req.user as AuthUser;
      const agentName = user?.firstName && user?.lastName
        ? `${user.firstName} ${user.lastName}`
        : user?.email ?? "Support Agent";

      const message = await storage.createLiveChatMessage({
        chatId,
        senderType: "agent",
        senderName: agentName,
        content,
      });

      await storage.updateLiveChat(chatId, { lastMessageAt: new Date() });
      res.json(message);
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // === AGENT: Close a chat session ===
  app.patch("/api/live-chat/sessions/:id", isAuthenticated, async (req, res) => {
    try {
      const schema = z.object({ status: z.enum(["active", "closed"]) });
      const { status } = schema.parse(req.body);
      const chatId = Number(req.params.id);
      const chat = await storage.getLiveChat(chatId);
      if (!chat) return res.status(404).json({ message: "Chat not found" });

      const baseUpdate: Parameters<typeof storage.updateLiveChat>[1] = { status };
      if (status === "closed") {
        baseUpdate.closedAt = new Date();
        if (chat.contactId) {
          const messages = await storage.getLiveChatMessages(chatId);
          if (messages.length > 0) {
            const transcript = messages
              .map(m => `[${m.senderType === "agent" ? "Agent" : "Visitor"}] ${m.content}`)
              .join("\n");
            await storage.createNote({
              entityType: "contact",
              entityId: chat.contactId,
              content: `Live chat transcript (${new Date(chat.createdAt).toLocaleString()}):\n\n${transcript}`,
              authorName: "System",
              pinned: false,
            });
          }
        }
      }

      const updated = await storage.updateLiveChat(chatId, baseUpdate);
      res.json(updated);
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err instanceof Error ? err.message : "Internal error" });
    }
  });
}
