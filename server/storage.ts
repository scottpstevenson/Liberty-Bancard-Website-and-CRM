import { db } from "./db";
import {
  contacts, companies, deals, tickets, tasks, documents, auditLogs, notifications, workflowRuns, workflows, rfis,
  messageTemplates, collateralPackets, ghlActivityLog, slaConfigs,
  prospects, prospectLists, enrichmentJobs, campaigns, campaignSteps, outboundMessages, notes,
  emailLogs, callLogs, stageAutomationRules, followUpSequences, sequenceSteps, sequenceEnrollments,
  sunbizEntities,
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
  type Prospect, type InsertProspect, type UpdateProspectRequest,
  type InsertProspectList,
  type InsertEnrichmentJob,
  type InsertCampaign, type UpdateCampaignRequest,
  type InsertCampaignStep,
  type InsertOutboundMessage, type UpdateOutboundMessageRequest,
  type InsertNote,
  type InsertEmailLog, type InsertCallLog, type InsertStageAutomationRule, type InsertFollowUpSequence, type InsertSequenceStep, type InsertSequenceEnrollment,
  type InsertSunbizEntity, type UpdateSunbizEntityRequest, type SunbizEntity,
} from "@shared/schema";
import { eq, desc, and, lt, isNull, ne, sql, asc } from "drizzle-orm";

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
  getDealsByContact(contactId: number): Promise<typeof deals.$inferSelect[]>;
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
  getWorkflowRun(id: number): Promise<typeof workflowRuns.$inferSelect | undefined>;
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

  getProspectLists(): Promise<typeof prospectLists.$inferSelect[]>;
  getProspectList(id: number): Promise<typeof prospectLists.$inferSelect | undefined>;
  createProspectList(list: InsertProspectList): Promise<typeof prospectLists.$inferSelect>;
  updateProspectList(id: number, updates: Partial<InsertProspectList>): Promise<typeof prospectLists.$inferSelect | undefined>;

  getProspects(listId?: number): Promise<typeof prospects.$inferSelect[]>;
  getProspect(id: number): Promise<typeof prospects.$inferSelect | undefined>;
  createProspect(prospect: InsertProspect): Promise<typeof prospects.$inferSelect>;
  createProspectsBulk(prospectData: InsertProspect[]): Promise<Prospect[]>;
  updateProspect(id: number, updates: UpdateProspectRequest): Promise<typeof prospects.$inferSelect | undefined>;
  getProspectsByStatus(status: string): Promise<typeof prospects.$inferSelect[]>;
  getProspectsByScore(score: string): Promise<typeof prospects.$inferSelect[]>;

  getEnrichmentJobs(listId?: number): Promise<typeof enrichmentJobs.$inferSelect[]>;
  createEnrichmentJob(job: InsertEnrichmentJob): Promise<typeof enrichmentJobs.$inferSelect>;
  updateEnrichmentJob(id: number, updates: Partial<InsertEnrichmentJob>): Promise<typeof enrichmentJobs.$inferSelect | undefined>;
  getPendingEnrichmentJobs(limit?: number): Promise<typeof enrichmentJobs.$inferSelect[]>;

  getCampaigns(): Promise<typeof campaigns.$inferSelect[]>;
  getCampaign(id: number): Promise<typeof campaigns.$inferSelect | undefined>;
  createCampaign(campaign: InsertCampaign): Promise<typeof campaigns.$inferSelect>;
  updateCampaign(id: number, updates: UpdateCampaignRequest): Promise<typeof campaigns.$inferSelect | undefined>;

  getCampaignSteps(campaignId: number): Promise<typeof campaignSteps.$inferSelect[]>;
  createCampaignStep(step: InsertCampaignStep): Promise<typeof campaignSteps.$inferSelect>;
  updateCampaignStep(id: number, updates: Partial<InsertCampaignStep>): Promise<typeof campaignSteps.$inferSelect | undefined>;
  deleteCampaignStep(id: number): Promise<void>;

  getOutboundMessages(campaignId?: number): Promise<typeof outboundMessages.$inferSelect[]>;
  getOutboundMessage(id: number): Promise<typeof outboundMessages.$inferSelect | undefined>;
  createOutboundMessage(msg: InsertOutboundMessage): Promise<typeof outboundMessages.$inferSelect>;
  createOutboundMessagesBulk(msgs: InsertOutboundMessage[]): Promise<typeof outboundMessages.$inferSelect[]>;
  updateOutboundMessage(id: number, updates: UpdateOutboundMessageRequest): Promise<typeof outboundMessages.$inferSelect | undefined>;
  getQueuedMessages(limit: number): Promise<typeof outboundMessages.$inferSelect[]>;
  getOutboundStats(campaignId: number): Promise<{sent: number, opened: number, replied: number, bounced: number}>;

  getNotes(entityType: string, entityId: number): Promise<typeof notes.$inferSelect[]>;
  createNote(note: InsertNote): Promise<typeof notes.$inferSelect>;
  deleteNote(id: number): Promise<void>;

  getEmailLogs(contactId?: number): Promise<typeof emailLogs.$inferSelect[]>;
  createEmailLog(log: InsertEmailLog): Promise<typeof emailLogs.$inferSelect>;

  getCallLogs(contactId?: number): Promise<typeof callLogs.$inferSelect[]>;
  createCallLog(log: InsertCallLog): Promise<typeof callLogs.$inferSelect>;

  getStageAutomationRules(pipeline?: string): Promise<typeof stageAutomationRules.$inferSelect[]>;
  getStageAutomationRule(id: number): Promise<typeof stageAutomationRules.$inferSelect | undefined>;
  createStageAutomationRule(rule: InsertStageAutomationRule): Promise<typeof stageAutomationRules.$inferSelect>;
  updateStageAutomationRule(id: number, updates: Partial<InsertStageAutomationRule>): Promise<typeof stageAutomationRules.$inferSelect | undefined>;
  deleteStageAutomationRule(id: number): Promise<void>;
  getMatchingStageRules(pipeline: string, fromStage: string | null, toStage: string): Promise<typeof stageAutomationRules.$inferSelect[]>;

  getFollowUpSequences(): Promise<typeof followUpSequences.$inferSelect[]>;
  getFollowUpSequence(id: number): Promise<typeof followUpSequences.$inferSelect | undefined>;
  createFollowUpSequence(seq: InsertFollowUpSequence): Promise<typeof followUpSequences.$inferSelect>;
  updateFollowUpSequence(id: number, updates: Partial<InsertFollowUpSequence>): Promise<typeof followUpSequences.$inferSelect | undefined>;
  deleteFollowUpSequence(id: number): Promise<void>;

  getSequenceSteps(sequenceId: number): Promise<typeof sequenceSteps.$inferSelect[]>;
  createSequenceStep(step: InsertSequenceStep): Promise<typeof sequenceSteps.$inferSelect>;
  updateSequenceStep(id: number, updates: Partial<InsertSequenceStep>): Promise<typeof sequenceSteps.$inferSelect | undefined>;
  deleteSequenceStep(id: number): Promise<void>;

  getSequenceEnrollments(sequenceId?: number): Promise<typeof sequenceEnrollments.$inferSelect[]>;
  getContactEnrollments(contactId: number): Promise<typeof sequenceEnrollments.$inferSelect[]>;
  createSequenceEnrollment(enrollment: InsertSequenceEnrollment): Promise<typeof sequenceEnrollments.$inferSelect>;
  updateSequenceEnrollment(id: number, updates: Partial<InsertSequenceEnrollment>): Promise<typeof sequenceEnrollments.$inferSelect | undefined>;
  getActiveEnrollments(): Promise<typeof sequenceEnrollments.$inferSelect[]>;

  getSunbizEntities(listId?: number): Promise<SunbizEntity[]>;
  getSunbizEntity(id: number): Promise<SunbizEntity | undefined>;
  getSunbizEntityByFiling(filingNumber: string): Promise<SunbizEntity | undefined>;
  createSunbizEntity(entity: InsertSunbizEntity): Promise<SunbizEntity>;
  createSunbizEntitiesBulk(entities: InsertSunbizEntity[]): Promise<SunbizEntity[]>;
  updateSunbizEntity(id: number, updates: UpdateSunbizEntityRequest): Promise<SunbizEntity | undefined>;
  getSunbizEntitiesByStatus(status: string): Promise<SunbizEntity[]>;
  getSunbizStats(listId?: number): Promise<{total: number, enriched: number, pending: number, withEmail: number, withPhone: number, withWebsite: number}>;
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

  async getDealsByContact(contactId: number) {
    return await db.select().from(deals).where(eq(deals.contactId, contactId)).orderBy(desc(deals.createdAt));
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

  async getWorkflowRun(id: number) {
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, id));
    return run;
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

  async getProspectLists() {
    return await db.select().from(prospectLists).orderBy(desc(prospectLists.createdAt));
  }

  async getProspectList(id: number) {
    const [list] = await db.select().from(prospectLists).where(eq(prospectLists.id, id));
    return list;
  }

  async createProspectList(list: InsertProspectList) {
    const [created] = await db.insert(prospectLists).values(list).returning();
    return created;
  }

  async updateProspectList(id: number, updates: Partial<InsertProspectList>) {
    const [updated] = await db.update(prospectLists).set({ ...updates, updatedAt: new Date() }).where(eq(prospectLists.id, id)).returning();
    return updated;
  }

  async getProspects(listId?: number) {
    if (listId) {
      return await db.select().from(prospects).where(eq(prospects.listId, listId)).orderBy(desc(prospects.createdAt));
    }
    return await db.select().from(prospects).orderBy(desc(prospects.createdAt));
  }

  async getProspect(id: number) {
    const [prospect] = await db.select().from(prospects).where(eq(prospects.id, id));
    return prospect;
  }

  async createProspect(prospect: InsertProspect) {
    const [created] = await db.insert(prospects).values(prospect).returning();
    return created;
  }

  async createProspectsBulk(prospectsList: InsertProspect[]) {
    return await db.insert(prospects).values(prospectsList).returning();
  }

  async updateProspect(id: number, updates: UpdateProspectRequest) {
    const [updated] = await db.update(prospects).set({ ...updates, updatedAt: new Date() }).where(eq(prospects.id, id)).returning();
    return updated;
  }

  async getProspectsByStatus(status: string) {
    return await db.select().from(prospects).where(eq(prospects.status, status)).orderBy(desc(prospects.createdAt));
  }

  async getProspectsByScore(score: string) {
    return await db.select().from(prospects).where(eq(prospects.qualificationScore, score)).orderBy(desc(prospects.createdAt));
  }

  async getEnrichmentJobs(listId?: number) {
    if (listId) {
      return await db.select().from(enrichmentJobs).where(eq(enrichmentJobs.listId, listId)).orderBy(desc(enrichmentJobs.createdAt));
    }
    return await db.select().from(enrichmentJobs).orderBy(desc(enrichmentJobs.createdAt));
  }

  async createEnrichmentJob(job: InsertEnrichmentJob) {
    const [created] = await db.insert(enrichmentJobs).values(job).returning();
    return created;
  }

  async updateEnrichmentJob(id: number, updates: Partial<InsertEnrichmentJob>) {
    const [updated] = await db.update(enrichmentJobs).set(updates).where(eq(enrichmentJobs.id, id)).returning();
    return updated;
  }

  async getPendingEnrichmentJobs(limit?: number) {
    const query = db.select().from(enrichmentJobs).where(eq(enrichmentJobs.status, "pending")).orderBy(asc(enrichmentJobs.createdAt));
    if (limit) {
      return await query.limit(limit);
    }
    return await query;
  }

  async getCampaigns() {
    return await db.select().from(campaigns).orderBy(desc(campaigns.createdAt));
  }

  async getCampaign(id: number) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    return campaign;
  }

  async createCampaign(campaign: InsertCampaign) {
    const [created] = await db.insert(campaigns).values(campaign).returning();
    return created;
  }

  async updateCampaign(id: number, updates: UpdateCampaignRequest) {
    const [updated] = await db.update(campaigns).set({ ...updates, updatedAt: new Date() }).where(eq(campaigns.id, id)).returning();
    return updated;
  }

  async getCampaignSteps(campaignId: number) {
    return await db.select().from(campaignSteps).where(eq(campaignSteps.campaignId, campaignId)).orderBy(asc(campaignSteps.stepOrder));
  }

  async createCampaignStep(step: InsertCampaignStep) {
    const [created] = await db.insert(campaignSteps).values(step).returning();
    return created;
  }

  async updateCampaignStep(id: number, updates: Partial<InsertCampaignStep>) {
    const [updated] = await db.update(campaignSteps).set(updates).where(eq(campaignSteps.id, id)).returning();
    return updated;
  }

  async deleteCampaignStep(id: number) {
    await db.delete(campaignSteps).where(eq(campaignSteps.id, id));
  }

  async getOutboundMessages(campaignId?: number) {
    if (campaignId) {
      return await db.select().from(outboundMessages).where(eq(outboundMessages.campaignId, campaignId)).orderBy(desc(outboundMessages.createdAt));
    }
    return await db.select().from(outboundMessages).orderBy(desc(outboundMessages.createdAt));
  }

  async getOutboundMessage(id: number) {
    const [msg] = await db.select().from(outboundMessages).where(eq(outboundMessages.id, id));
    return msg;
  }

  async createOutboundMessage(msg: InsertOutboundMessage) {
    const [created] = await db.insert(outboundMessages).values(msg).returning();
    return created;
  }

  async createOutboundMessagesBulk(msgs: InsertOutboundMessage[]) {
    return await db.insert(outboundMessages).values(msgs).returning();
  }

  async updateOutboundMessage(id: number, updates: UpdateOutboundMessageRequest) {
    const [updated] = await db.update(outboundMessages).set(updates).where(eq(outboundMessages.id, id)).returning();
    return updated;
  }

  async getQueuedMessages(limit: number) {
    return await db.select().from(outboundMessages)
      .where(eq(outboundMessages.status, "queued"))
      .orderBy(asc(outboundMessages.scheduledFor))
      .limit(limit);
  }

  async getOutboundStats(campaignId: number) {
    const result = await db.select({
      sent: sql<number>`count(*) filter (where ${outboundMessages.status} = 'sent' or ${outboundMessages.status} = 'delivered' or ${outboundMessages.status} = 'opened' or ${outboundMessages.status} = 'replied')`,
      opened: sql<number>`count(*) filter (where ${outboundMessages.status} = 'opened' or ${outboundMessages.status} = 'replied')`,
      replied: sql<number>`count(*) filter (where ${outboundMessages.status} = 'replied')`,
      bounced: sql<number>`count(*) filter (where ${outboundMessages.status} = 'bounced')`,
    }).from(outboundMessages).where(eq(outboundMessages.campaignId, campaignId));
    return result[0] ?? { sent: 0, opened: 0, replied: 0, bounced: 0 };
  }
  async getNotes(entityType: string, entityId: number) {
    return await db.select().from(notes).where(and(eq(notes.entityType, entityType), eq(notes.entityId, entityId))).orderBy(desc(notes.createdAt));
  }

  async createNote(note: InsertNote) {
    const [created] = await db.insert(notes).values(note).returning();
    return created;
  }

  async deleteNote(id: number) {
    await db.delete(notes).where(eq(notes.id, id));
  }

  async getEmailLogs(contactId?: number) {
    if (contactId) {
      return await db.select().from(emailLogs).where(eq(emailLogs.contactId, contactId)).orderBy(desc(emailLogs.createdAt));
    }
    return await db.select().from(emailLogs).orderBy(desc(emailLogs.createdAt));
  }

  async createEmailLog(log: InsertEmailLog) {
    const [created] = await db.insert(emailLogs).values(log).returning();
    return created;
  }

  async getCallLogs(contactId?: number) {
    if (contactId) {
      return await db.select().from(callLogs).where(eq(callLogs.contactId, contactId)).orderBy(desc(callLogs.createdAt));
    }
    return await db.select().from(callLogs).orderBy(desc(callLogs.createdAt));
  }

  async createCallLog(log: InsertCallLog) {
    const [created] = await db.insert(callLogs).values(log).returning();
    return created;
  }

  async getStageAutomationRules(pipeline?: string) {
    if (pipeline) {
      return await db.select().from(stageAutomationRules).where(eq(stageAutomationRules.pipeline, pipeline)).orderBy(desc(stageAutomationRules.priority));
    }
    return await db.select().from(stageAutomationRules).orderBy(desc(stageAutomationRules.priority));
  }

  async getStageAutomationRule(id: number) {
    const [rule] = await db.select().from(stageAutomationRules).where(eq(stageAutomationRules.id, id));
    return rule;
  }

  async createStageAutomationRule(rule: InsertStageAutomationRule) {
    const [created] = await db.insert(stageAutomationRules).values(rule).returning();
    return created;
  }

  async updateStageAutomationRule(id: number, updates: Partial<InsertStageAutomationRule>) {
    const [updated] = await db.update(stageAutomationRules).set({ ...updates, updatedAt: new Date() }).where(eq(stageAutomationRules.id, id)).returning();
    return updated;
  }

  async deleteStageAutomationRule(id: number) {
    await db.delete(stageAutomationRules).where(eq(stageAutomationRules.id, id));
  }

  async getMatchingStageRules(pipeline: string, fromStage: string | null, toStage: string) {
    return await db.select().from(stageAutomationRules).where(
      and(
        eq(stageAutomationRules.pipeline, pipeline),
        eq(stageAutomationRules.toStage, toStage),
        eq(stageAutomationRules.enabled, true),
        fromStage
          ? sql`(${stageAutomationRules.fromStage} IS NULL OR ${stageAutomationRules.fromStage} = ${fromStage})`
          : isNull(stageAutomationRules.fromStage)
      )
    ).orderBy(desc(stageAutomationRules.priority));
  }

  async getFollowUpSequences() {
    return await db.select().from(followUpSequences).orderBy(desc(followUpSequences.createdAt));
  }

  async getFollowUpSequence(id: number) {
    const [seq] = await db.select().from(followUpSequences).where(eq(followUpSequences.id, id));
    return seq;
  }

  async createFollowUpSequence(seq: InsertFollowUpSequence) {
    const [created] = await db.insert(followUpSequences).values(seq).returning();
    return created;
  }

  async updateFollowUpSequence(id: number, updates: Partial<InsertFollowUpSequence>) {
    const [updated] = await db.update(followUpSequences).set({ ...updates, updatedAt: new Date() }).where(eq(followUpSequences.id, id)).returning();
    return updated;
  }

  async deleteFollowUpSequence(id: number) {
    await db.delete(followUpSequences).where(eq(followUpSequences.id, id));
  }

  async getSequenceSteps(sequenceId: number) {
    return await db.select().from(sequenceSteps).where(eq(sequenceSteps.sequenceId, sequenceId)).orderBy(asc(sequenceSteps.stepOrder));
  }

  async createSequenceStep(step: InsertSequenceStep) {
    const [created] = await db.insert(sequenceSteps).values(step).returning();
    return created;
  }

  async updateSequenceStep(id: number, updates: Partial<InsertSequenceStep>) {
    const [updated] = await db.update(sequenceSteps).set(updates).where(eq(sequenceSteps.id, id)).returning();
    return updated;
  }

  async deleteSequenceStep(id: number) {
    await db.delete(sequenceSteps).where(eq(sequenceSteps.id, id));
  }

  async getSequenceEnrollments(sequenceId?: number) {
    if (sequenceId) {
      return await db.select().from(sequenceEnrollments).where(eq(sequenceEnrollments.sequenceId, sequenceId)).orderBy(desc(sequenceEnrollments.createdAt));
    }
    return await db.select().from(sequenceEnrollments).orderBy(desc(sequenceEnrollments.createdAt));
  }

  async getContactEnrollments(contactId: number) {
    return await db.select().from(sequenceEnrollments).where(eq(sequenceEnrollments.contactId, contactId)).orderBy(desc(sequenceEnrollments.createdAt));
  }

  async createSequenceEnrollment(enrollment: InsertSequenceEnrollment) {
    const [created] = await db.insert(sequenceEnrollments).values(enrollment).returning();
    return created;
  }

  async updateSequenceEnrollment(id: number, updates: Partial<InsertSequenceEnrollment>) {
    const [updated] = await db.update(sequenceEnrollments).set({ ...updates, updatedAt: new Date() }).where(eq(sequenceEnrollments.id, id)).returning();
    return updated;
  }

  async getActiveEnrollments() {
    const now = new Date();
    return await db.select().from(sequenceEnrollments).where(
      and(
        eq(sequenceEnrollments.status, "active"),
        sql`${sequenceEnrollments.nextActionAt} IS NOT NULL`,
        sql`${sequenceEnrollments.nextActionAt} <= ${now}`
      )
    );
  }

  async getSunbizEntities(listId?: number) {
    if (listId) {
      return await db.select().from(sunbizEntities).where(eq(sunbizEntities.listId, listId)).orderBy(desc(sunbizEntities.createdAt));
    }
    return await db.select().from(sunbizEntities).orderBy(desc(sunbizEntities.createdAt));
  }

  async getSunbizEntity(id: number) {
    const [entity] = await db.select().from(sunbizEntities).where(eq(sunbizEntities.id, id));
    return entity;
  }

  async getSunbizEntityByFiling(filingNumber: string) {
    const [entity] = await db.select().from(sunbizEntities).where(eq(sunbizEntities.filingNumber, filingNumber));
    return entity;
  }

  async createSunbizEntity(entity: InsertSunbizEntity) {
    const [created] = await db.insert(sunbizEntities).values(entity).returning();
    return created;
  }

  async createSunbizEntitiesBulk(entities: InsertSunbizEntity[]) {
    if (entities.length === 0) return [];
    const created = await db.insert(sunbizEntities).values(entities).returning();
    return created;
  }

  async updateSunbizEntity(id: number, updates: UpdateSunbizEntityRequest) {
    const [updated] = await db.update(sunbizEntities).set({ ...updates, updatedAt: new Date() }).where(eq(sunbizEntities.id, id)).returning();
    return updated;
  }

  async getSunbizEntitiesByStatus(status: string) {
    return await db.select().from(sunbizEntities).where(eq(sunbizEntities.enrichmentStatus, status)).orderBy(desc(sunbizEntities.createdAt));
  }

  async getSunbizStats(listId?: number) {
    const condition = listId ? sql`list_id = ${listId}` : sql`1=1`;
    const result = await db.execute(sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE enrichment_status = 'enriched')::int as enriched,
        COUNT(*) FILTER (WHERE enrichment_status = 'pending')::int as pending,
        COUNT(*) FILTER (WHERE email IS NOT NULL OR owner_email IS NOT NULL)::int as with_email,
        COUNT(*) FILTER (WHERE phone IS NOT NULL OR owner_phone IS NOT NULL)::int as with_phone,
        COUNT(*) FILTER (WHERE website IS NOT NULL)::int as with_website
      FROM sunbiz_entities
      WHERE ${condition}
    `);
    const rows = (result as any).rows || [];
    const row = rows[0] || {};
    return {
      total: Number(row.total) || 0,
      enriched: Number(row.enriched) || 0,
      pending: Number(row.pending) || 0,
      withEmail: Number(row.with_email) || 0,
      withPhone: Number(row.with_phone) || 0,
      withWebsite: Number(row.with_website) || 0,
    };
  }
}

export const storage = new DatabaseStorage();
