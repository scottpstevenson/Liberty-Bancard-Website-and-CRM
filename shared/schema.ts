import { pgTable, text, serial, integer, boolean, timestamp, jsonb, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Export Auth & Chat models so they are available
export * from "./models/auth";
export * from "./models/chat";

// === CRM / SALES ===

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  companyName: text("company_name"),
  
  // Lead Qual Fields
  vertical: text("vertical"),
  monthlyVolume: text("monthly_volume"),
  primaryOfferPath: text("primary_offer_path"), // "Wholesale", "0%", "Terminal", etc.
  interestedIn0Percent: boolean("interested_in_0_percent").default(false),
  needTerminal: boolean("need_terminal").default(false),
  
  status: text("status").default("New"), // New, Contacted, Qualified, Proposal, Won, Lost
  ghlContactId: text("ghl_contact_id"), // Sync ID
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertContactSchema = createInsertSchema(contacts).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export const tickets = pgTable("tickets", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  status: text("status").default("Open"), // Open, In Progress, Resolved, Closed
  priority: text("priority").default("Normal"), // Low, Normal, High, Urgent
  category: text("category").default("Support"), // Funding, Terminal, PCI, etc.
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTicketSchema = createInsertSchema(tickets).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

// === EXPLICIT API TYPES ===

// Contact Types
export type Contact = typeof contacts.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;

export type CreateContactRequest = InsertContact;
export type UpdateContactRequest = Partial<InsertContact>;

// Ticket Types
export type Ticket = typeof tickets.$inferSelect;
export type InsertTicket = z.infer<typeof insertTicketSchema>;

export type CreateTicketRequest = InsertTicket;
export type UpdateTicketRequest = Partial<InsertTicket>;
