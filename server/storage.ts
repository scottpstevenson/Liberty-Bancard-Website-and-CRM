import { db } from "./db";
import {
  contacts, companies, deals, tickets, tasks, documents, auditLogs, notifications, workflowRuns, workflows,
  type InsertContact, type UpdateContactRequest,
  type InsertCompany,
  type InsertDeal, type UpdateDealRequest,
  type InsertTicket, type UpdateTicketRequest,
  type InsertTask, type UpdateTaskRequest,
  type InsertDocument,
  type InsertAuditLog,
  type InsertNotification,
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  getContacts(): Promise<typeof contacts.$inferSelect[]>;
  getContact(id: number): Promise<typeof contacts.$inferSelect | undefined>;
  createContact(contact: InsertContact): Promise<typeof contacts.$inferSelect>;
  updateContact(id: number, contact: UpdateContactRequest): Promise<typeof contacts.$inferSelect | undefined>;

  getCompanies(): Promise<typeof companies.$inferSelect[]>;
  createCompany(company: InsertCompany): Promise<typeof companies.$inferSelect>;

  getDeals(): Promise<typeof deals.$inferSelect[]>;
  getDeal(id: number): Promise<typeof deals.$inferSelect | undefined>;
  getDealsByPipeline(pipeline: string): Promise<typeof deals.$inferSelect[]>;
  createDeal(deal: InsertDeal): Promise<typeof deals.$inferSelect>;
  updateDeal(id: number, deal: UpdateDealRequest): Promise<typeof deals.$inferSelect | undefined>;

  getTickets(): Promise<typeof tickets.$inferSelect[]>;
  getTicket(id: number): Promise<typeof tickets.$inferSelect | undefined>;
  createTicket(ticket: InsertTicket): Promise<typeof tickets.$inferSelect>;
  updateTicket(id: number, ticket: UpdateTicketRequest): Promise<typeof tickets.$inferSelect | undefined>;

  getTasks(): Promise<typeof tasks.$inferSelect[]>;
  createTask(task: InsertTask): Promise<typeof tasks.$inferSelect>;
  updateTask(id: number, task: UpdateTaskRequest): Promise<typeof tasks.$inferSelect | undefined>;

  getDocuments(): Promise<typeof documents.$inferSelect[]>;
  createDocument(doc: InsertDocument): Promise<typeof documents.$inferSelect>;

  getAuditLogs(): Promise<typeof auditLogs.$inferSelect[]>;
  createAuditLog(log: InsertAuditLog): Promise<typeof auditLogs.$inferSelect>;

  getNotifications(): Promise<typeof notifications.$inferSelect[]>;
  createNotification(notification: InsertNotification): Promise<typeof notifications.$inferSelect>;
  markNotificationRead(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getContacts() {
    return await db.select().from(contacts).orderBy(desc(contacts.createdAt));
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
    const [updated] = await db.update(contacts).set({ ...updates, updatedAt: new Date() }).where(eq(contacts.id, id)).returning();
    return updated;
  }

  async getCompanies() {
    return await db.select().from(companies).orderBy(desc(companies.createdAt));
  }

  async createCompany(insertCompany: InsertCompany) {
    const [company] = await db.insert(companies).values(insertCompany).returning();
    return company;
  }

  async getDeals() {
    return await db.select().from(deals).orderBy(desc(deals.createdAt));
  }

  async getDeal(id: number) {
    const [deal] = await db.select().from(deals).where(eq(deals.id, id));
    return deal;
  }

  async getDealsByPipeline(pipeline: string) {
    return await db.select().from(deals).where(eq(deals.pipeline, pipeline)).orderBy(desc(deals.createdAt));
  }

  async createDeal(insertDeal: InsertDeal) {
    const [deal] = await db.insert(deals).values(insertDeal).returning();
    return deal;
  }

  async updateDeal(id: number, updates: UpdateDealRequest) {
    const [updated] = await db.update(deals).set({ ...updates, updatedAt: new Date() }).where(eq(deals.id, id)).returning();
    return updated;
  }

  async getTickets() {
    return await db.select().from(tickets).orderBy(desc(tickets.createdAt));
  }

  async getTicket(id: number) {
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id));
    return ticket;
  }

  async createTicket(insertTicket: InsertTicket) {
    const slaHours = insertTicket.priority === "Urgent" ? 1 : 4;
    const slaDeadline = new Date(Date.now() + slaHours * 60 * 60 * 1000);
    const [ticket] = await db.insert(tickets).values({ ...insertTicket, slaDeadline }).returning();
    return ticket;
  }

  async updateTicket(id: number, updates: UpdateTicketRequest) {
    const [updated] = await db.update(tickets).set({ ...updates, updatedAt: new Date() }).where(eq(tickets.id, id)).returning();
    return updated;
  }

  async getTasks() {
    return await db.select().from(tasks).orderBy(desc(tasks.createdAt));
  }

  async createTask(insertTask: InsertTask) {
    const [task] = await db.insert(tasks).values(insertTask).returning();
    return task;
  }

  async updateTask(id: number, updates: UpdateTaskRequest) {
    const [updated] = await db.update(tasks).set(updates).where(eq(tasks.id, id)).returning();
    return updated;
  }

  async getDocuments() {
    return await db.select().from(documents).orderBy(desc(documents.createdAt));
  }

  async createDocument(insertDoc: InsertDocument) {
    const [doc] = await db.insert(documents).values(insertDoc).returning();
    return doc;
  }

  async getAuditLogs() {
    return await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt));
  }

  async createAuditLog(insertLog: InsertAuditLog) {
    const [log] = await db.insert(auditLogs).values(insertLog).returning();
    return log;
  }

  async getNotifications() {
    return await db.select().from(notifications).orderBy(desc(notifications.createdAt));
  }

  async createNotification(insertNotification: InsertNotification) {
    const [notification] = await db.insert(notifications).values(insertNotification).returning();
    return notification;
  }

  async markNotificationRead(id: number) {
    await db.update(notifications).set({ read: true }).where(eq(notifications.id, id));
  }
}

export const storage = new DatabaseStorage();
