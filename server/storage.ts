import { db } from "./db";
import {
  contacts, companies, deals, tickets, tasks, documents, auditLogs, notifications, workflowRuns, workflows, rfis,
  messageTemplates, collateralPackets, ghlActivityLog, slaConfigs,
  type InsertContact, type UpdateContactRequest,
  type InsertCompany,
  type InsertDeal, type UpdateDealRequest,
  type InsertTicket, type UpdateTicketRequest,
  type InsertTask, type UpdateTaskRequest,
  type InsertDocument,
  type InsertAuditLog,
  type InsertNotification,
  type InsertWorkflow, type UpdateWorkflowRequest,
  type InsertWorkflowRun,
  type InsertRfi, type UpdateRfiRequest,
  type InsertMessageTemplate, type MessageTemplate,
  type InsertCollateralPacket,
  type InsertGhlActivityLog,
  type InsertSlaConfig,
} from "@shared/schema";
import { eq, desc, and, lt, isNull, ne } from "drizzle-orm";

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

  getWorkflows(): Promise<typeof workflows.$inferSelect[]>;
  getWorkflow(id: number): Promise<typeof workflows.$inferSelect | undefined>;
  createWorkflow(workflow: InsertWorkflow): Promise<typeof workflows.$inferSelect>;
  updateWorkflow(id: number, workflow: UpdateWorkflowRequest): Promise<typeof workflows.$inferSelect | undefined>;
  deleteWorkflow(id: number): Promise<void>;
  getWorkflowsByTrigger(triggerType: string): Promise<typeof workflows.$inferSelect[]>;

  getWorkflowRuns(): Promise<typeof workflowRuns.$inferSelect[]>;
  getWorkflowRunsByWorkflow(workflowId: number): Promise<typeof workflowRuns.$inferSelect[]>;
  createWorkflowRun(run: InsertWorkflowRun): Promise<typeof workflowRuns.$inferSelect>;
  updateWorkflowRun(id: number, updates: Partial<InsertWorkflowRun>): Promise<typeof workflowRuns.$inferSelect | undefined>;

  getRfis(): Promise<typeof rfis.$inferSelect[]>;
  getRfi(id: number): Promise<typeof rfis.$inferSelect | undefined>;
  createRfi(rfi: InsertRfi): Promise<typeof rfis.$inferSelect>;
  updateRfi(id: number, rfi: UpdateRfiRequest): Promise<typeof rfis.$inferSelect | undefined>;

  getMessageTemplates(): Promise<typeof messageTemplates.$inferSelect[]>;
  getMessageTemplate(id: number): Promise<typeof messageTemplates.$inferSelect | undefined>;
  getMessageTemplatesByCategory(category: string): Promise<typeof messageTemplates.$inferSelect[]>;
  createMessageTemplate(template: InsertMessageTemplate): Promise<typeof messageTemplates.$inferSelect>;
  updateMessageTemplate(id: number, updates: Partial<InsertMessageTemplate>): Promise<typeof messageTemplates.$inferSelect | undefined>;

  getCollateralPackets(): Promise<typeof collateralPackets.$inferSelect[]>;
  createCollateralPacket(packet: InsertCollateralPacket): Promise<typeof collateralPackets.$inferSelect>;

  getGhlActivityLogs(contactId?: number): Promise<typeof ghlActivityLog.$inferSelect[]>;
  createGhlActivityLog(log: InsertGhlActivityLog): Promise<typeof ghlActivityLog.$inferSelect>;

  getSlaConfigs(): Promise<typeof slaConfigs.$inferSelect[]>;
  createSlaConfig(config: InsertSlaConfig): Promise<typeof slaConfigs.$inferSelect>;
  updateSlaConfig(id: number, updates: Partial<InsertSlaConfig>): Promise<typeof slaConfigs.$inferSelect | undefined>;

  getDealsStuckInStage(stage: string, maxMinutes: number): Promise<typeof deals.$inferSelect[]>;
  getTicketsBreachingSla(): Promise<typeof tickets.$inferSelect[]>;
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

  async getWorkflows() {
    return await db.select().from(workflows).orderBy(desc(workflows.createdAt));
  }

  async getWorkflow(id: number) {
    const [workflow] = await db.select().from(workflows).where(eq(workflows.id, id));
    return workflow;
  }

  async createWorkflow(insertWorkflow: InsertWorkflow) {
    const [workflow] = await db.insert(workflows).values(insertWorkflow).returning();
    return workflow;
  }

  async updateWorkflow(id: number, updates: UpdateWorkflowRequest) {
    const [updated] = await db.update(workflows).set(updates).where(eq(workflows.id, id)).returning();
    return updated;
  }

  async deleteWorkflow(id: number) {
    await db.delete(workflows).where(eq(workflows.id, id));
  }

  async getWorkflowsByTrigger(triggerType: string) {
    return await db.select().from(workflows).where(eq(workflows.triggerType, triggerType));
  }

  async getWorkflowRuns() {
    return await db.select().from(workflowRuns).orderBy(desc(workflowRuns.createdAt));
  }

  async getWorkflowRunsByWorkflow(workflowId: number) {
    return await db.select().from(workflowRuns).where(eq(workflowRuns.workflowId, workflowId)).orderBy(desc(workflowRuns.createdAt));
  }

  async createWorkflowRun(insertRun: InsertWorkflowRun) {
    const [run] = await db.insert(workflowRuns).values(insertRun).returning();
    return run;
  }

  async updateWorkflowRun(id: number, updates: Partial<InsertWorkflowRun>) {
    const [updated] = await db.update(workflowRuns).set(updates).where(eq(workflowRuns.id, id)).returning();
    return updated;
  }

  async getRfis() {
    return await db.select().from(rfis).orderBy(desc(rfis.createdAt));
  }

  async getRfi(id: number) {
    const [rfi] = await db.select().from(rfis).where(eq(rfis.id, id));
    return rfi;
  }

  async createRfi(insertRfi: InsertRfi) {
    const [rfi] = await db.insert(rfis).values(insertRfi).returning();
    return rfi;
  }

  async updateRfi(id: number, updates: UpdateRfiRequest) {
    const [updated] = await db.update(rfis).set({ ...updates, updatedAt: new Date() }).where(eq(rfis.id, id)).returning();
    return updated;
  }

  async getMessageTemplates() {
    return await db.select().from(messageTemplates).orderBy(desc(messageTemplates.createdAt));
  }

  async getMessageTemplate(id: number) {
    const [template] = await db.select().from(messageTemplates).where(eq(messageTemplates.id, id));
    return template;
  }

  async getMessageTemplatesByCategory(category: string) {
    return await db.select().from(messageTemplates).where(eq(messageTemplates.category, category));
  }

  async createMessageTemplate(template: InsertMessageTemplate) {
    const [created] = await db.insert(messageTemplates).values(template).returning();
    return created;
  }

  async updateMessageTemplate(id: number, updates: Partial<InsertMessageTemplate>) {
    const [updated] = await db.update(messageTemplates).set({ ...updates, updatedAt: new Date() }).where(eq(messageTemplates.id, id)).returning();
    return updated;
  }

  async getCollateralPackets() {
    return await db.select().from(collateralPackets).orderBy(desc(collateralPackets.createdAt));
  }

  async createCollateralPacket(packet: InsertCollateralPacket) {
    const [created] = await db.insert(collateralPackets).values(packet).returning();
    return created;
  }

  async getGhlActivityLogs(contactId?: number) {
    if (contactId) {
      return await db.select().from(ghlActivityLog).where(eq(ghlActivityLog.contactId, contactId)).orderBy(desc(ghlActivityLog.createdAt));
    }
    return await db.select().from(ghlActivityLog).orderBy(desc(ghlActivityLog.createdAt));
  }

  async createGhlActivityLog(log: InsertGhlActivityLog) {
    const [created] = await db.insert(ghlActivityLog).values(log).returning();
    return created;
  }

  async getSlaConfigs() {
    return await db.select().from(slaConfigs).orderBy(desc(slaConfigs.createdAt));
  }

  async createSlaConfig(config: InsertSlaConfig) {
    const [created] = await db.insert(slaConfigs).values(config).returning();
    return created;
  }

  async updateSlaConfig(id: number, updates: Partial<InsertSlaConfig>) {
    const [updated] = await db.update(slaConfigs).set(updates).where(eq(slaConfigs.id, id)).returning();
    return updated;
  }

  async getDealsStuckInStage(stage: string, maxMinutes: number) {
    const cutoff = new Date(Date.now() - maxMinutes * 60 * 1000);
    return await db.select().from(deals)
      .where(and(
        eq(deals.stage, stage),
        lt(deals.updatedAt!, cutoff),
        isNull(deals.closedAt)
      ));
  }

  async getTicketsBreachingSla() {
    const now = new Date();
    return await db.select().from(tickets)
      .where(and(
        lt(tickets.slaDeadline!, now),
        isNull(tickets.resolvedAt),
        ne(tickets.status!, "Resolved"),
        ne(tickets.status!, "Closed")
      ));
  }
}

export const storage = new DatabaseStorage();
