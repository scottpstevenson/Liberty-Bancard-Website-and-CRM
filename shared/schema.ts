import { pgTable, text, serial, integer, boolean, timestamp, jsonb, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";
export * from "./models/chat";

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  companyName: text("company_name"),
  vertical: text("vertical"),
  monthlyVolume: text("monthly_volume"),
  primaryOfferPath: text("primary_offer_path"),
  interestedIn0Percent: boolean("interested_in_0_percent").default(false),
  needTerminal: boolean("need_terminal").default(false),
  currentProvider: text("current_provider"),
  preferredChannel: text("preferred_channel"),
  consentSms: boolean("consent_sms").default(false),
  consentEmail: boolean("consent_email").default(false),
  doNotContact: boolean("do_not_contact").default(false),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),
  utmTerm: text("utm_term"),
  landingPage: text("landing_page"),
  tags: text("tags").array(),
  notes: text("notes"),
  status: text("status").default("New"),
  ghlContactId: text("ghl_contact_id"),
  leadScore: integer("lead_score").default(0),
  revPotentialScore: integer("rev_potential_score").default(0),
  switchabilityScore: integer("switchability_score").default(0),
  uwConfidenceScore: integer("uw_confidence_score").default(0),
  engagementScore: integer("engagement_score").default(0),
  scoreBreakdown: jsonb("score_breakdown"),
  lastScoredAt: timestamp("last_scored_at"),
  painPoints: text("pain_points").array(),
  contractStatus: text("contract_status"),
  lookingReason: text("looking_reason"),
  referralSource: text("referral_source"),
  avgTicket: text("avg_ticket"),
  locationCount: integer("location_count").default(1),
  businessAge: text("business_age"),
  smsOptInAt: timestamp("sms_opt_in_at"),
  emailOptInAt: timestamp("email_opt_in_at"),
  dncReason: text("dnc_reason"),
  contactAttempts: integer("contact_attempts").default(0),
  lastContactedAt: timestamp("last_contacted_at"),
  lastContactChannel: text("last_contact_channel"),
  coolingUntil: timestamp("cooling_until"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  legalName: text("legal_name").notNull(),
  dba: text("dba"),
  vertical: text("vertical"),
  address: text("address"),
  website: text("website"),
  volumeRange: text("volume_range"),
  currentProvider: text("current_provider"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
});

