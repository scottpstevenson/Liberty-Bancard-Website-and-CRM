import { db } from "./db";
import { contacts, tickets, type InsertContact, type InsertTicket, type UpdateContactRequest, type UpdateTicketRequest } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface IStorage {
  // Contacts
  getContacts(): Promise<typeof contacts.$inferSelect[]>;
  getContact(id: number): Promise<typeof contacts.$inferSelect | undefined>;
  createContact(contact: InsertContact): Promise<typeof contacts.$inferSelect>;
  updateContact(id: number, contact: UpdateContactRequest): Promise<typeof contacts.$inferSelect | undefined>;
  
  // Tickets
  getTickets(): Promise<typeof tickets.$inferSelect[]>;
  createTicket(ticket: InsertTicket): Promise<typeof tickets.$inferSelect>;
  updateTicket(id: number, ticket: UpdateTicketRequest): Promise<typeof tickets.$inferSelect | undefined>;
}

export class DatabaseStorage implements IStorage {
  // Contacts
  async getContacts() {
    return await db.select().from(contacts);
  }

  async getContact(id: number) {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
    return contact;
  }

  async createContact(insertContact: InsertContact) {
    const [contact] = await db.insert(contacts).values(insertContact).returning();
    return contact;
  }

  async updateContact(id: number, updates: UpdateContactRequest) {
    const [updated] = await db.update(contacts)
      .set(updates)
      .where(eq(contacts.id, id))
      .returning();
    return updated;
  }

  // Tickets
  async getTickets() {
    return await db.select().from(tickets);
  }

  async createTicket(insertTicket: InsertTicket) {
    const [ticket] = await db.insert(tickets).values(insertTicket).returning();
    return ticket;
  }

  async updateTicket(id: number, updates: UpdateTicketRequest) {
    const [updated] = await db.update(tickets)
      .set(updates)
      .where(eq(tickets.id, id))
      .returning();
    return updated;
  }
}

export const storage = new DatabaseStorage();
