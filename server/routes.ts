import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { registerAudioRoutes } from "./replit_integrations/audio/routes";
import { api } from "@shared/routes";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // 1. Setup Auth
  await setupAuth(app);
  registerAuthRoutes(app);

  // 2. Setup Audio/Chat
  registerAudioRoutes(app);

  // 3. CRM Routes
  
  // Contacts
  app.get(api.contacts.list.path, async (req, res) => {
    const contacts = await storage.getContacts();
    res.json(contacts);
  });

  app.post(api.contacts.create.path, async (req, res) => {
    try {
      const input = api.contacts.create.input.parse(req.body);
      const contact = await storage.createContact(input);
      res.status(201).json(contact);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.get(api.contacts.get.path, async (req, res) => {
    const contact = await storage.getContact(Number(req.params.id));
    if (!contact) return res.status(404).json({ message: "Not found" });
    res.json(contact);
  });

  app.put(api.contacts.update.path, async (req, res) => {
    const updated = await storage.updateContact(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  // Tickets
  app.get(api.tickets.list.path, async (req, res) => {
    const tickets = await storage.getTickets();
    res.json(tickets);
  });

  app.post(api.tickets.create.path, async (req, res) => {
    const input = api.tickets.create.input.parse(req.body);
    const ticket = await storage.createTicket(input);
    res.status(201).json(ticket);
  });

  app.put(api.tickets.update.path, async (req, res) => {
    const updated = await storage.updateTicket(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  // Seed Data
  await seedDatabase();

  return httpServer;
}

async function seedDatabase() {
  const existingContacts = await storage.getContacts();
  if (existingContacts.length === 0) {
    await storage.createContact({
      firstName: "John",
      lastName: "Doe",
      email: "john@doedental.com",
      phone: "555-0123",
      companyName: "Doe Dental",
      vertical: "Medical",
      monthlyVolume: "$50k - $100k",
      status: "New"
    });
    await storage.createContact({
      firstName: "Jane",
      lastName: "Smith",
      email: "jane@bistro.com",
      phone: "555-0124",
      companyName: "Jane's Bistro",
      vertical: "Restaurant",
      monthlyVolume: "$100k+",
      status: "Proposal"
    });
  }
}