export const deals = pgTable("deals", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id),
  companyId: integer("company_id").references(() => companies.id),
  pipeline: text("pipeline").notNull().default("sales"),
  stage: text("stage").notNull().default("New Lead"),
  owner: text("owner"),
  priorityScore: integer("priority_score").default(0),
  offerPath: text("offer_path"),
  nextFollowUp: timestamp("next_follow_up"),
  effectiveRate: text("effective_rate"),
  totalVolume: text("total_volume"),
  totalFees: text("total_fees"),
  avgTicket: text("avg_ticket"),
  highestTicket: text("highest_ticket"),
  estimatedGrossProfitBps: integer("estimated_gross_profit_bps"),
  estimatedGrossProfitMonthly: text("estimated_gross_profit_monthly"),
  estimatedNetProfitMonthly: text("estimated_net_profit_monthly"),
  merchantTier: text("merchant_tier"),
  riskTier: text("risk_tier"),
  healthScore: text("health_score"),
  churnRiskFlag: text("churn_risk_flag"),
  topCostDrivers: text("top_cost_drivers").array(),
  recommendedPath: text("recommended_path"),
  terminalRecommendation: text("terminal_recommendation"),
  terminalStatus: text("terminal_status"),
  fundingNotes: text("funding_notes"),
  expectedGoLiveDate: timestamp("expected_go_live_date"),
  goLiveDate: timestamp("go_live_date"),
  lastStatementReviewDate: timestamp("last_statement_review_date"),
  nextStatementReviewDate: timestamp("next_statement_review_date"),
  onboardingStatusNotes: text("onboarding_status_notes"),
  leadSource: text("lead_source"),
  referredBy: text("referred_by"),
  partnerType: text("partner_type"),
  campaignName: text("campaign_name"),
  notes: text("notes"),
  dealBlueprint: jsonb("deal_blueprint"),
  recommendedProgram: text("recommended_program"),
  hardwarePackage: text("hardware_package"),
  estMonthlyRevenue: text("est_monthly_revenue"),
  underwritingPath: text("underwriting_path"),
  competitivePositioning: text("competitive_positioning"),
  repBriefing: text("rep_briefing"),
  repOpener: text("rep_opener"),
  likelyObjections: text("likely_objections").array(),
  statementReceived: boolean("statement_received").default(false),
  voidedCheckReceived: boolean("voided_check_received").default(false),
  idReceived: boolean("id_received").default(false),
  appCompleted: boolean("app_completed").default(false),
  docReadinessScore: integer("doc_readiness_score").default(0),
  lastNudgeAt: timestamp("last_nudge_at"),
  nextNudgeAt: timestamp("next_nudge_at"),
  blueprintGeneratedAt: timestamp("blueprint_generated_at"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDealSchema = createInsertSchema(deals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const tickets = pgTable("tickets", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  status: text("status").default("New Ticket"),
  priority: text("priority").default("Normal"),
  category: text("category").default("Other"),
  assignedTo: text("assigned_to"),
  slaDeadline: timestamp("sla_deadline"),
  firstResponseAt: timestamp("first_response_at"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTicketSchema = createInsertSchema(tickets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id),
  dealId: integer("deal_id").references(() => deals.id),
  type: text("type").notNull(),
  fileName: text("file_name").notNull(),
  storageKey: text("storage_key"),
  accessScope: text("access_scope").default("internal"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  createdAt: true,
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").references(() => deals.id),
  contactId: integer("contact_id").references(() => contacts.id),
  ticketId: integer("ticket_id").references(() => tickets.id),
  title: text("title").notNull(),
  description: text("description"),
  assignedTo: text("assigned_to"),
  dueDate: timestamp("due_date"),
  status: text("status").default("pending"),
  priority: text("priority").default("normal"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});

export const workflows = pgTable("workflows", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  triggerType: text("trigger_type").notNull(),
  triggerConfig: jsonb("trigger_config"),
  actions: jsonb("actions"),
  enabled: boolean("enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const workflowRuns = pgTable("workflow_runs", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").references(() => workflows.id),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  status: text("status").default("running"),
  currentStep: integer("current_step").default(0),
  nextRunAt: timestamp("next_run_at"),
  completedAt: timestamp("completed_at"),
  log: jsonb("log"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull(),
  recipientId: text("recipient_id"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").default("info"),
  read: boolean("read").default(false),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
});

export type Contact = typeof contacts.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;
export type CreateContactRequest = InsertContact;
export type UpdateContactRequest = Partial<InsertContact>;

export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;

export type Deal = typeof deals.$inferSelect;
export type InsertDeal = z.infer<typeof insertDealSchema>;
export type UpdateDealRequest = Partial<InsertDeal>;

export type Ticket = typeof tickets.$inferSelect;
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type CreateTicketRequest = InsertTicket;
export type UpdateTicketRequest = Partial<InsertTicket>;

export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;

export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type UpdateTaskRequest = Partial<InsertTask>;

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

export const rfis = pgTable("rfis", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id),
  dealId: integer("deal_id").references(() => deals.id),
  subject: text("subject").notNull(),
  description: text("description"),
  category: text("category").default("General"),
  priority: text("priority").default("Normal"),
  status: text("status").default("Open"),
  assignedTo: text("assigned_to"),
  requestedBy: text("requested_by"),
  dueDate: timestamp("due_date"),
  response: text("response"),
  respondedAt: timestamp("responded_at"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertRfiSchema = createInsertSchema(rfis).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Rfi = typeof rfis.$inferSelect;
export type InsertRfi = z.infer<typeof insertRfiSchema>;
export type UpdateRfiRequest = Partial<InsertRfi>;

export const RFI_CATEGORIES = [
  "General",
  "Pricing",
  "Compliance",
  "Technical",
  "Onboarding",
  "Underwriting",
  "Equipment",
] as const;

export const RFI_STATUSES = [
  "Open",
  "In Progress",
  "Waiting on Merchant",
  "Responded",
  "Closed",
] as const;

export const insertWorkflowSchema = createInsertSchema(workflows).omit({
  id: true,
  createdAt: true,
});

export const insertWorkflowRunSchema = createInsertSchema(workflowRuns).omit({
  id: true,
  createdAt: true,
});

export type Workflow = typeof workflows.$inferSelect;
export type InsertWorkflow = z.infer<typeof insertWorkflowSchema>;
export type UpdateWorkflowRequest = Partial<InsertWorkflow>;

export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type InsertWorkflowRun = z.infer<typeof insertWorkflowRunSchema>;

export const WORKFLOW_TRIGGERS = [
  "deal_stage_changed",
  "ticket_created",
  "contact_created",
  "deal_created",
  "ticket_sla_breach",
  "deal_sla_breach",
  "form_submitted",
  "go_live_milestone",
  "scheduled",
  "manual",
] as const;

export const WORKFLOW_ACTIONS = [
  "create_task",
  "send_notification",
  "update_deal",
  "update_contact_tags",
  "create_audit_log",
  "send_ghl_email",
  "send_ghl_sms",
  "send_packet",
  "generate_proposal",
  "request_review",
  "wait",
] as const;

export const SALES_STAGES = [
  "New Lead",
  "Statement Received",
  "Review In Progress",
  "Call Booked",
  "Proposal Sent",
  "Negotiation / Follow-Up",
  "Nurture / Not Now",
  "Closed Won",
  "Closed Lost",
] as const;

export const ONBOARDING_STAGES = [
  "Contract Sent",
  "Application Started",
  "Underwriting Submitted",
  "Approved",
  "Terminal Ordered",
  "Go-Live Scheduled",
  "Live (First Batch)",
  "Active (7 Days)",
  "Active (30 Days)",
] as const;

export const SUPPORT_STAGES = [
  "New Ticket",
  "In Progress",
  "Waiting on Merchant",
  "Resolved",
  "Closed",
] as const;

export const VERTICALS = [
  "Medical/Dental/Medspa",
  "Automotive",
  "Restaurant",
  "Home Services",
  "Retail",
  "Other",
] as const;

export const OFFER_PATHS = [
  "Wholesale",
  "0% Program",
  "Terminal Needed",
  "Compare vs Square/Stripe",
  "Not Sure",
] as const;

export const TICKET_CATEGORIES = [
  "Funding/Deposits",
  "Terminal",
  "Chargeback/Dispute",
  "PCI",
  "Other",
] as const;

export const messageTemplates = pgTable("message_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  channel: text("channel").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  mergeFields: text("merge_fields").array(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertMessageTemplateSchema = createInsertSchema(messageTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type InsertMessageTemplate = z.infer<typeof insertMessageTemplateSchema>;

export const collateralPackets = pgTable("collateral_packets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  offerPath: text("offer_path"),
  vertical: text("vertical"),
  tags: text("tags").array(),
  pages: text("pages").array(),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCollateralPacketSchema = createInsertSchema(collateralPackets).omit({
  id: true,
  createdAt: true,
});

export type CollateralPacket = typeof collateralPackets.$inferSelect;
export type InsertCollateralPacket = z.infer<typeof insertCollateralPacketSchema>;

export const ghlActivityLog = pgTable("ghl_activity_log", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id),
  dealId: integer("deal_id").references(() => deals.id),
  direction: text("direction").notNull(),
  channel: text("channel").notNull(),
  templateId: integer("template_id"),
  subject: text("subject"),
  body: text("body"),
  status: text("status").default("sent"),
  ghlMessageId: text("ghl_message_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertGhlActivityLogSchema = createInsertSchema(ghlActivityLog).omit({
  id: true,
  createdAt: true,
});

export type GhlActivityLog = typeof ghlActivityLog.$inferSelect;
export type InsertGhlActivityLog = z.infer<typeof insertGhlActivityLogSchema>;

export const slaConfigs = pgTable("sla_configs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  entityType: text("entity_type").notNull(),
  stage: text("stage"),
  maxDurationMinutes: integer("max_duration_minutes").notNull(),
  escalationAction: text("escalation_action").notNull(),
  escalationConfig: jsonb("escalation_config"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSlaConfigSchema = createInsertSchema(slaConfigs).omit({
  id: true,
  createdAt: true,
});

export type SlaConfig = typeof slaConfigs.$inferSelect;
export type InsertSlaConfig = z.infer<typeof insertSlaConfigSchema>;

export const MERCHANT_TIERS = [
  "Starter",
  "Growth",
  "Enterprise",
  "Strategic",
] as const;

export const RISK_TIERS = [
  "Low",
  "Medium",
  "High",
  "Review Required",
] as const;

export const TEMPLATE_CATEGORIES = [
  "proposal",
  "follow_up",
  "onboarding",
  "lifecycle",
  "nurture",
  "reactivation",
  "review_request",
  "support",
  "case_study",
] as const;

export const GHL_CHANNELS = [
  "email",
  "sms",
] as const;

export const prospectLists = pgTable("prospect_lists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  fileName: text("file_name"),
  totalRecords: integer("total_records").default(0),
  enrichedRecords: integer("enriched_records").default(0),
  qualifiedRecords: integer("qualified_records").default(0),
  status: text("status").default("processing"),
  uploadedBy: text("uploaded_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertProspectListSchema = createInsertSchema(prospectLists).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ProspectList = typeof prospectLists.$inferSelect;
export type InsertProspectList = z.infer<typeof insertProspectListSchema>;

export const PROSPECT_STATUSES = [
  "raw",
  "enriching",
  "enriched",
  "qualified",
  "disqualified",
  "in_campaign",
  "converted",
  "do_not_contact",
] as const;

export const QUALIFICATION_SCORES = [
  "A",
  "B",
  "C",
  "D",
  "F",
] as const;

export const prospects = pgTable("prospects", {
  id: serial("id").primaryKey(),
  listId: integer("list_id").references(() => prospectLists.id),
  contactId: integer("contact_id").references(() => contacts.id),
  companyName: text("company_name"),
  dba: text("dba"),
  website: text("website"),
  phone: text("phone"),
  email: text("email"),
  ownerFirstName: text("owner_first_name"),
  ownerLastName: text("owner_last_name"),
  ownerEmail: text("owner_email"),
  ownerPhone: text("owner_phone"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  vertical: text("vertical"),
  estimatedVolume: text("estimated_volume"),
  estimatedProcessor: text("estimated_processor"),
  employeeCount: text("employee_count"),
  yearEstablished: text("year_established"),
  googleRating: text("google_rating"),
  googleReviews: text("google_reviews"),
  estimatedRevenue: text("estimated_revenue"),
  score: text("score").default("cold"),
  qualificationScore: text("qualification_score").default("C"),
  qualificationReason: text("qualification_reason"),
  status: text("status").default("raw"),
  enrichmentData: jsonb("enrichment_data"),
  enrichedAt: timestamp("enriched_at"),
  aiSummary: text("ai_summary"),
  aiPitchAngle: text("ai_pitch_angle"),
  notes: text("notes"),
  tags: text("tags").array(),
  doNotContact: boolean("do_not_contact").default(false),
  lastContactedAt: timestamp("last_contacted_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertProspectSchema = createInsertSchema(prospects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Prospect = typeof prospects.$inferSelect;
export type InsertProspect = z.infer<typeof insertProspectSchema>;
export type UpdateProspectRequest = Partial<InsertProspect>;

export const enrichmentJobs = pgTable("enrichment_jobs", {
  id: serial("id").primaryKey(),
  listId: integer("list_id").references(() => prospectLists.id),
  prospectId: integer("prospect_id").references(() => prospects.id),
  jobType: text("job_type").notNull(),
  status: text("status").default("pending"),
  totalCount: integer("total_count").default(0),
  processedCount: integer("processed_count").default(0),
  result: jsonb("result"),
  error: text("error"),
  errorLog: text("error_log"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertEnrichmentJobSchema = createInsertSchema(enrichmentJobs).omit({
  id: true,
  createdAt: true,
});

export type EnrichmentJob = typeof enrichmentJobs.$inferSelect;
export type InsertEnrichmentJob = z.infer<typeof insertEnrichmentJobSchema>;

export const CAMPAIGN_STATUSES = [
  "draft",
  "active",
  "paused",
  "completed",
  "archived",
] as const;

export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  targetListId: integer("target_list_id").references(() => prospectLists.id),
  targetVerticals: text("target_verticals").array(),
  targetScores: text("target_scores").array(),
  filterCriteria: jsonb("filter_criteria"),
  aiPersonalization: boolean("ai_personalization").default(true),
  totalSteps: integer("total_steps").default(3),
  status: text("status").default("draft"),
  dailySendLimit: integer("daily_send_limit").default(200),
  totalSent: integer("total_sent").default(0),
  totalOpened: integer("total_opened").default(0),
  totalReplied: integer("total_replied").default(0),
  totalBounced: integer("total_bounced").default(0),
  totalUnsubscribed: integer("total_unsubscribed").default(0),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCampaignSchema = createInsertSchema(campaigns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type UpdateCampaignRequest = Partial<InsertCampaign>;

export const campaignSteps = pgTable("campaign_steps", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => campaigns.id),
  stepOrder: integer("step_order").notNull(),
  stepType: text("step_type").notNull(),
  delayDays: integer("delay_days").default(0),
  subject: text("subject"),
  bodyTemplate: text("body_template"),
  aiPrompt: text("ai_prompt"),
  useAiPersonalization: boolean("use_ai_personalization").default(true),
  channel: text("channel").default("email"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCampaignStepSchema = createInsertSchema(campaignSteps).omit({
  id: true,
  createdAt: true,
});

export type CampaignStep = typeof campaignSteps.$inferSelect;
export type InsertCampaignStep = z.infer<typeof insertCampaignStepSchema>;

export const OUTBOUND_STATUSES = [
  "queued",
  "sending",
  "sent",
  "delivered",
  "opened",
  "replied",
  "bounced",
  "failed",
  "skipped",
  "unsubscribed",
] as const;

export const outboundMessages = pgTable("outbound_messages", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => campaigns.id),
  stepId: integer("step_id").references(() => campaignSteps.id),
  prospectId: integer("prospect_id").references(() => prospects.id),
  contactId: integer("contact_id").references(() => contacts.id),
  channel: text("channel").default("email"),
  toEmail: text("to_email"),
  toPhone: text("to_phone"),
  subject: text("subject"),
  body: text("body"),
  personalizedSubject: text("personalized_subject"),
  personalizedBody: text("personalized_body"),
  status: text("status").default("queued"),
  scheduledFor: timestamp("scheduled_for"),
  sentAt: timestamp("sent_at"),
  openedAt: timestamp("opened_at"),
  repliedAt: timestamp("replied_at"),
  bouncedAt: timestamp("bounced_at"),
  ghlMessageId: text("ghl_message_id"),
  error: text("error"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertOutboundMessageSchema = createInsertSchema(outboundMessages).omit({
  id: true,
  createdAt: true,
});

export type OutboundMessage = typeof outboundMessages.$inferSelect;
export type InsertOutboundMessage = z.infer<typeof insertOutboundMessageSchema>;
export type UpdateOutboundMessageRequest = Partial<InsertOutboundMessage>;

export const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  content: text("content").notNull(),
  authorId: text("author_id"),
  authorName: text("author_name"),
  pinned: boolean("pinned").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertNoteSchema = createInsertSchema(notes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Note = typeof notes.$inferSelect;
export type InsertNote = z.infer<typeof insertNoteSchema>;

export const ENRICHMENT_JOB_TYPES = [
  "website_scrape",
  "ai_classify",
  "owner_lookup",
  "full_enrich",
] as const;

export const CAMPAIGN_STEP_TYPES = [
  "email",
  "sms",
  "wait",
  "ai_qualify",
] as const;

export const emailLogs = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id),
  dealId: integer("deal_id").references(() => deals.id),
  direction: text("direction").notNull().default("outbound"),
  from: text("from_address"),
  to: text("to_address"),
  subject: text("subject"),
  body: text("body"),
  snippet: text("snippet"),
  templateId: integer("template_id"),
  status: text("status").default("sent"),
  openedAt: timestamp("opened_at"),
  repliedAt: timestamp("replied_at"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertEmailLogSchema = createInsertSchema(emailLogs).omit({
  id: true,
  createdAt: true,
});

export type EmailLog = typeof emailLogs.$inferSelect;
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;

export const callLogs = pgTable("call_logs", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id),
  dealId: integer("deal_id").references(() => deals.id),
  direction: text("direction").notNull().default("outbound"),
  duration: integer("duration"),
  outcome: text("outcome"),
  summary: text("summary"),
  aiSummary: text("ai_summary"),
  recordingUrl: text("recording_url"),
  callerName: text("caller_name"),
  nextSteps: text("next_steps"),
  sentiment: text("sentiment"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCallLogSchema = createInsertSchema(callLogs).omit({
  id: true,
  createdAt: true,
});

export type CallLog = typeof callLogs.$inferSelect;
export type InsertCallLog = z.infer<typeof insertCallLogSchema>;

export const stageAutomationRules = pgTable("stage_automation_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  pipeline: text("pipeline").notNull().default("sales"),
  fromStage: text("from_stage"),
  toStage: text("to_stage").notNull(),
  actions: jsonb("actions").notNull(),
  enabled: boolean("enabled").default(true),
  priority: integer("priority").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertStageAutomationRuleSchema = createInsertSchema(stageAutomationRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type StageAutomationRule = typeof stageAutomationRules.$inferSelect;
export type InsertStageAutomationRule = z.infer<typeof insertStageAutomationRuleSchema>;

export const STAGE_AUTOMATION_ACTIONS = [
  "create_task",
  "send_email",
  "send_sms",
  "send_notification",
  "update_contact_tags",
  "create_follow_up",
  "assign_owner",
  "send_packet",
  "update_deal_fields",
  "enroll_sequence",
  "log_activity",
] as const;

export const followUpSequences = pgTable("follow_up_sequences", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  triggerType: text("trigger_type").notNull().default("manual"),
  triggerConfig: jsonb("trigger_config"),
  totalSteps: integer("total_steps").default(0),
  status: text("status").default("active"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertFollowUpSequenceSchema = createInsertSchema(followUpSequences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type FollowUpSequence = typeof followUpSequences.$inferSelect;
export type InsertFollowUpSequence = z.infer<typeof insertFollowUpSequenceSchema>;

export const sequenceSteps = pgTable("sequence_steps", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").references(() => followUpSequences.id),
  stepOrder: integer("step_order").notNull(),
  actionType: text("action_type").notNull(),
  delayDays: integer("delay_days").default(0),
  delayHours: integer("delay_hours").default(0),
  subject: text("subject"),
  body: text("body"),
  templateId: integer("template_id"),
  config: jsonb("config"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSequenceStepSchema = createInsertSchema(sequenceSteps).omit({
  id: true,
  createdAt: true,
});

export type SequenceStep = typeof sequenceSteps.$inferSelect;
export type InsertSequenceStep = z.infer<typeof insertSequenceStepSchema>;

export const sequenceEnrollments = pgTable("sequence_enrollments", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").references(() => followUpSequences.id),
  contactId: integer("contact_id").references(() => contacts.id),
  dealId: integer("deal_id").references(() => deals.id),
  currentStep: integer("current_step").default(0),
  status: text("status").default("active"),
  nextActionAt: timestamp("next_action_at"),
  completedAt: timestamp("completed_at"),
  pausedAt: timestamp("paused_at"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSequenceEnrollmentSchema = createInsertSchema(sequenceEnrollments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SequenceEnrollment = typeof sequenceEnrollments.$inferSelect;
export type InsertSequenceEnrollment = z.infer<typeof insertSequenceEnrollmentSchema>;

export const SEQUENCE_STATUSES = [
  "active",
  "paused",
  "completed",
  "cancelled",
  "bounced",
] as const;

export const SEQUENCE_STEP_TYPES = [
  "email",
  "sms",
  "call_reminder",
  "task",
  "wait",
  "condition",
] as const;

export const CALL_OUTCOMES = [
  "Connected",
  "Voicemail",
  "No Answer",
  "Busy",
  "Wrong Number",
  "Callback Scheduled",
  "Not Interested",
  "Interested",
  "Appointment Set",
] as const;

export const CALL_SENTIMENTS = [
  "Positive",
  "Neutral",
  "Negative",
  "Mixed",
] as const;

export const EMAIL_DIRECTIONS = [
  "inbound",
  "outbound",
] as const;

export const CONTACT_SCORE_FACTORS = {
  emailOpened: 5,
  emailReplied: 15,
  callConnected: 20,
  formSubmitted: 25,
  meetingBooked: 30,
  proposalViewed: 10,
  websiteVisit: 3,
  daysSinceLastActivity: -1,
} as const;

export const sunbizEntities = pgTable("sunbiz_entities", {
  id: serial("id").primaryKey(),
  filingNumber: text("filing_number"),
  feiEinNumber: text("fei_ein_number"),
  entityName: text("entity_name").notNull(),
  dba: text("dba"),
  entityType: text("entity_type"),
  filingDate: text("filing_date"),
  entityStatus: text("entity_status"),
  lastEvent: text("last_event"),
  lastEventDate: text("last_event_date"),
  principalAddress: text("principal_address"),
  principalCity: text("principal_city"),
  principalState: text("principal_state"),
  principalZip: text("principal_zip"),
  mailingAddress: text("mailing_address"),
  registeredAgentName: text("registered_agent_name"),
  registeredAgentAddress: text("registered_agent_address"),
  officers: jsonb("officers"),
  website: text("website"),
  email: text("email"),
  phone: text("phone"),
  ownerName: text("owner_name"),
  ownerEmail: text("owner_email"),
  ownerPhone: text("owner_phone"),
  vertical: text("vertical"),
  score: text("score").default("raw"),
  enrichmentStatus: text("enrichment_status").default("pending"),
  enrichmentData: jsonb("enrichment_data"),
  enrichedAt: timestamp("enriched_at"),
  aiSummary: text("ai_summary"),
  listId: integer("list_id").references(() => prospectLists.id),
  prospectId: integer("prospect_id").references(() => prospects.id),
  notes: text("notes"),
  tags: text("tags").array(),
  source: text("source").default("sunbiz"),
  searchQuery: text("search_query"),
  detailUrl: text("detail_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSunbizEntitySchema = createInsertSchema(sunbizEntities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SunbizEntity = typeof sunbizEntities.$inferSelect;
export type InsertSunbizEntity = z.infer<typeof insertSunbizEntitySchema>;
export type UpdateSunbizEntityRequest = Partial<InsertSunbizEntity>;
