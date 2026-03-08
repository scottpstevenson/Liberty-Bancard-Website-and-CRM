import { db } from "./db";
import {
  contacts, companies, deals, tickets, tasks, documents, auditLogs, notifications, workflowRuns, workflows, rfis,
  messageTemplates, collateralPackets, ghlActivityLog, slaConfigs,
  prospects, prospectLists, enrichmentJobs, campaigns, campaignSteps, outboundMessages, notes,
  emailLogs, callLogs, stageAutomationRules, followUpSequences, sequenceSteps, sequenceEnrollments,
  sunbizEntities, consentAuditLogs, calendarEvents,
  merchantApplications, merchantProfiles, equipmentOrders, agents, agentQuotas, residualReports, merchantResiduals,
  healthAlerts, dealCompetitors, partners, referrals, knowledgeBase, reviewRequests, onboardingSteps,
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
  type InsertMerchantApplication, type MerchantApplication,
  type InsertMerchantProfile, type MerchantProfile,
  type InsertEquipmentOrder, type EquipmentOrder,
  type InsertAgent, type Agent,
  type InsertAgentQuota, type AgentQuota,
  type InsertResidualReport, type ResidualReport,
  type InsertMerchantResidual, type MerchantResidual,
  type InsertHealthAlert, type HealthAlert,
  type InsertDealCompetitor, type DealCompetitor,
  type InsertPartner, type Partner,
  type InsertReferral, type Referral,
  type InsertKnowledgeBaseArticle, type KnowledgeBaseArticle,
  type InsertReviewRequest, type ReviewRequest,
  type InsertOnboardingStep, type OnboardingStep,
  type InsertConsentAuditLog, type ConsentAuditLog,
  type CalendarEvent, type InsertCalendarEvent,
  systemSettings,
  dataDeleteRequests,
  type DataDeleteRequest, type InsertDataDeleteRequest,
  comments, ticketComments, contactCompanies, pipelineStages, notificationPreferences, savedFilters,
  type Comment, type InsertComment,
  type TicketComment, type InsertTicketComment,
  type ContactCompany, type InsertContactCompany,
  type PipelineStage, type InsertPipelineStage,
  type NotificationPreference, type InsertNotificationPreference,
  type SavedFilter, type InsertSavedFilter,
} from "@shared/schema";
import { eq, desc, and, lt, isNull, ne, sql, asc, gte, lte, inArray, or, ilike } from "drizzle-orm";

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
  getSunbizEntitiesByStatus(status: string, limit?: number): Promise<SunbizEntity[]>;
  getSunbizStats(listId?: number): Promise<{total: number, enriched: number, pending: number, withEmail: number, withPhone: number, withWebsite: number}>;

  getMerchantApplications(): Promise<MerchantApplication[]>;
  getMerchantApplication(id: number): Promise<MerchantApplication | undefined>;
  getMerchantApplicationByUser(userId: string): Promise<MerchantApplication | undefined>;
  createMerchantApplication(app: InsertMerchantApplication): Promise<MerchantApplication>;
  updateMerchantApplication(id: number, updates: Partial<InsertMerchantApplication>): Promise<MerchantApplication | undefined>;

  getMerchantProfiles(): Promise<MerchantProfile[]>;
  getMerchantProfile(id: number): Promise<MerchantProfile | undefined>;
  getMerchantProfileByUser(userId: string): Promise<MerchantProfile | undefined>;
  createMerchantProfile(profile: InsertMerchantProfile): Promise<MerchantProfile>;
  updateMerchantProfile(id: number, updates: Partial<InsertMerchantProfile>): Promise<MerchantProfile | undefined>;

  getEquipmentOrders(dealId?: number): Promise<EquipmentOrder[]>;
  getEquipmentOrder(id: number): Promise<EquipmentOrder | undefined>;
  getEquipmentOrdersByDeal(dealId: number): Promise<EquipmentOrder[]>;
  createEquipmentOrder(order: InsertEquipmentOrder): Promise<EquipmentOrder>;
  updateEquipmentOrder(id: number, updates: Partial<InsertEquipmentOrder>): Promise<EquipmentOrder | undefined>;

  getAgents(): Promise<Agent[]>;
  getAgent(id: number): Promise<Agent | undefined>;
  createAgent(agent: InsertAgent): Promise<Agent>;
  updateAgent(id: number, updates: Partial<InsertAgent>): Promise<Agent | undefined>;

  getResidualReports(): Promise<ResidualReport[]>;
  getResidualReport(id: number): Promise<ResidualReport | undefined>;
  getResidualReportsByMonth(month: string): Promise<ResidualReport[]>;
  createResidualReport(report: InsertResidualReport): Promise<ResidualReport>;

  getMerchantResiduals(reportId?: number): Promise<MerchantResidual[]>;
  getMerchantResidual(id: number): Promise<MerchantResidual | undefined>;
  getMerchantResidualsByDeal(dealId: number): Promise<MerchantResidual[]>;
  getMerchantResidualsByMonth(month: string): Promise<MerchantResidual[]>;
  createMerchantResidual(residual: InsertMerchantResidual): Promise<MerchantResidual>;

  getHealthAlerts(): Promise<HealthAlert[]>;
  getHealthAlert(id: number): Promise<HealthAlert | undefined>;
  getHealthAlertsByDeal(dealId: number): Promise<HealthAlert[]>;
  getActiveHealthAlerts(): Promise<HealthAlert[]>;
  createHealthAlert(alert: InsertHealthAlert): Promise<HealthAlert>;
  updateHealthAlert(id: number, updates: Partial<InsertHealthAlert>): Promise<HealthAlert | undefined>;

  getDealCompetitors(dealId?: number): Promise<DealCompetitor[]>;
  getDealCompetitor(id: number): Promise<DealCompetitor | undefined>;
  getDealCompetitorsByDeal(dealId: number): Promise<DealCompetitor[]>;
  createDealCompetitor(competitor: InsertDealCompetitor): Promise<DealCompetitor>;
  updateDealCompetitor(id: number, updates: Partial<InsertDealCompetitor>): Promise<DealCompetitor | undefined>;

  getPartners(): Promise<Partner[]>;
  getPartner(id: number): Promise<Partner | undefined>;
  getPartnerByCode(code: string): Promise<Partner | undefined>;
  getPartnerByEmail(email: string): Promise<Partner | undefined>;
  createPartner(partner: InsertPartner): Promise<Partner>;
  updatePartner(id: number, updates: Partial<InsertPartner>): Promise<Partner | undefined>;

  getReferrals(partnerId?: number): Promise<Referral[]>;
  getReferral(id: number): Promise<Referral | undefined>;
  getReferralsByPartner(partnerId: number): Promise<Referral[]>;
  createReferral(referral: InsertReferral): Promise<Referral>;
  updateReferral(id: number, updates: Partial<InsertReferral>): Promise<Referral | undefined>;

  getKnowledgeBaseArticles(): Promise<KnowledgeBaseArticle[]>;
  getKnowledgeBaseArticle(id: number): Promise<KnowledgeBaseArticle | undefined>;
  getKnowledgeBaseByCategory(category: string): Promise<KnowledgeBaseArticle[]>;
  getPublishedArticles(): Promise<KnowledgeBaseArticle[]>;
  createKnowledgeBaseArticle(article: InsertKnowledgeBaseArticle): Promise<KnowledgeBaseArticle>;
  updateKnowledgeBaseArticle(id: number, updates: Partial<InsertKnowledgeBaseArticle>): Promise<KnowledgeBaseArticle | undefined>;

  getReviewRequests(dealId?: number): Promise<ReviewRequest[]>;
  getReviewRequest(id: number): Promise<ReviewRequest | undefined>;
  getReviewRequestsByDeal(dealId: number): Promise<ReviewRequest[]>;
  createReviewRequest(request: InsertReviewRequest): Promise<ReviewRequest>;
  updateReviewRequest(id: number, updates: Partial<InsertReviewRequest>): Promise<ReviewRequest | undefined>;

  getOnboardingSteps(dealId?: number): Promise<OnboardingStep[]>;
  getOnboardingStep(id: number): Promise<OnboardingStep | undefined>;
  getOnboardingStepsByDeal(dealId: number): Promise<OnboardingStep[]>;
  getOnboardingStepsByApplication(applicationId: number): Promise<OnboardingStep[]>;
  createOnboardingStep(step: InsertOnboardingStep): Promise<OnboardingStep>;
  updateOnboardingStep(id: number, updates: Partial<InsertOnboardingStep>): Promise<OnboardingStep | undefined>;

  getConsentAuditLogs(): Promise<ConsentAuditLog[]>;
  getConsentAuditLogsByContact(contactId: number): Promise<ConsentAuditLog[]>;
  createConsentAuditLog(log: InsertConsentAuditLog): Promise<ConsentAuditLog>;

  getCalendarEvents(): Promise<CalendarEvent[]>;
  getCalendarEventsByDateRange(start: Date, end: Date): Promise<CalendarEvent[]>;
  createCalendarEvent(event: InsertCalendarEvent): Promise<CalendarEvent>;
  updateCalendarEvent(id: number, data: Partial<InsertCalendarEvent>): Promise<CalendarEvent | undefined>;
  deleteCalendarEvent(id: number): Promise<void>;

  getAgentQuotas(): Promise<AgentQuota[]>;
  getAgentQuotasByAgent(agentId: number): Promise<AgentQuota[]>;
  createAgentQuota(quota: InsertAgentQuota): Promise<AgentQuota>;
  updateAgentQuota(id: number, data: Partial<AgentQuota>): Promise<AgentQuota | undefined>;

  getDataDeleteRequests(): Promise<DataDeleteRequest[]>;
  createDataDeleteRequest(req: InsertDataDeleteRequest): Promise<DataDeleteRequest>;
  updateDataDeleteRequest(id: number, data: Partial<DataDeleteRequest>): Promise<DataDeleteRequest | undefined>;

  getComments(entityType: string, entityId: number): Promise<Comment[]>;
  createComment(comment: InsertComment): Promise<Comment>;
  deleteComment(id: number): Promise<void>;
  updateComment(id: number, updates: Partial<InsertComment>): Promise<Comment | undefined>;

  getTicketComments(ticketId: number): Promise<TicketComment[]>;
  createTicketComment(comment: InsertTicketComment): Promise<TicketComment>;

  getContactCompanies(contactId: number): Promise<ContactCompany[]>;
  addContactCompany(link: InsertContactCompany): Promise<ContactCompany>;
  removeContactCompany(id: number): Promise<void>;

  getPipelineStages(pipeline?: string): Promise<PipelineStage[]>;
  createPipelineStage(stage: InsertPipelineStage): Promise<PipelineStage>;
  updatePipelineStage(id: number, updates: Partial<InsertPipelineStage>): Promise<PipelineStage | undefined>;
  deletePipelineStage(id: number): Promise<void>;

  getNotificationPreferences(userId: string): Promise<NotificationPreference[]>;
  upsertNotificationPreference(pref: InsertNotificationPreference): Promise<NotificationPreference>;

  getSavedFilters(userId: string, entityType?: string): Promise<SavedFilter[]>;
  createSavedFilter(filter: InsertSavedFilter): Promise<SavedFilter>;
  deleteSavedFilter(id: number): Promise<void>;

  archiveContact(id: number): Promise<typeof contacts.$inferSelect | undefined>;
  restoreContact(id: number): Promise<typeof contacts.$inferSelect | undefined>;
  archiveDeal(id: number): Promise<typeof deals.$inferSelect | undefined>;
  restoreDeal(id: number): Promise<typeof deals.$inferSelect | undefined>;

  markAllNotificationsRead(userId?: string): Promise<void>;
  clearAllNotifications(userId?: string): Promise<void>;
  bulkUpdateDealStage(dealIds: number[], stage: string): Promise<void>;
  bulkAssignTasks(taskIds: number[], assignedTo: string): Promise<void>;
  deleteTask(id: number): Promise<void>;

  findDuplicateContacts(): Promise<{ email: string; phone: string; contacts: typeof contacts.$inferSelect[] }[]>;
  mergeContacts(primaryId: number, duplicateId: number): Promise<typeof contacts.$inferSelect | undefined>;
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

  async getSunbizEntitiesByStatus(status: string, limit?: number) {
    if (limit) {
      return await db.select().from(sunbizEntities).where(eq(sunbizEntities.enrichmentStatus, status)).orderBy(sunbizEntities.id).limit(limit);
    }
    return await db.select().from(sunbizEntities).where(eq(sunbizEntities.enrichmentStatus, status)).orderBy(desc(sunbizEntities.createdAt));
  }

  async getExistingFilingNumbers(): Promise<Set<string>> {
    const results = await db.select({ filingNumber: sunbizEntities.filingNumber }).from(sunbizEntities).where(sql`filing_number IS NOT NULL`);
    return new Set(results.map(r => r.filingNumber!).filter(Boolean));
  }

  async getSunbizEntityCount(): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(sunbizEntities);
    return result?.count || 0;
  }

  async getSunbizEntitiesNeedingEnrichment(limit: number = 200) {
    return await db.select().from(sunbizEntities)
      .where(sql`enrichment_status = 'enriched' AND (email IS NULL OR email = '') AND (score = 'hot' OR score = 'warm') AND (website IS NULL OR website = '')`)
      .orderBy(sql`CASE WHEN score = 'hot' THEN 0 ELSE 1 END, id`)
      .limit(limit);
  }

  async getSunbizAggregateStats(): Promise<{
    total: number; enriched: number; pending: number; withEmail: number; withPhone: number;
    hot: number; warm: number; cold: number; unqualified: number; classified: number; pendingPromotion: number;
  }> {
    const result = await db.execute(sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE enrichment_status = 'enriched')::int as enriched,
        COUNT(*) FILTER (WHERE enrichment_status = 'pending')::int as pending,
        COUNT(*) FILTER (WHERE email IS NOT NULL)::int as with_email,
        COUNT(*) FILTER (WHERE phone IS NOT NULL)::int as with_phone,
        COUNT(*) FILTER (WHERE score = 'hot')::int as hot,
        COUNT(*) FILTER (WHERE score = 'warm')::int as warm,
        COUNT(*) FILTER (WHERE score = 'cold')::int as cold,
        COUNT(*) FILTER (WHERE score = 'unqualified')::int as unqualified,
        COUNT(*) FILTER (WHERE vertical IS NOT NULL AND vertical != 'Other')::int as classified,
        COUNT(*) FILTER (WHERE (score = 'hot' OR score = 'warm') AND email IS NOT NULL AND prospect_id IS NULL)::int as pending_promotion
      FROM sunbiz_entities
    `);
    const row = ((result as any).rows || [])[0] || {};
    return {
      total: Number(row.total) || 0, enriched: Number(row.enriched) || 0, pending: Number(row.pending) || 0,
      withEmail: Number(row.with_email) || 0, withPhone: Number(row.with_phone) || 0,
      hot: Number(row.hot) || 0, warm: Number(row.warm) || 0, cold: Number(row.cold) || 0,
      unqualified: Number(row.unqualified) || 0, classified: Number(row.classified) || 0,
      pendingPromotion: Number(row.pending_promotion) || 0,
    };
  }

  async getSunbizVerticalBreakdown(): Promise<Record<string, number>> {
    const result = await db.execute(sql`
      SELECT COALESCE(vertical, 'Unclassified') as v, COUNT(*)::int as c
      FROM sunbiz_entities GROUP BY COALESCE(vertical, 'Unclassified') ORDER BY c DESC
    `);
    const breakdown: Record<string, number> = {};
    for (const row of (result as any).rows || []) {
      breakdown[row.v] = Number(row.c);
    }
    return breakdown;
  }

  async getContactAggregateStats(): Promise<{ total: number; fromSunbiz: number; newLeads: number; syncedToGhl: number }> {
    const result = await db.execute(sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE referral_source = 'sunbiz_enrichment' OR 'sunbiz' = ANY(tags))::int as from_sunbiz,
        COUNT(*) FILTER (WHERE status = 'New')::int as new_leads,
        COUNT(*) FILTER (WHERE ghl_contact_id IS NOT NULL)::int as synced_to_ghl
      FROM contacts WHERE archived_at IS NULL
    `);
    const row = ((result as any).rows || [])[0] || {};
    return { total: Number(row.total) || 0, fromSunbiz: Number(row.from_sunbiz) || 0, newLeads: Number(row.new_leads) || 0, syncedToGhl: Number(row.synced_to_ghl) || 0 };
  }

  async getDealAggregateStats(): Promise<{ total: number; fromSunbiz: number; newLead: number; contacted: number; qualified: number; won: number }> {
    const result = await db.execute(sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE lead_source = 'sunbiz_enrichment' OR notes LIKE '%Sunbiz%')::int as from_sunbiz,
        COUNT(*) FILTER (WHERE stage = 'New Lead')::int as new_lead,
        COUNT(*) FILTER (WHERE stage = 'Contacted')::int as contacted,
        COUNT(*) FILTER (WHERE stage = 'Qualified')::int as qualified,
        COUNT(*) FILTER (WHERE stage = 'Won' OR stage = 'Closed Won')::int as won
      FROM deals WHERE archived_at IS NULL
    `);
    const row = ((result as any).rows || [])[0] || {};
    return { total: Number(row.total) || 0, fromSunbiz: Number(row.from_sunbiz) || 0, newLead: Number(row.new_lead) || 0, contacted: Number(row.contacted) || 0, qualified: Number(row.qualified) || 0, won: Number(row.won) || 0 };
  }

  async getProspectAggregateStats(): Promise<{ total: number; withEmail: number; converted: number; qualified: number }> {
    const result = await db.execute(sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE email IS NOT NULL)::int as with_email,
        COUNT(*) FILTER (WHERE status = 'converted')::int as converted,
        COUNT(*) FILTER (WHERE qualification_score IN ('A', 'B'))::int as qualified
      FROM prospects
    `);
    const row = ((result as any).rows || [])[0] || {};
    return { total: Number(row.total) || 0, withEmail: Number(row.with_email) || 0, converted: Number(row.converted) || 0, qualified: Number(row.qualified) || 0 };
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
  async getMerchantApplications() {
    return await db.select().from(merchantApplications).orderBy(desc(merchantApplications.createdAt));
  }

  async getMerchantApplication(id: number) {
    const [app] = await db.select().from(merchantApplications).where(eq(merchantApplications.id, id));
    return app;
  }

  async getMerchantApplicationByUser(userId: string) {
    const [app] = await db.select().from(merchantApplications).where(eq(merchantApplications.userId, userId));
    return app;
  }

  async createMerchantApplication(app: InsertMerchantApplication) {
    const [created] = await db.insert(merchantApplications).values(app).returning();
    return created;
  }

  async updateMerchantApplication(id: number, updates: Partial<InsertMerchantApplication>) {
    const [updated] = await db.update(merchantApplications).set({ ...updates, updatedAt: new Date() }).where(eq(merchantApplications.id, id)).returning();
    return updated;
  }

  async getMerchantProfiles() {
    return await db.select().from(merchantProfiles).orderBy(desc(merchantProfiles.createdAt));
  }

  async getMerchantProfile(id: number) {
    const [profile] = await db.select().from(merchantProfiles).where(eq(merchantProfiles.id, id));
    return profile;
  }

  async getMerchantProfileByUser(userId: string) {
    const [profile] = await db.select().from(merchantProfiles).where(eq(merchantProfiles.userId, userId));
    return profile;
  }

  async createMerchantProfile(profile: InsertMerchantProfile) {
    const [created] = await db.insert(merchantProfiles).values(profile).returning();
    return created;
  }

  async updateMerchantProfile(id: number, updates: Partial<InsertMerchantProfile>) {
    const [updated] = await db.update(merchantProfiles).set({ ...updates, updatedAt: new Date() }).where(eq(merchantProfiles.id, id)).returning();
    return updated;
  }

  async getEquipmentOrders(dealId?: number) {
    if (dealId) {
      return await db.select().from(equipmentOrders).where(eq(equipmentOrders.dealId, dealId)).orderBy(desc(equipmentOrders.createdAt));
    }
    return await db.select().from(equipmentOrders).orderBy(desc(equipmentOrders.createdAt));
  }

  async getEquipmentOrder(id: number) {
    const [order] = await db.select().from(equipmentOrders).where(eq(equipmentOrders.id, id));
    return order;
  }

  async getEquipmentOrdersByDeal(dealId: number) {
    return await db.select().from(equipmentOrders).where(eq(equipmentOrders.dealId, dealId)).orderBy(desc(equipmentOrders.createdAt));
  }

  async createEquipmentOrder(order: InsertEquipmentOrder) {
    const [created] = await db.insert(equipmentOrders).values(order).returning();
    return created;
  }

  async updateEquipmentOrder(id: number, updates: Partial<InsertEquipmentOrder>) {
    const [updated] = await db.update(equipmentOrders).set({ ...updates, updatedAt: new Date() }).where(eq(equipmentOrders.id, id)).returning();
    return updated;
  }

  async getAgents() {
    return await db.select().from(agents).orderBy(desc(agents.createdAt));
  }

  async getAgent(id: number) {
    const [agent] = await db.select().from(agents).where(eq(agents.id, id));
    return agent;
  }

  async createAgent(agent: InsertAgent) {
    const [created] = await db.insert(agents).values(agent).returning();
    return created;
  }

  async updateAgent(id: number, updates: Partial<InsertAgent>) {
    const [updated] = await db.update(agents).set({ ...updates, updatedAt: new Date() }).where(eq(agents.id, id)).returning();
    return updated;
  }

  async getResidualReports() {
    return await db.select().from(residualReports).orderBy(desc(residualReports.createdAt));
  }

  async getResidualReport(id: number) {
    const [report] = await db.select().from(residualReports).where(eq(residualReports.id, id));
    return report;
  }

  async getResidualReportsByMonth(month: string) {
    return await db.select().from(residualReports).where(eq(residualReports.month, month)).orderBy(desc(residualReports.createdAt));
  }

  async createResidualReport(report: InsertResidualReport) {
    const [created] = await db.insert(residualReports).values(report).returning();
    return created;
  }

  async getMerchantResiduals(reportId?: number) {
    if (reportId) {
      return await db.select().from(merchantResiduals).where(eq(merchantResiduals.reportId, reportId)).orderBy(desc(merchantResiduals.createdAt));
    }
    return await db.select().from(merchantResiduals).orderBy(desc(merchantResiduals.createdAt));
  }

  async getMerchantResidual(id: number) {
    const [residual] = await db.select().from(merchantResiduals).where(eq(merchantResiduals.id, id));
    return residual;
  }

  async getMerchantResidualsByDeal(dealId: number) {
    return await db.select().from(merchantResiduals).where(eq(merchantResiduals.dealId, dealId)).orderBy(desc(merchantResiduals.createdAt));
  }

  async getMerchantResidualsByMonth(month: string) {
    return await db.select().from(merchantResiduals).where(eq(merchantResiduals.month, month)).orderBy(desc(merchantResiduals.createdAt));
  }

  async createMerchantResidual(residual: InsertMerchantResidual) {
    const [created] = await db.insert(merchantResiduals).values(residual).returning();
    return created;
  }

  async getHealthAlerts() {
    return await db.select().from(healthAlerts).orderBy(desc(healthAlerts.createdAt));
  }

  async getHealthAlert(id: number) {
    const [alert] = await db.select().from(healthAlerts).where(eq(healthAlerts.id, id));
    return alert;
  }

  async getHealthAlertsByDeal(dealId: number) {
    return await db.select().from(healthAlerts).where(eq(healthAlerts.dealId, dealId)).orderBy(desc(healthAlerts.createdAt));
  }

  async getActiveHealthAlerts() {
    return await db.select().from(healthAlerts).where(eq(healthAlerts.status, "active")).orderBy(desc(healthAlerts.createdAt));
  }

  async createHealthAlert(alert: InsertHealthAlert) {
    const [created] = await db.insert(healthAlerts).values(alert).returning();
    return created;
  }

  async updateHealthAlert(id: number, updates: Partial<InsertHealthAlert>) {
    const [updated] = await db.update(healthAlerts).set(updates).where(eq(healthAlerts.id, id)).returning();
    return updated;
  }

  async getDealCompetitors(dealId?: number) {
    if (dealId) {
      return await db.select().from(dealCompetitors).where(eq(dealCompetitors.dealId, dealId)).orderBy(desc(dealCompetitors.createdAt));
    }
    return await db.select().from(dealCompetitors).orderBy(desc(dealCompetitors.createdAt));
  }

  async getDealCompetitor(id: number) {
    const [competitor] = await db.select().from(dealCompetitors).where(eq(dealCompetitors.id, id));
    return competitor;
  }

  async getDealCompetitorsByDeal(dealId: number) {
    return await db.select().from(dealCompetitors).where(eq(dealCompetitors.dealId, dealId)).orderBy(desc(dealCompetitors.createdAt));
  }

  async createDealCompetitor(competitor: InsertDealCompetitor) {
    const [created] = await db.insert(dealCompetitors).values(competitor).returning();
    return created;
  }

  async updateDealCompetitor(id: number, updates: Partial<InsertDealCompetitor>) {
    const [updated] = await db.update(dealCompetitors).set(updates).where(eq(dealCompetitors.id, id)).returning();
    return updated;
  }

  async getPartners() {
    return await db.select().from(partners).orderBy(desc(partners.createdAt));
  }

  async getPartner(id: number) {
    const [partner] = await db.select().from(partners).where(eq(partners.id, id));
    return partner;
  }

  async getPartnerByCode(code: string) {
    const [partner] = await db.select().from(partners).where(eq(partners.affiliateCode, code.toLowerCase()));
    return partner;
  }

  async getPartnerByEmail(email: string) {
    const [partner] = await db.select().from(partners).where(eq(partners.email, email.toLowerCase()));
    return partner;
  }

  async createPartner(partner: InsertPartner) {
    const [created] = await db.insert(partners).values(partner).returning();
    return created;
  }

  async updatePartner(id: number, updates: Partial<InsertPartner>) {
    const [updated] = await db.update(partners).set({ ...updates, updatedAt: new Date() }).where(eq(partners.id, id)).returning();
    return updated;
  }

  async getReferrals(partnerId?: number) {
    if (partnerId) {
      return await db.select().from(referrals).where(eq(referrals.partnerId, partnerId)).orderBy(desc(referrals.createdAt));
    }
    return await db.select().from(referrals).orderBy(desc(referrals.createdAt));
  }

  async getReferral(id: number) {
    const [referral] = await db.select().from(referrals).where(eq(referrals.id, id));
    return referral;
  }

  async getReferralsByPartner(partnerId: number) {
    return await db.select().from(referrals).where(eq(referrals.partnerId, partnerId)).orderBy(desc(referrals.createdAt));
  }

  async createReferral(referral: InsertReferral) {
    const [created] = await db.insert(referrals).values(referral).returning();
    return created;
  }

  async updateReferral(id: number, updates: Partial<InsertReferral>) {
    const [updated] = await db.update(referrals).set({ ...updates, updatedAt: new Date() }).where(eq(referrals.id, id)).returning();
    return updated;
  }

  async getKnowledgeBaseArticles() {
    return await db.select().from(knowledgeBase).orderBy(desc(knowledgeBase.createdAt));
  }

  async getKnowledgeBaseArticle(id: number) {
    const [article] = await db.select().from(knowledgeBase).where(eq(knowledgeBase.id, id));
    return article;
  }

  async getKnowledgeBaseByCategory(category: string) {
    return await db.select().from(knowledgeBase).where(eq(knowledgeBase.category, category)).orderBy(desc(knowledgeBase.createdAt));
  }

  async getPublishedArticles() {
    return await db.select().from(knowledgeBase).where(eq(knowledgeBase.isPublished, true)).orderBy(desc(knowledgeBase.createdAt));
  }

  async createKnowledgeBaseArticle(article: InsertKnowledgeBaseArticle) {
    const [created] = await db.insert(knowledgeBase).values(article).returning();
    return created;
  }

  async updateKnowledgeBaseArticle(id: number, updates: Partial<InsertKnowledgeBaseArticle>) {
    const [updated] = await db.update(knowledgeBase).set({ ...updates, updatedAt: new Date() }).where(eq(knowledgeBase.id, id)).returning();
    return updated;
  }

  async getReviewRequests(dealId?: number) {
    if (dealId) {
      return await db.select().from(reviewRequests).where(eq(reviewRequests.dealId, dealId)).orderBy(desc(reviewRequests.createdAt));
    }
    return await db.select().from(reviewRequests).orderBy(desc(reviewRequests.createdAt));
  }

  async getReviewRequest(id: number) {
    const [request] = await db.select().from(reviewRequests).where(eq(reviewRequests.id, id));
    return request;
  }

  async getReviewRequestsByDeal(dealId: number) {
    return await db.select().from(reviewRequests).where(eq(reviewRequests.dealId, dealId)).orderBy(desc(reviewRequests.createdAt));
  }

  async createReviewRequest(request: InsertReviewRequest) {
    const [created] = await db.insert(reviewRequests).values(request).returning();
    return created;
  }

  async updateReviewRequest(id: number, updates: Partial<InsertReviewRequest>) {
    const [updated] = await db.update(reviewRequests).set(updates).where(eq(reviewRequests.id, id)).returning();
    return updated;
  }

  async getOnboardingSteps(dealId?: number) {
    if (dealId) {
      return await db.select().from(onboardingSteps).where(eq(onboardingSteps.dealId, dealId)).orderBy(asc(onboardingSteps.stepOrder));
    }
    return await db.select().from(onboardingSteps).orderBy(desc(onboardingSteps.createdAt));
  }

  async getOnboardingStep(id: number) {
    const [step] = await db.select().from(onboardingSteps).where(eq(onboardingSteps.id, id));
    return step;
  }

  async getOnboardingStepsByDeal(dealId: number) {
    return await db.select().from(onboardingSteps).where(eq(onboardingSteps.dealId, dealId)).orderBy(asc(onboardingSteps.stepOrder));
  }

  async getOnboardingStepsByApplication(applicationId: number) {
    return await db.select().from(onboardingSteps).where(eq(onboardingSteps.applicationId, applicationId)).orderBy(asc(onboardingSteps.stepOrder));
  }

  async createOnboardingStep(step: InsertOnboardingStep) {
    const [created] = await db.insert(onboardingSteps).values(step).returning();
    return created;
  }

  async updateOnboardingStep(id: number, updates: Partial<InsertOnboardingStep>) {
    const [updated] = await db.update(onboardingSteps).set(updates).where(eq(onboardingSteps.id, id)).returning();
    return updated;
  }

  async getConsentAuditLogs(): Promise<ConsentAuditLog[]> {
    return db.select().from(consentAuditLogs).orderBy(desc(consentAuditLogs.createdAt));
  }

  async getConsentAuditLogsByContact(contactId: number): Promise<ConsentAuditLog[]> {
    return db.select().from(consentAuditLogs).where(eq(consentAuditLogs.contactId, contactId)).orderBy(desc(consentAuditLogs.createdAt));
  }

  async createConsentAuditLog(log: InsertConsentAuditLog): Promise<ConsentAuditLog> {
    const [created] = await db.insert(consentAuditLogs).values(log).returning();
    return created;
  }

  async getCalendarEvents(): Promise<CalendarEvent[]> {
    return db.select().from(calendarEvents).orderBy(desc(calendarEvents.startTime));
  }

  async getCalendarEventsByDateRange(start: Date, end: Date): Promise<CalendarEvent[]> {
    return db.select().from(calendarEvents)
      .where(and(gte(calendarEvents.startTime, start), lte(calendarEvents.startTime, end)))
      .orderBy(asc(calendarEvents.startTime));
  }

  async createCalendarEvent(event: InsertCalendarEvent): Promise<CalendarEvent> {
    const [created] = await db.insert(calendarEvents).values(event).returning();
    return created;
  }

  async updateCalendarEvent(id: number, data: Partial<InsertCalendarEvent>): Promise<CalendarEvent | undefined> {
    const [updated] = await db.update(calendarEvents).set(data).where(eq(calendarEvents.id, id)).returning();
    return updated;
  }

  async deleteCalendarEvent(id: number): Promise<void> {
    await db.delete(calendarEvents).where(eq(calendarEvents.id, id));
  }

  async getAgentQuotas(): Promise<AgentQuota[]> {
    return db.select().from(agentQuotas).orderBy(desc(agentQuotas.createdAt));
  }

  async getAgentQuotasByAgent(agentId: number): Promise<AgentQuota[]> {
    return db.select().from(agentQuotas).where(eq(agentQuotas.agentId, agentId)).orderBy(desc(agentQuotas.createdAt));
  }

  async createAgentQuota(quota: InsertAgentQuota): Promise<AgentQuota> {
    const [created] = await db.insert(agentQuotas).values(quota).returning();
    return created;
  }

  async updateAgentQuota(id: number, data: Partial<AgentQuota>): Promise<AgentQuota | undefined> {
    const [updated] = await db.update(agentQuotas).set(data).where(eq(agentQuotas.id, id)).returning();
    return updated;
  }

  async getDataDeleteRequests(): Promise<DataDeleteRequest[]> {
    return db.select().from(dataDeleteRequests).orderBy(desc(dataDeleteRequests.createdAt));
  }

  async createDataDeleteRequest(req: InsertDataDeleteRequest): Promise<DataDeleteRequest> {
    const [created] = await db.insert(dataDeleteRequests).values(req).returning();
    return created;
  }

  async updateDataDeleteRequest(id: number, data: Partial<DataDeleteRequest>): Promise<DataDeleteRequest | undefined> {
    const [updated] = await db.update(dataDeleteRequests).set(data).where(eq(dataDeleteRequests.id, id)).returning();
    return updated;
  }

  async getSystemSetting(key: string): Promise<any> {
    const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
    return row?.value || null;
  }

  async setSystemSetting(key: string, value: any): Promise<void> {
    const existing = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
    if (existing.length > 0) {
      await db.update(systemSettings).set({ value, updatedAt: new Date() }).where(eq(systemSettings.key, key));
    } else {
      await db.insert(systemSettings).values({ key, value, updatedAt: new Date() });
    }
  }

  async getComments(entityType: string, entityId: number): Promise<Comment[]> {
    return db.select().from(comments).where(and(eq(comments.entityType, entityType), eq(comments.entityId, entityId))).orderBy(asc(comments.createdAt));
  }

  async createComment(comment: InsertComment): Promise<Comment> {
    const [created] = await db.insert(comments).values(comment).returning();
    return created;
  }

  async deleteComment(id: number): Promise<void> {
    await db.delete(comments).where(eq(comments.id, id));
  }

  async updateComment(id: number, updates: Partial<InsertComment>): Promise<Comment | undefined> {
    const [updated] = await db.update(comments).set({ ...updates, updatedAt: new Date() }).where(eq(comments.id, id)).returning();
    return updated;
  }

  async getTicketComments(ticketId: number): Promise<TicketComment[]> {
    return db.select().from(ticketComments).where(eq(ticketComments.ticketId, ticketId)).orderBy(asc(ticketComments.createdAt));
  }

  async createTicketComment(comment: InsertTicketComment): Promise<TicketComment> {
    const [created] = await db.insert(ticketComments).values(comment).returning();
    return created;
  }

  async getContactCompanies(contactId: number): Promise<ContactCompany[]> {
    return db.select().from(contactCompanies).where(eq(contactCompanies.contactId, contactId)).orderBy(desc(contactCompanies.createdAt));
  }

  async addContactCompany(link: InsertContactCompany): Promise<ContactCompany> {
    const [created] = await db.insert(contactCompanies).values(link).returning();
    return created;
  }

  async removeContactCompany(id: number): Promise<void> {
    await db.delete(contactCompanies).where(eq(contactCompanies.id, id));
  }

  async getPipelineStages(pipeline?: string): Promise<PipelineStage[]> {
    if (pipeline) {
      return db.select().from(pipelineStages).where(eq(pipelineStages.pipeline, pipeline)).orderBy(asc(pipelineStages.sortOrder));
    }
    return db.select().from(pipelineStages).orderBy(asc(pipelineStages.pipeline), asc(pipelineStages.sortOrder));
  }

  async createPipelineStage(stage: InsertPipelineStage): Promise<PipelineStage> {
    const [created] = await db.insert(pipelineStages).values(stage).returning();
    return created;
  }

  async updatePipelineStage(id: number, updates: Partial<InsertPipelineStage>): Promise<PipelineStage | undefined> {
    const [updated] = await db.update(pipelineStages).set(updates).where(eq(pipelineStages.id, id)).returning();
    return updated;
  }

  async deletePipelineStage(id: number): Promise<void> {
    await db.delete(pipelineStages).where(eq(pipelineStages.id, id));
  }

  async getNotificationPreferences(userId: string): Promise<NotificationPreference[]> {
    return db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
  }

  async upsertNotificationPreference(pref: InsertNotificationPreference): Promise<NotificationPreference> {
    const existing = await db.select().from(notificationPreferences).where(and(eq(notificationPreferences.userId, pref.userId), eq(notificationPreferences.eventType, pref.eventType)));
    if (existing.length > 0) {
      const [updated] = await db.update(notificationPreferences).set({ enabled: pref.enabled }).where(eq(notificationPreferences.id, existing[0].id)).returning();
      return updated;
    }
    const [created] = await db.insert(notificationPreferences).values(pref).returning();
    return created;
  }

  async getSavedFilters(userId: string, entityType?: string): Promise<SavedFilter[]> {
    if (entityType) {
      return db.select().from(savedFilters).where(and(eq(savedFilters.userId, userId), eq(savedFilters.entityType, entityType))).orderBy(desc(savedFilters.createdAt));
    }
    return db.select().from(savedFilters).where(eq(savedFilters.userId, userId)).orderBy(desc(savedFilters.createdAt));
  }

  async createSavedFilter(filter: InsertSavedFilter): Promise<SavedFilter> {
    const [created] = await db.insert(savedFilters).values(filter).returning();
    return created;
  }

  async deleteSavedFilter(id: number): Promise<void> {
    await db.delete(savedFilters).where(eq(savedFilters.id, id));
  }

  async archiveContact(id: number) {
    const [updated] = await db.update(contacts).set({ archivedAt: new Date() }).where(eq(contacts.id, id)).returning();
    return updated;
  }

  async restoreContact(id: number) {
    const [updated] = await db.update(contacts).set({ archivedAt: null }).where(eq(contacts.id, id)).returning();
    return updated;
  }

  async archiveDeal(id: number) {
    const [updated] = await db.update(deals).set({ archivedAt: new Date() }).where(eq(deals.id, id)).returning();
    return updated;
  }

  async restoreDeal(id: number) {
    const [updated] = await db.update(deals).set({ archivedAt: null }).where(eq(deals.id, id)).returning();
    return updated;
  }

  async markAllNotificationsRead(userId?: string): Promise<void> {
    if (userId) {
      await db.update(notifications).set({ read: true }).where(and(eq(notifications.recipientId, userId), eq(notifications.read, false)));
    } else {
      await db.update(notifications).set({ read: true }).where(eq(notifications.read, false));
    }
  }

  async clearAllNotifications(userId?: string): Promise<void> {
    if (userId) {
      await db.delete(notifications).where(eq(notifications.recipientId, userId));
    } else {
      await db.delete(notifications);
    }
  }

  async bulkUpdateDealStage(dealIds: number[], stage: string): Promise<void> {
    await db.update(deals).set({ stage, updatedAt: new Date() }).where(inArray(deals.id, dealIds));
  }

  async bulkAssignTasks(taskIds: number[], assignedTo: string): Promise<void> {
    await db.update(tasks).set({ assignedTo }).where(inArray(tasks.id, taskIds));
  }

  async deleteTask(id: number): Promise<void> {
    await db.delete(tasks).where(eq(tasks.id, id));
  }

  async findDuplicateContacts() {
    const allContacts = await db.select().from(contacts).where(isNull(contacts.archivedAt)).orderBy(desc(contacts.createdAt));
    const emailMap = new Map<string, typeof allContacts>();
    const phoneMap = new Map<string, typeof allContacts>();
    for (const c of allContacts) {
      const email = c.email?.toLowerCase().trim();
      if (email) {
        if (!emailMap.has(email)) emailMap.set(email, []);
        emailMap.get(email)!.push(c);
      }
      const phone = c.phone?.replace(/\D/g, '');
      if (phone && phone.length >= 10) {
        if (!phoneMap.has(phone)) phoneMap.set(phone, []);
        phoneMap.get(phone)!.push(c);
      }
    }
    const duplicates: { email: string; phone: string; contacts: typeof allContacts }[] = [];
    const seen = new Set<number>();
    for (const [email, group] of emailMap) {
      if (group.length > 1) {
        const ids = group.map(c => c.id);
        if (ids.some(id => seen.has(id))) continue;
        ids.forEach(id => seen.add(id));
        duplicates.push({ email, phone: '', contacts: group });
      }
    }
    for (const [phone, group] of phoneMap) {
      if (group.length > 1) {
        const ids = group.map(c => c.id);
        if (ids.some(id => seen.has(id))) continue;
        ids.forEach(id => seen.add(id));
        duplicates.push({ email: '', phone, contacts: group });
      }
    }
    return duplicates;
  }

  async mergeContacts(primaryId: number, duplicateId: number) {
    const primary = await this.getContact(primaryId);
    const duplicate = await this.getContact(duplicateId);
    if (!primary || !duplicate) return undefined;
    await db.update(deals).set({ contactId: primaryId }).where(eq(deals.contactId, duplicateId));
    await db.update(tickets).set({ contactId: primaryId }).where(eq(tickets.contactId, duplicateId));
    await db.update(tasks).set({ contactId: primaryId }).where(eq(tasks.contactId, duplicateId));
    await db.update(documents).set({ contactId: primaryId }).where(eq(documents.contactId, duplicateId));
    await db.update(contacts).set({ archivedAt: new Date(), notes: `[Merged into Contact #${primaryId}] ${duplicate.notes || ''}` }).where(eq(contacts.id, duplicateId));
    return primary;
  }
}

export const storage = new DatabaseStorage();
