import { pgTable, text, serial, integer, boolean, timestamp, jsonb, varchar, real, index, uniqueIndex, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./models/auth";

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
  estimatedProcessingVolume: text("estimated_processing_volume"),
  estimatedResidual: text("estimated_residual"),
  volumeConfidence: text("volume_confidence"),
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
  promoCode: text("promo_code"),
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
  title: text("title"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  website: text("website"),
  linkedinUrl: text("linkedin_url"),
  facebookUrl: text("facebook_url"),
  industry: text("industry"),
  leadSource: text("lead_source"),
  employeeCount: integer("employee_count"),
  annualRevenue: text("annual_revenue"),
  businessId: integer("business_id").references(() => businesses.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  archivedAt: timestamp("archived_at"),
}, (table) => [
  index("contacts_email_idx").on(table.email),
  index("contacts_phone_idx").on(table.phone),
  index("contacts_ghl_contact_id_idx").on(table.ghlContactId),
  index("contacts_created_at_idx").on(table.createdAt),
]);

export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
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
  promoCode: text("promo_code"),
  referredBy: text("referred_by"),
  partnerType: text("partner_type"),
  campaignName: text("campaign_name"),
  notes: text("notes"),
  dealBlueprint: jsonb("deal_blueprint"),
  savingsProposal: jsonb("savings_proposal"),
  proposalGeneratedAt: timestamp("proposal_generated_at"),
  recommendedProgram: text("recommended_program"),
  hardwarePackage: text("hardware_package"),
  estMonthlyRevenue: text("est_monthly_revenue"),
  underwritingPath: text("underwriting_path"),
  competitivePositioning: text("competitive_positioning"),
  repBriefing: text("rep_briefing"),
  repOpener: text("rep_opener"),
  likelyObjections: text("likely_objections").array(),
  proposalToken: text("proposal_token"),
  proposalEmailSentAt: timestamp("proposal_email_sent_at"),
  proposalStatus: text("proposal_status").default("none"),
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
  archivedAt: timestamp("archived_at"),
}, (table) => [
  index("deals_contact_id_idx").on(table.contactId),
  index("deals_pipeline_idx").on(table.pipeline),
  index("deals_stage_idx").on(table.stage),
  index("deals_pipeline_stage_idx").on(table.pipeline, table.stage),
  index("deals_created_at_idx").on(table.createdAt),
]);

export const insertDealSchema = createInsertSchema(deals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
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
}, (table) => [
  index("audit_logs_created_at_idx").on(table.createdAt),
  index("audit_logs_entity_type_entity_id_idx").on(table.entityType, table.entityId),
]);

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
  "application_reminder",
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
  "create_onboarding_checklist",
  "enroll_sequence",
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
  estimatedResidual: text("estimated_residual"),
  estimatedAvgTicket: text("estimated_avg_ticket"),
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
}, (table) => [
  index("prospects_list_id_idx").on(table.listId),
  index("prospects_status_idx").on(table.status),
  index("prospects_created_at_idx").on(table.createdAt),
]);

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
}, (table) => [
  index("outbound_messages_campaign_id_idx").on(table.campaignId),
  index("outbound_messages_status_idx").on(table.status),
  index("outbound_messages_campaign_status_idx").on(table.campaignId, table.status),
  index("outbound_messages_scheduled_for_idx").on(table.scheduledFor),
]);

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
}, (table) => [
  index("email_logs_created_at_idx").on(table.createdAt),
  index("email_logs_contact_id_idx").on(table.contactId),
]);

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
}, (table) => [
  index("sequence_enrollments_contact_id_status_idx").on(table.contactId, table.status),
]);

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
  "call",
  "call_reminder",
  "voicemail_drop",
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
}, (table) => [
  index("sunbiz_entities_filing_number_idx").on(table.filingNumber),
  index("sunbiz_entities_entity_name_idx").on(table.entityName),
  index("sunbiz_entities_enrichment_status_idx").on(table.enrichmentStatus),
  index("sunbiz_entities_list_id_idx").on(table.listId),
  index("sunbiz_entities_created_at_idx").on(table.createdAt),
]);

export const insertSunbizEntitySchema = createInsertSchema(sunbizEntities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SunbizEntity = typeof sunbizEntities.$inferSelect;
export type InsertSunbizEntity = z.infer<typeof insertSunbizEntitySchema>;
export type UpdateSunbizEntityRequest = Partial<InsertSunbizEntity>;

export const systemSettings = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;

export const merchantApplications = pgTable("merchant_applications", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id),
  contactId: integer("contact_id").references(() => contacts.id),
  companyId: integer("company_id").references(() => companies.id),
  dealId: integer("deal_id").references(() => deals.id),
  status: text("status").default("draft"),
  currentStep: integer("current_step").default(1),
  totalSteps: integer("total_steps").default(6),
  legalBusinessName: text("legal_business_name"),
  dba: text("dba"),
  ein: text("ein"),
  businessType: text("business_type"),
  businessStartDate: text("business_start_date"),
  businessAddress: text("business_address"),
  businessCity: text("business_city"),
  businessState: text("business_state"),
  businessZip: text("business_zip"),
  businessPhone: text("business_phone"),
  businessEmail: text("business_email"),
  website: text("website"),
  vertical: text("vertical"),
  ownerFirstName: text("owner_first_name"),
  ownerLastName: text("owner_last_name"),
  ownerEmail: text("owner_email"),
  ownerPhone: text("owner_phone"),
  ownerDob: text("owner_dob"),
  ownerSsn: text("owner_ssn"),
  ownerAddress: text("owner_address"),
  ownerCity: text("owner_city"),
  ownerState: text("owner_state"),
  ownerZip: text("owner_zip"),
  ownershipPercent: integer("ownership_percent"),
  additionalOwners: jsonb("additional_owners"),
  bankName: text("bank_name"),
  bankRoutingNumber: text("bank_routing_number"),
  bankAccountNumber: text("bank_account_number"),
  bankAccountType: text("bank_account_type"),
  estimatedMonthlyVolume: text("estimated_monthly_volume"),
  estimatedAvgTicket: text("estimated_avg_ticket"),
  highestTicket: text("highest_ticket"),
  currentProcessor: text("current_processor"),
  currentRate: text("current_rate"),
  acceptedCardTypes: text("accepted_card_types").array(),
  terminalNeeded: boolean("terminal_needed").default(false),
  terminalType: text("terminal_type"),
  terminalQuantity: integer("terminal_quantity").default(1),
  ecommerceNeeded: boolean("ecommerce_needed").default(false),
  preferredProgram: text("preferred_program"),
  referralSource: text("referral_source"),
  referralCode: text("referral_code"),
  esignStatus: text("esign_status").default("pending"),
  esignDocumentId: text("esign_document_id"),
  esignSigningUrl: text("esign_signing_url"),
  esignedAt: timestamp("esigned_at"),
  esignIp: text("esign_ip"),
  underwritingStatus: text("underwriting_status").default("pending"),
  underwritingNotes: text("underwriting_notes"),
  approvedAt: timestamp("approved_at"),
  declinedAt: timestamp("declined_at"),
  declineReason: text("decline_reason"),
  submittedAt: timestamp("submitted_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertMerchantApplicationSchema = createInsertSchema(merchantApplications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type MerchantApplication = typeof merchantApplications.$inferSelect;
export type InsertMerchantApplication = z.infer<typeof insertMerchantApplicationSchema>;

export const APPLICATION_STATUSES = [
  "draft",
  "in_progress",
  "submitted",
  "under_review",
  "approved",
  "declined",
  "withdrawn",
] as const;

export const UNDERWRITING_STATUSES = [
  "pending",
  "documents_needed",
  "in_review",
  "approved",
  "conditionally_approved",
  "declined",
  "referred",
] as const;

export const BUSINESS_TYPES = [
  "Sole Proprietorship",
  "LLC",
  "Corporation",
  "Partnership",
  "Non-Profit",
  "Government",
] as const;

export const TERMINAL_TYPES = [
  "Clover Flex",
  "Clover Mini",
  "Clover Station",
  "Dejavoo Z11",
  "PAX A920",
  "Virtual Terminal Only",
  "Mobile Reader",
] as const;

export const merchantProfiles = pgTable("merchant_profiles", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  contactId: integer("contact_id").references(() => contacts.id),
  companyId: integer("company_id").references(() => companies.id),
  dealId: integer("deal_id").references(() => deals.id),
  applicationId: integer("application_id").references(() => merchantApplications.id),
  merchantMid: text("merchant_mid"),
  accountStatus: text("account_status").default("pending"),
  goLiveDate: timestamp("go_live_date"),
  currentMonthlyVolume: text("current_monthly_volume"),
  lastStatementDate: timestamp("last_statement_date"),
  nextStatementDate: timestamp("next_statement_date"),
  programType: text("program_type"),
  terminalInfo: jsonb("terminal_info"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertMerchantProfileSchema = createInsertSchema(merchantProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type MerchantProfile = typeof merchantProfiles.$inferSelect;
export type InsertMerchantProfile = z.infer<typeof insertMerchantProfileSchema>;

export const equipmentOrders = pgTable("equipment_orders", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").references(() => merchantApplications.id),
  dealId: integer("deal_id").references(() => deals.id),
  contactId: integer("contact_id").references(() => contacts.id),
  equipmentType: text("equipment_type").notNull(),
  quantity: integer("quantity").default(1),
  shippingAddress: text("shipping_address"),
  shippingCity: text("shipping_city"),
  shippingState: text("shipping_state"),
  shippingZip: text("shipping_zip"),
  trackingNumber: text("tracking_number"),
  status: text("status").default("pending"),
  orderedAt: timestamp("ordered_at"),
  shippedAt: timestamp("shipped_at"),
  deliveredAt: timestamp("delivered_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertEquipmentOrderSchema = createInsertSchema(equipmentOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type EquipmentOrder = typeof equipmentOrders.$inferSelect;
export type InsertEquipmentOrder = z.infer<typeof insertEquipmentOrderSchema>;

export const EQUIPMENT_STATUSES = [
  "pending",
  "ordered",
  "shipped",
  "delivered",
  "installed",
  "returned",
] as const;

export const agents = pgTable("agents", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  role: text("role").default("sales_rep"),
  managerId: integer("manager_id"),
  commissionSplitPercent: integer("commission_split_percent").default(50),
  status: text("status").default("active"),
  territory: text("territory"),
  hireDate: timestamp("hire_date"),
  vestingMonths: integer("vesting_months").default(3),
  totalDeals: integer("total_deals").default(0),
  totalRevenue: text("total_revenue").default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAgentSchema = createInsertSchema(agents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Agent = typeof agents.$inferSelect;
export type InsertAgent = z.infer<typeof insertAgentSchema>;

export const agentMerchants = pgTable("agent_merchants", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => agents.id),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  merchantName: text("merchant_name"),
  assignedAt: timestamp("assigned_at").defaultNow(),
}, (table) => [
  index("agent_merchants_agent_id_idx").on(table.agentId),
  unique("agent_merchants_deal_id_unique").on(table.dealId),
]);

export const insertAgentMerchantSchema = createInsertSchema(agentMerchants).omit({
  id: true,
  assignedAt: true,
});

export type AgentMerchant = typeof agentMerchants.$inferSelect;
export type InsertAgentMerchant = z.infer<typeof insertAgentMerchantSchema>;

export const residualReports = pgTable("residual_reports", {
  id: serial("id").primaryKey(),
  month: text("month").notNull(),
  processor: text("processor"),
  totalMerchants: integer("total_merchants").default(0),
  totalVolume: text("total_volume").default("0"),
  totalTransactions: integer("total_transactions").default(0),
  totalRevenue: text("total_revenue").default("0"),
  totalCost: text("total_cost").default("0"),
  netRevenue: text("net_revenue").default("0"),
  avgRevenuePerMerchant: text("avg_revenue_per_merchant").default("0"),
  newMerchants: integer("new_merchants").default(0),
  lostMerchants: integer("lost_merchants").default(0),
  attritionRate: text("attrition_rate"),
  importedAt: timestamp("imported_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertResidualReportSchema = createInsertSchema(residualReports).omit({
  id: true,
  createdAt: true,
});

export type ResidualReport = typeof residualReports.$inferSelect;
export type InsertResidualReport = z.infer<typeof insertResidualReportSchema>;

export const merchantResiduals = pgTable("merchant_residuals", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").references(() => residualReports.id),
  dealId: integer("deal_id").references(() => deals.id),
  contactId: integer("contact_id").references(() => contacts.id),
  merchantMid: text("merchant_mid"),
  merchantName: text("merchant_name"),
  month: text("month").notNull(),
  volume: text("volume").default("0"),
  transactions: integer("transactions").default(0),
  revenue: text("revenue").default("0"),
  cost: text("cost").default("0"),
  netRevenue: text("net_revenue").default("0"),
  agentId: integer("agent_id").references(() => agents.id),
  agentCommission: text("agent_commission").default("0"),
  volumeChange: text("volume_change"),
  revenueChange: text("revenue_change"),
  flags: text("flags").array(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertMerchantResidualSchema = createInsertSchema(merchantResiduals).omit({
  id: true,
  createdAt: true,
});

export type MerchantResidual = typeof merchantResiduals.$inferSelect;
export type InsertMerchantResidual = z.infer<typeof insertMerchantResidualSchema>;

export const healthAlerts = pgTable("health_alerts", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").references(() => deals.id),
  contactId: integer("contact_id").references(() => contacts.id),
  alertType: text("alert_type").notNull(),
  severity: text("severity").default("warning"),
  title: text("title").notNull(),
  description: text("description"),
  metric: text("metric"),
  currentValue: text("current_value"),
  previousValue: text("previous_value"),
  threshold: text("threshold"),
  status: text("status").default("active"),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedBy: text("acknowledged_by"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertHealthAlertSchema = createInsertSchema(healthAlerts).omit({
  id: true,
  createdAt: true,
});

export type HealthAlert = typeof healthAlerts.$inferSelect;
export type InsertHealthAlert = z.infer<typeof insertHealthAlertSchema>;

export const HEALTH_ALERT_TYPES = [
  "volume_decline",
  "chargeback_spike",
  "no_processing",
  "high_refund_rate",
  "compliance_issue",
  "terminal_offline",
  "funding_hold",
] as const;

export const ALERT_SEVERITIES = [
  "info",
  "warning",
  "critical",
  "urgent",
] as const;

export const dealCompetitors = pgTable("deal_competitors", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").references(() => deals.id),
  competitorName: text("competitor_name").notNull(),
  competitorRate: text("competitor_rate"),
  competitorProgram: text("competitor_program"),
  result: text("result"),
  lossReason: text("loss_reason"),
  winFactor: text("win_factor"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDealCompetitorSchema = createInsertSchema(dealCompetitors).omit({
  id: true,
  createdAt: true,
});

export type DealCompetitor = typeof dealCompetitors.$inferSelect;
export type InsertDealCompetitor = z.infer<typeof insertDealCompetitorSchema>;

export const WIN_LOSS_REASONS = [
  "Better Rate",
  "Better Service",
  "Equipment Offer",
  "Relationship",
  "Contract Terms",
  "Speed of Setup",
  "Technology/Integration",
  "Competitor Retention Offer",
  "No Decision",
  "Went with Bank",
  "Price Too High",
  "Other",
] as const;

export const partners = pgTable("partners", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  passwordHash: text("password_hash"),
  partnerType: text("partner_type").default("referral"),
  affiliateCode: text("affiliate_code").unique(),
  commissionPercent: integer("commission_percent").default(10),
  status: text("status").default("pending"),
  totalReferrals: integer("total_referrals").default(0),
  totalConversions: integer("total_conversions").default(0),
  totalPayouts: text("total_payouts").default("0"),
  totalClicks: integer("total_clicks").default(0),
  agreementDate: timestamp("agreement_date"),
  paypalEmail: text("paypal_email"),
  website: text("website"),
  howHeard: text("how_heard"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const commissionTiers = pgTable("commission_tiers", {
  id: serial("id").primaryKey(),
  minReferrals: integer("min_referrals").notNull().default(1),
  maxReferrals: integer("max_referrals"),
  commissionAmount: text("commission_amount").notNull().default("100"),
  label: text("label"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCommissionTierSchema = createInsertSchema(commissionTiers).omit({
  id: true,
  createdAt: true,
});

export type CommissionTier = typeof commissionTiers.$inferSelect;
export type InsertCommissionTier = z.infer<typeof insertCommissionTierSchema>;

export const insertPartnerSchema = createInsertSchema(partners).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Partner = typeof partners.$inferSelect;
export type InsertPartner = z.infer<typeof insertPartnerSchema>;

export const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").references(() => partners.id),
  contactId: integer("contact_id").references(() => contacts.id),
  dealId: integer("deal_id").references(() => deals.id),
  referredName: text("referred_name"),
  referredEmail: text("referred_email"),
  referredPhone: text("referred_phone"),
  referredCompany: text("referred_company"),
  status: text("status").default("pending"),
  incentiveType: text("incentive_type").default("commission"),
  incentiveAmount: text("incentive_amount"),
  commissionAmount: text("commission_amount"),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertReferralSchema = createInsertSchema(referrals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Referral = typeof referrals.$inferSelect;
export type InsertReferral = z.infer<typeof insertReferralSchema>;

export const PARTNER_TYPES = [
  "referral",
  "affiliate",
  "iso_agent",
  "bank_partner",
  "technology",
  "association",
  "strategic",
] as const;

export const REFERRAL_STATUSES = [
  "pending",
  "contacted",
  "qualified",
  "converted",
  "lost",
  "paid",
] as const;

export const knowledgeBase = pgTable("knowledge_base", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  tags: text("tags").array(),
  sortOrder: integer("sort_order").default(0),
  isPublished: boolean("is_published").default(true),
  viewCount: integer("view_count").default(0),
  helpfulCount: integer("helpful_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertKnowledgeBaseSchema = createInsertSchema(knowledgeBase).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type KnowledgeBaseArticle = typeof knowledgeBase.$inferSelect;
export type InsertKnowledgeBaseArticle = z.infer<typeof insertKnowledgeBaseSchema>;

export const KB_CATEGORIES = [
  "Getting Started",
  "Terminals & Equipment",
  "Processing & Transactions",
  "Chargebacks & Disputes",
  "Statements & Billing",
  "PCI Compliance",
  "Account Management",
  "Troubleshooting",
] as const;

export const reviewRequests = pgTable("review_requests", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").references(() => deals.id),
  contactId: integer("contact_id").references(() => contacts.id),
  channel: text("channel").default("email"),
  status: text("status").default("pending"),
  sentAt: timestamp("sent_at"),
  respondedAt: timestamp("responded_at"),
  rating: integer("rating"),
  reviewText: text("review_text"),
  platform: text("platform"),
  reviewUrl: text("review_url"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertReviewRequestSchema = createInsertSchema(reviewRequests).omit({
  id: true,
  createdAt: true,
});

export type ReviewRequest = typeof reviewRequests.$inferSelect;
export type InsertReviewRequest = z.infer<typeof insertReviewRequestSchema>;

export const REVIEW_PLATFORMS = [
  "Google",
  "Yelp",
  "BBB",
  "Trustpilot",
  "Internal",
] as const;

export const onboardingSteps = pgTable("onboarding_steps", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").references(() => deals.id),
  applicationId: integer("application_id").references(() => merchantApplications.id),
  stepName: text("step_name").notNull(),
  stepOrder: integer("step_order").notNull(),
  status: text("status").default("pending"),
  completedAt: timestamp("completed_at"),
  completedBy: text("completed_by"),
  notes: text("notes"),
  dueDate: timestamp("due_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertOnboardingStepSchema = createInsertSchema(onboardingSteps).omit({
  id: true,
  createdAt: true,
});

export type OnboardingStep = typeof onboardingSteps.$inferSelect;
export type InsertOnboardingStep = z.infer<typeof insertOnboardingStepSchema>;

export const ONBOARDING_STEP_NAMES = [
  "Application Submitted",
  "Documents Uploaded",
  "Underwriting Review",
  "Approved",
  "Agreement Signed",
  "Equipment Ordered",
  "Equipment Shipped",
  "Equipment Delivered",
  "Terminal Programmed",
  "First Batch Processed",
  "Go-Live Complete",
] as const;

export const consentAuditLogs = pgTable("consent_audit_logs", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id),
  userId: text("user_id"),
  channel: text("channel").notNull(),
  action: text("action").notNull(),
  consented: boolean("consented").notNull(),
  source: text("source"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertConsentAuditLogSchema = createInsertSchema(consentAuditLogs).omit({
  id: true,
  createdAt: true,
});

export type ConsentAuditLog = typeof consentAuditLogs.$inferSelect;
export type InsertConsentAuditLog = z.infer<typeof insertConsentAuditLogSchema>;

export const calendarEvents = pgTable("calendar_events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  allDay: boolean("all_day").default(false),
  type: text("type").default("meeting"),
  contactId: integer("contact_id").references(() => contacts.id),
  dealId: integer("deal_id").references(() => deals.id),
  ownerId: text("owner_id"),
  location: text("location"),
  ghlEventId: text("ghl_event_id"),
  status: text("status").default("scheduled"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCalendarEventSchema = createInsertSchema(calendarEvents).omit({
  id: true,
  createdAt: true,
});

export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;

export const agentQuotas = pgTable("agent_quotas", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").references(() => agents.id),
  period: text("period").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  targetDeals: integer("target_deals").default(0),
  targetRevenue: text("target_revenue").default("0"),
  targetVolume: text("target_volume").default("0"),
  actualDeals: integer("actual_deals").default(0),
  actualRevenue: text("actual_revenue").default("0"),
  actualVolume: text("actual_volume").default("0"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentQuotaSchema = createInsertSchema(agentQuotas).omit({
  id: true,
  createdAt: true,
});

export type AgentQuota = typeof agentQuotas.$inferSelect;
export type InsertAgentQuota = z.infer<typeof insertAgentQuotaSchema>;

export const dataDeleteRequests = pgTable("data_delete_requests", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  requestType: text("request_type").notNull(),
  description: text("description"),
  status: text("status").default("pending"),
  processedBy: text("processed_by"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDataDeleteRequestSchema = createInsertSchema(dataDeleteRequests).omit({
  id: true,
  createdAt: true,
});

export type DataDeleteRequest = typeof dataDeleteRequests.$inferSelect;
export type InsertDataDeleteRequest = z.infer<typeof insertDataDeleteRequestSchema>;

export const comments = pgTable("comments", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  parentId: integer("parent_id"),
  content: text("content").notNull(),
  authorId: text("author_id"),
  authorName: text("author_name"),
  mentions: jsonb("mentions"),
  pinned: boolean("pinned").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCommentSchema = createInsertSchema(comments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Comment = typeof comments.$inferSelect;
export type InsertComment = z.infer<typeof insertCommentSchema>;

export const ticketComments = pgTable("ticket_comments", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").references(() => tickets.id),
  content: text("content").notNull(),
  authorId: text("author_id"),
  authorName: text("author_name"),
  isInternal: boolean("is_internal").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTicketCommentSchema = createInsertSchema(ticketComments).omit({
  id: true,
  createdAt: true,
});

export type TicketComment = typeof ticketComments.$inferSelect;
export type InsertTicketComment = z.infer<typeof insertTicketCommentSchema>;

export const contactCompanies = pgTable("contact_companies", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id),
  companyId: integer("company_id").references(() => companies.id),
  role: text("role").default("Owner"),
  isPrimary: boolean("is_primary").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertContactCompanySchema = createInsertSchema(contactCompanies).omit({
  id: true,
  createdAt: true,
});

export type ContactCompany = typeof contactCompanies.$inferSelect;
export type InsertContactCompany = z.infer<typeof insertContactCompanySchema>;

export const pipelineStages = pgTable("pipeline_stages", {
  id: serial("id").primaryKey(),
  pipeline: text("pipeline").notNull(),
  stageName: text("stage_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  color: text("color").default("#6366f1"),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPipelineStageSchema = createInsertSchema(pipelineStages).omit({
  id: true,
  createdAt: true,
});

export type PipelineStage = typeof pipelineStages.$inferSelect;
export type InsertPipelineStage = z.infer<typeof insertPipelineStageSchema>;

export const notificationPreferences = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  eventType: text("event_type").notNull(),
  enabled: boolean("enabled").default(true),
  emailEnabled: boolean("email_enabled").default(false),
  digestDaily: boolean("digest_daily").default(true),
  digestWeekly: boolean("digest_weekly").default(true),
});

export const insertNotificationPreferenceSchema = createInsertSchema(notificationPreferences).omit({
  id: true,
});

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreference = z.infer<typeof insertNotificationPreferenceSchema>;

export const savedFilters = pgTable("saved_filters", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  entityType: text("entity_type").notNull(),
  filters: jsonb("filters").notNull(),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSavedFilterSchema = createInsertSchema(savedFilters).omit({
  id: true,
  createdAt: true,
});

export type SavedFilter = typeof savedFilters.$inferSelect;
export type InsertSavedFilter = z.infer<typeof insertSavedFilterSchema>;

export const NOTIFICATION_EVENT_TYPES = [
  "deal_created",
  "deal_stage_changed",
  "deal_closed_won",
  "ticket_created",
  "ticket_updated",
  "task_assigned",
  "task_due_soon",
  "sla_breach",
  "contact_created",
  "hot_lead",
  "sequence_completed",
  "mention",
  "comment_reply",
  "daily_digest",
  "weekly_digest",
] as const;

export const CONTACT_COMPANY_ROLES = [
  "Owner",
  "Manager",
  "Authorized Signer",
  "Bookkeeper",
  "Other",
] as const;

export const csvImports = pgTable("csv_imports", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  sourceFormat: text("source_format").default("custom"),
  totalRows: integer("total_rows").default(0),
  newRecords: integer("new_records").default(0),
  duplicatesSkipped: integer("duplicates_skipped").default(0),
  errorsCount: integer("errors_count").default(0),
  verticalBreakdown: jsonb("vertical_breakdown"),
  importSource: text("import_source"),
  status: text("status").default("processing"),
  importedBy: text("imported_by"),
  dealsCreated: integer("deals_created").default(0),
  hotLeads: integer("hot_leads").default(0),
  warmLeads: integer("warm_leads").default(0),
  coldLeads: integer("cold_leads").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertCsvImportSchema = createInsertSchema(csvImports).omit({
  id: true,
  createdAt: true,
});

export type CsvImport = typeof csvImports.$inferSelect;
export type InsertCsvImport = z.infer<typeof insertCsvImportSchema>;

export const generatedBlogPosts = pgTable("generated_blog_posts", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  excerpt: text("excerpt").notNull(),
  category: text("category").notNull(),
  author: text("author").notNull().default("Liberty Bancard Team"),
  readTime: text("read_time").notNull(),
  publishDate: text("publish_date").notNull(),
  publishedISO: text("published_iso").notNull(),
  modifiedISO: text("modified_iso").notNull(),
  keywords: text("keywords").notNull(),
  metaDescription: text("meta_description").notNull(),
  content: jsonb("content").notNull(),
  faqs: jsonb("faqs"),
  status: text("status").notNull().default("draft"),
  scheduledAt: timestamp("scheduled_at"),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: integer("created_by"),
});

export const insertGeneratedBlogPostSchema = createInsertSchema(generatedBlogPosts).omit({
  id: true,
  createdAt: true,
});

export type GeneratedBlogPost = typeof generatedBlogPosts.$inferSelect;
export type InsertGeneratedBlogPost = z.infer<typeof insertGeneratedBlogPostSchema>;

export const SDR_PIPELINE_STAGES = [
  "DISCOVERED", "ENRICHING", "ENRICHED", "DEDUPED", "CLASSIFIED", "QUALIFIED",
  "OUTREACH_EMAIL", "OUTREACH_SMS", "OUTREACH_CHAT", "OUTREACH_CALL",
  "ENGAGED", "MEETING_SET", "STATEMENT_REQUESTED", "STATEMENT_RECEIVED",
  "ANALYSIS_READY", "PROPOSAL_SENT", "NEGOTIATION", "APPLICATION_STARTED",
  "UNDERWRITING", "CLOSED_WON", "BOARDED", "TERMINAL_SHIPPED", "NURTURE", "DEAD",
  "CONVERTED",
] as const;

export const SDR_STAGES = SDR_PIPELINE_STAGES;

export const SDR_PRIORITY_BUCKETS = ["A", "B", "C", "nurture"] as const;

export const GHL_OPPORTUNITY_STAGES = [
  "New Prospect", "Qualified", "Engaged", "Meeting Set",
  "Statement Requested", "Proposal Sent", "Won", "Lost",
] as const;

export const GHL_CUSTOM_FIELDS = [
  "lb_merchant_id", "lb_current_stage", "lb_fit_score", "lb_revenue_score",
  "lb_reachability_score", "lb_priority_score", "lb_vertical", "lb_best_channel",
  "lb_statement_status", "lb_proposal_status", "lb_last_ai_outcome", "lb_owner_type",
] as const;

export const GHL_TAGS = [
  "LB-AI-SDR", "LB-AUTO", "LB-MEDSPA", "LB-DENTAL", "LB-BOOKING-READY",
  "LB-STATEMENT-PENDING", "LB-PROPOSAL-SENT", "LB-HUMAN-HANDOFF", "LB-DO-NOT-AUTO",
] as const;

export const businesses = pgTable("businesses", {
  id: serial("id").primaryKey(),
  canonicalName: text("canonical_name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  websiteDomain: text("website_domain"),
  mainPhone: text("main_phone"),
  mainEmail: text("main_email"),
  streetAddress: text("street_address"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  country: text("country").default("US"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  industryPrimary: text("industry_primary"),
  industrySecondary: text("industry_secondary"),
  vertical: text("vertical"),
  subVertical: text("sub_vertical"),
  googlePlaceId: text("google_place_id"),
  facebookUrl: text("facebook_url"),
  instagramUrl: text("instagram_url"),
  yelpUrl: text("yelp_url"),
  isMultiLocation: boolean("is_multi_location").default(false),
  locationCountEstimate: integer("location_count_estimate").default(1),
  reviewCount: integer("review_count"),
  rating: real("rating"),
  status: text("status").default("new"),
  lastSourceType: text("last_source_type"),
  lastEnrichedAt: timestamp("last_enriched_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("businesses_normalized_name_city_state_idx").on(table.normalizedName, table.city, table.state),
  index("businesses_website_domain_idx").on(table.websiteDomain),
  index("businesses_main_phone_idx").on(table.mainPhone),
  index("businesses_google_place_id_idx").on(table.googlePlaceId),
]);

export const insertBusinessSchema = createInsertSchema(businesses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Business = typeof businesses.$inferSelect;
export type InsertBusiness = z.infer<typeof insertBusinessSchema>;
export type UpdateBusinessRequest = Partial<InsertBusiness>;

export const businessAliases = pgTable("business_aliases", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").references(() => businesses.id).notNull(),
  aliasName: text("alias_name").notNull(),
  aliasType: text("alias_type").default("imported"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBusinessAliasSchema = createInsertSchema(businessAliases).omit({
  id: true,
  createdAt: true,
});

export type BusinessAlias = typeof businessAliases.$inferSelect;
export type InsertBusinessAlias = z.infer<typeof insertBusinessAliasSchema>;

export const businessLocations = pgTable("business_locations", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").references(() => businesses.id).notNull(),
  locationName: text("location_name"),
  streetAddress: text("street_address"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  phone: text("phone"),
  email: text("email"),
  websiteUrl: text("website_url"),
  googlePlaceId: text("google_place_id"),
  rating: real("rating"),
  reviewCount: integer("review_count"),
  isPrimary: boolean("is_primary").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBusinessLocationSchema = createInsertSchema(businessLocations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type BusinessLocation = typeof businessLocations.$inferSelect;
export type InsertBusinessLocation = z.infer<typeof insertBusinessLocationSchema>;

export const leadSources = pgTable("lead_sources", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").references(() => businesses.id),
  contactId: integer("contact_id").references(() => contacts.id),
  sourceType: text("source_type").notNull(),
  sourceLabel: text("source_label"),
  sourceExternalId: text("source_external_id"),
  sourceUrl: text("source_url"),
  campaignTag: text("campaign_tag"),
  importBatchId: text("import_batch_id"),
  discoveredAt: timestamp("discovered_at").defaultNow(),
});

export const insertLeadSourceSchema = createInsertSchema(leadSources).omit({
  id: true,
});

export type LeadSource = typeof leadSources.$inferSelect;
export type InsertLeadSource = z.infer<typeof insertLeadSourceSchema>;

export const enrichmentRuns = pgTable("enrichment_runs", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").references(() => businesses.id),
  contactId: integer("contact_id").references(() => contacts.id),
  provider: text("provider").notNull(),
  jobType: text("job_type").notNull(),
  status: text("status").default("queued"),
  inputPayload: jsonb("input_payload"),
  outputPayload: jsonb("output_payload"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

export const insertEnrichmentRunSchema = createInsertSchema(enrichmentRuns).omit({
  id: true,
});

export type EnrichmentRun = typeof enrichmentRuns.$inferSelect;
export type InsertEnrichmentRun = z.infer<typeof insertEnrichmentRunSchema>;

export const BUSINESS_STATUSES = ["new", "active", "suppressed", "customer", "archived"] as const;
export const ALIAS_TYPES = ["imported", "directory", "manual", "enrichment"] as const;
export const LEAD_SOURCE_TYPES = ["outscraper", "apify_google", "apify_yelp", "serper", "seo", "affiliate", "chat_widget", "manual_upload", "ghl_form", "sunbiz", "csv_import"] as const;
export const ENRICHMENT_PROVIDERS = ["serper", "hunter", "apollo", "builtwith", "manual", "internal"] as const;
export const ENRICHMENT_JOB_TYPES_V2 = ["website_lookup", "email_lookup", "phone_validation", "processor_detection", "ad_detection"] as const;

export const sdrMerchants = pgTable("sdr_merchants", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").references(() => businesses.id),
  businessName: text("business_name").notNull(),
  legalName: text("legal_name"),
  website: text("website"),
  domain: text("domain"),
  mainPhone: text("main_phone"),
  mainEmail: text("main_email"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  vertical: text("vertical"),
  subvertical: text("subvertical"),
  source: text("source"),
  sourceRef: text("source_ref"),
  ghlContactId: text("ghl_contact_id"),
  ghlOpportunityId: text("ghl_opportunity_id"),
  existingCustomerFlag: boolean("existing_customer_flag").default(false),
  doNotContactFlag: boolean("do_not_contact_flag").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("sdr_merchants_ghl_contact_id_idx").on(table.ghlContactId),
]);

export const insertSdrMerchantSchema = createInsertSchema(sdrMerchants).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SdrMerchant = typeof sdrMerchants.$inferSelect;
export type InsertSdrMerchant = z.infer<typeof insertSdrMerchantSchema>;

export const sdrMerchantContacts = pgTable("sdr_merchant_contacts", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").references(() => sdrMerchants.id),
  contactName: text("contact_name"),
  title: text("title"),
  email: text("email"),
  mobile: text("mobile"),
  directPhone: text("direct_phone"),
  roleGuess: text("role_guess"),
  primaryContactFlag: boolean("primary_contact_flag").default(false),
  consentSms: boolean("consent_sms").default(false),
  consentEmail: boolean("consent_email").default(false),
  consentCall: boolean("consent_call").default(false),
  consentSource: text("consent_source"),
  consentAt: timestamp("consent_at"),
  timezone: text("timezone"),
  bestContactChannel: text("best_contact_channel"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSdrMerchantContactSchema = createInsertSchema(sdrMerchantContacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SdrMerchantContact = typeof sdrMerchantContacts.$inferSelect;
export type InsertSdrMerchantContact = z.infer<typeof insertSdrMerchantContactSchema>;

export const sdrLeadState = pgTable("sdr_lead_state", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").references(() => sdrMerchants.id).notNull().unique(),
  businessId: integer("business_id").references(() => businesses.id),
  contactId: integer("contact_id").references(() => contacts.id),
  currentStage: text("current_stage").notNull().default("DISCOVERED"),
  stage: text("stage").notNull().default("DISCOVERED"),
  substage: text("substage"),
  statusReason: text("status_reason"),
  qualificationTier: text("qualification_tier"),
  companyName: text("company_name"),
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  vertical: text("vertical"),
  city: text("city"),
  state: text("state"),
  fitScore: integer("fit_score").default(0),
  revenueScore: integer("revenue_score").default(0),
  reachabilityScore: integer("reachability_score").default(0),
  processorScore: integer("processor_score").default(0),
  growthScore: integer("growth_score").default(0),
  priorityScore: integer("priority_score").default(0),
  priorityBucket: text("priority_bucket").default("C"),
  scoreBreakdown: jsonb("score_breakdown"),
  lastScoredAt: timestamp("last_scored_at"),
  boardingProbability: real("boarding_probability"),
  nextAction: text("next_action"),
  nextActionType: text("next_action_type"),
  nextActionPayload: jsonb("next_action_payload"),
  nextActionAt: timestamp("next_action_at"),
  assignedTo: text("assigned_to"),
  ownerType: text("owner_type").default("ai"),
  proposalId: text("proposal_id"),
  meetingId: text("meeting_id"),
  emailAttempts: integer("email_attempts").default(0),
  smsAttempts: integer("sms_attempts").default(0),
  callAttempts: integer("call_attempts").default(0),
  lastEmailAt: timestamp("last_email_at"),
  lastSmsAt: timestamp("last_sms_at"),
  lastCallAt: timestamp("last_call_at"),
  lastReplyAt: timestamp("last_reply_at"),
  lastTouchAt: timestamp("last_touch_at"),
  consentEmail: boolean("consent_email").default(true),
  consentSms: boolean("consent_sms").default(false),
  consentCall: boolean("consent_call").default(false),
  optedOutEmail: boolean("opted_out_email").default(false),
  optedOutSms: boolean("opted_out_sms").default(false),
  ghlContactId: text("ghl_contact_id"),
  enrichmentData: jsonb("enrichment_data"),
  ownerName: text("owner_name"),
  ownerEmail: text("owner_email"),
  ownerPhone: text("owner_phone"),
  locationCount: integer("location_count").default(1),
  estimatedTicketSize: text("estimated_ticket_size"),
  estimatedVolume: text("estimated_volume"),
  serviceType: text("service_type"),
  hasBookingSystem: boolean("has_booking_system").default(false),
  hasEcommerce: boolean("has_ecommerce").default(false),
  billingHints: text("billing_hints"),
  websiteQuality: text("website_quality"),
  businessMaturity: text("business_maturity"),
  contactQuality: text("contact_quality"),
  decisionReason: text("decision_reason"),
  pausedUntil: timestamp("paused_until"),
  sourceType: text("source_type").default("import"),
  sourceId: text("source_id"),
  statementUploadToken: text("statement_upload_token"),
  statementRequestedAt: timestamp("statement_requested_at"),
  statementReminderCount: integer("statement_reminder_count").default(0),
  proposalTrackingId: text("proposal_tracking_id"),
  proposalViewedAt: timestamp("proposal_viewed_at"),
  proposalClickedAt: timestamp("proposal_clicked_at"),
  proposalResendCount: integer("proposal_resend_count").default(0),
  assignedUserId: text("assigned_user_id"),
  assignedOwnerType: text("assigned_owner_type").default("ai"),
  humanHandoffAt: timestamp("human_handoff_at"),
  humanHandoffNote: text("human_handoff_note"),
  noShowCount: integer("no_show_count").default(0),
  dealId: integer("deal_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("sdr_lead_state_stage_idx").on(table.stage),
  index("sdr_lead_state_priority_bucket_idx").on(table.priorityBucket),
  index("sdr_lead_state_merchant_id_idx").on(table.merchantId),
  index("sdr_lead_state_contact_id_idx").on(table.contactId),
  index("sdr_lead_state_next_action_at_idx").on(table.nextActionAt),
]);

export const insertSdrLeadStateSchema = createInsertSchema(sdrLeadState).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SdrLeadState = typeof sdrLeadState.$inferSelect;
export type InsertSdrLeadState = z.infer<typeof insertSdrLeadStateSchema>;
export type UpdateSdrLeadState = Partial<InsertSdrLeadState>;

export const sdrLeadEvents = pgTable("sdr_lead_events", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").references(() => sdrMerchants.id),
  contactId: integer("contact_id").references(() => sdrMerchantContacts.id),
  leadStateId: integer("lead_state_id").references(() => sdrLeadState.id),
  eventType: text("event_type").notNull(),
  fromStage: text("from_stage"),
  toStage: text("to_stage"),
  actionType: text("action_type"),
  channel: text("channel"),
  actorType: text("actor_type"),
  eventAt: timestamp("event_at").defaultNow(),
  payloadJson: jsonb("payload_json"),
  decisionReason: text("decision_reason"),
  metadata: jsonb("metadata"),
  modelVersion: text("model_version"),
  complianceResult: text("compliance_result"),
  ghlRefId: text("ghl_ref_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSdrLeadEventSchema = createInsertSchema(sdrLeadEvents).omit({
  id: true,
  createdAt: true,
});

export type SdrLeadEvent = typeof sdrLeadEvents.$inferSelect;
export type InsertSdrLeadEvent = z.infer<typeof insertSdrLeadEventSchema>;

export const sdrChannelAttempts = pgTable("sdr_channel_attempts", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").references(() => sdrMerchants.id),
  leadStateId: integer("lead_state_id").references(() => sdrLeadState.id),
  channel: text("channel").notNull(),
  attemptNo: integer("attempt_no").default(1),
  attemptNumber: integer("attempt_number").notNull().default(1),
  status: text("status").default("sent"),
  templateId: text("template_id"),
  templateKey: text("template_key"),
  ghlMessageId: text("ghl_message_id"),
  subject: text("subject"),
  body: text("body"),
  error: text("error"),
  sentAt: timestamp("sent_at").defaultNow(),
  deliveredAt: timestamp("delivered_at"),
  openedAt: timestamp("opened_at"),
  clickedAt: timestamp("clicked_at"),
  repliedAt: timestamp("replied_at"),
  outcome: text("outcome"),
  cost: real("cost"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("sdr_channel_attempts_merchant_id_channel_idx").on(table.merchantId, table.channel),
]);

export const insertSdrChannelAttemptSchema = createInsertSchema(sdrChannelAttempts).omit({
  id: true,
  createdAt: true,
});

export type SdrChannelAttempt = typeof sdrChannelAttempts.$inferSelect;
export type InsertSdrChannelAttempt = z.infer<typeof insertSdrChannelAttemptSchema>;

export const sdrComplianceState = pgTable("sdr_compliance_state", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").references(() => sdrMerchants.id).notNull().unique(),
  smsAllowed: boolean("sms_allowed").default(true),
  emailAllowed: boolean("email_allowed").default(true),
  callAllowed: boolean("call_allowed").default(true),
  quietHoursBlock: boolean("quiet_hours_block").default(false),
  dncBlock: boolean("dnc_block").default(false),
  complaintBlock: boolean("complaint_block").default(false),
  litigationBlock: boolean("litigation_block").default(false),
  consentSource: text("consent_source"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSdrComplianceStateSchema = createInsertSchema(sdrComplianceState).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SdrComplianceState = typeof sdrComplianceState.$inferSelect;
export type InsertSdrComplianceState = z.infer<typeof insertSdrComplianceStateSchema>;

export const WARMUP_STATUSES = ["warming", "warm", "paused", "disabled"] as const;

export const MAILBOX_TYPES = ["google_workspace", "microsoft_365", "smtp", "other"] as const;

export const sendingIdentities = pgTable("sending_identities", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  domain: text("domain").notNull(),
  emailAddress: text("email_address").notNull(),
  mailboxType: text("mailbox_type").default("google_workspace"),
  provider: text("provider"),
  ghlLocationId: text("ghl_location_id"),
  isActive: boolean("is_active").default(true),
  warmupStatus: text("warmup_status").default("warming"),
  warmupStartedAt: timestamp("warmup_started_at"),
  dailyLimit: integer("daily_limit").default(30),
  sentToday: integer("sent_today").default(0),
  bouncesToday: integer("bounces_today").default(0),
  complaintsToday: integer("complaints_today").default(0),
  healthScore: real("health_score").default(100),
  verticalAssignment: text("vertical_assignment"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSendingIdentitySchema = createInsertSchema(sendingIdentities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SendingIdentity = typeof sendingIdentities.$inferSelect;
export type InsertSendingIdentity = z.infer<typeof insertSendingIdentitySchema>;

export const identityPerformanceDaily = pgTable("identity_performance_daily", {
  id: serial("id").primaryKey(),
  sendingIdentityId: integer("sending_identity_id").references(() => sendingIdentities.id).notNull(),
  date: text("date").notNull(),
  emailsSent: integer("emails_sent").default(0),
  delivered: integer("delivered").default(0),
  bounced: integer("bounced").default(0),
  opened: integer("opened").default(0),
  replied: integer("replied").default(0),
  complaints: integer("complaints").default(0),
  meetingsBooked: integer("meetings_booked").default(0),
  positiveReplies: integer("positive_replies").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertIdentityPerformanceDailySchema = createInsertSchema(identityPerformanceDaily).omit({
  id: true,
  createdAt: true,
});

export type IdentityPerformanceDaily = typeof identityPerformanceDaily.$inferSelect;
export type InsertIdentityPerformanceDaily = z.infer<typeof insertIdentityPerformanceDailySchema>;

export const domainBusinessLog = pgTable("domain_business_log", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull(),
  businessId: integer("business_id").notNull(),
  sentAt: timestamp("sent_at").defaultNow(),
});

export const leadDiscoveryJobs = pgTable("lead_discovery_jobs", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("pending"),
  triggerType: text("trigger_type").notNull().default("manual"),
  searchVerticals: text("search_verticals").array(),
  searchMetros: text("search_metros").array(),
  dataSources: text("data_sources").array(),
  rawFound: integer("raw_found").default(0),
  newInserted: integer("new_inserted").default(0),
  duplicatesSkipped: integer("duplicates_skipped").default(0),
  errorsCount: integer("errors_count").default(0),
  enrichmentQueued: integer("enrichment_queued").default(0),
  costEstimate: real("cost_estimate").default(0),
  errorLog: text("error_log"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLeadDiscoveryJobSchema = createInsertSchema(leadDiscoveryJobs).omit({
  id: true,
  createdAt: true,
});

export type LeadDiscoveryJob = typeof leadDiscoveryJobs.$inferSelect;
export type InsertLeadDiscoveryJob = z.infer<typeof insertLeadDiscoveryJobSchema>;

export const leadDiscoveryResults = pgTable("lead_discovery_results", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").references(() => leadDiscoveryJobs.id).notNull(),
  source: text("source").notNull(),
  vertical: text("vertical"),
  metro: text("metro"),
  businessName: text("business_name").notNull(),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  rating: real("rating"),
  reviewCount: integer("review_count"),
  placeId: text("place_id"),
  rawData: jsonb("raw_data"),
  status: text("status").notNull().default("new"),
  merchantId: integer("merchant_id"),
  dedupReason: text("dedup_reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLeadDiscoveryResultSchema = createInsertSchema(leadDiscoveryResults).omit({
  id: true,
  createdAt: true,
});

export type LeadDiscoveryResult = typeof leadDiscoveryResults.$inferSelect;
export type InsertLeadDiscoveryResult = z.infer<typeof insertLeadDiscoveryResultSchema>;

export const processorSignals = pgTable("processor_signals", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").references(() => businesses.id).notNull(),
  signalType: text("signal_type").notNull(),
  vendorName: text("vendor_name").notNull(),
  detectionMethod: text("detection_method").notNull(),
  confidenceScore: real("confidence_score").default(0),
  evidence: text("evidence"),
  detectedAt: timestamp("detected_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("processor_signals_business_id_idx").on(table.businessId),
  index("processor_signals_vendor_name_idx").on(table.vendorName),
]);

export const insertProcessorSignalSchema = createInsertSchema(processorSignals).omit({
  id: true,
  createdAt: true,
});

export type ProcessorSignal = typeof processorSignals.$inferSelect;
export type InsertProcessorSignal = z.infer<typeof insertProcessorSignalSchema>;

export const adSignals = pgTable("ad_signals", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").references(() => businesses.id).notNull(),
  platform: text("platform").notNull(),
  isRunningAds: boolean("is_running_ads").default(false),
  confidenceScore: real("confidence_score").default(0),
  adCountEstimate: integer("ad_count_estimate").default(0),
  lastSeenAt: timestamp("last_seen_at"),
  evidence: text("evidence"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("ad_signals_business_id_idx").on(table.businessId),
  index("ad_signals_platform_idx").on(table.platform),
]);

export const insertAdSignalSchema = createInsertSchema(adSignals).omit({
  id: true,
  createdAt: true,
});

export type AdSignal = typeof adSignals.$inferSelect;
export type InsertAdSignal = z.infer<typeof insertAdSignalSchema>;

export const PROCESSOR_SIGNAL_TYPES = [
  "processor",
  "pos",
  "booking_platform",
  "ecommerce_platform",
] as const;

export const DETECTION_METHODS = [
  "script",
  "html_text",
  "serper",
  "manual",
  "api",
] as const;

export const AD_PLATFORMS = [
  "facebook",
  "google",
  "instagram",
  "unknown",
] as const;

export const SWITCHABLE_PROCESSORS = [
  "Square",
  "Stripe",
  "Toast",
  "Clover",
  "PayPal",
  "Shopify",
] as const;

export const dailyFunnelMetrics = pgTable("daily_funnel_metrics", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),
  vertical: text("vertical"),
  state: text("state"),
  sourceType: text("source_type"),
  leadsFound: integer("leads_found").default(0),
  leadsEnriched: integer("leads_enriched").default(0),
  hotCreated: integer("hot_created").default(0),
  warmCreated: integer("warm_created").default(0),
  emailsSent: integer("emails_sent").default(0),
  smsSent: integer("sms_sent").default(0),
  callsMade: integer("calls_made").default(0),
  replies: integer("replies").default(0),
  positiveReplies: integer("positive_replies").default(0),
  meetingsBooked: integer("meetings_booked").default(0),
  statementsReceived: integer("statements_received").default(0),
  proposalsSent: integer("proposals_sent").default(0),
  proposalsViewed: integer("proposals_viewed").default(0),
  appsStarted: integer("apps_started").default(0),
  appsCompleted: integer("apps_completed").default(0),
  closedWon: integer("closed_won").default(0),
  closedLost: integer("closed_lost").default(0),
  revenue: text("revenue"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("daily_funnel_metrics_date_idx").on(table.date),
  index("daily_funnel_metrics_date_vertical_idx").on(table.date, table.vertical),
]);

export const insertDailyFunnelMetricsSchema = createInsertSchema(dailyFunnelMetrics).omit({
  id: true,
  createdAt: true,
});

export type DailyFunnelMetrics = typeof dailyFunnelMetrics.$inferSelect;
export type InsertDailyFunnelMetrics = z.infer<typeof insertDailyFunnelMetricsSchema>;

export const ghlSyncStatus = pgTable("ghl_sync_status", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncDirection: text("last_sync_direction"),
  syncedCount: integer("synced_count").default(0),
  errorCount: integer("error_count").default(0),
  lastError: text("last_error"),
  localCount: integer("local_count").default(0),
  ghlCount: integer("ghl_count").default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("ghl_sync_status_entity_type_idx").on(table.entityType),
]);

export type GhlSyncStatusRecord = typeof ghlSyncStatus.$inferSelect;

export const ghlWorkflowMappings = pgTable("ghl_workflow_mappings", {
  id: serial("id").primaryKey(),
  sequenceName: text("sequence_name").notNull(),
  ghlWorkflowId: text("ghl_workflow_id"),
  category: text("category"),
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("ghl_workflow_mappings_sequence_name_idx").on(table.sequenceName),
]);

export const insertGhlWorkflowMappingSchema = createInsertSchema(ghlWorkflowMappings).omit({
  id: true,
  updatedAt: true,
});

export type GhlWorkflowMapping = typeof ghlWorkflowMappings.$inferSelect;
export type InsertGhlWorkflowMapping = z.infer<typeof insertGhlWorkflowMappingSchema>;

export const GHL_PIPELINE_STAGE_MAP: Record<string, string> = {
  "New Lead": "new_lead",
  "Statement Received": "statement_received",
  "Review In Progress": "review_in_progress",
  "Call Booked": "call_booked",
  "Proposal Sent": "proposal_sent",
  "Negotiation / Follow-Up": "negotiation",
  "Nurture / Not Now": "nurture",
  "Closed Won": "won",
  "Closed Lost": "lost",
  "Contract Sent": "contract_sent",
  "Application Started": "application_started",
  "Underwriting Submitted": "underwriting_submitted",
  "Approved": "approved",
  "Terminal Ordered": "terminal_ordered",
  "Go-Live Scheduled": "go_live_scheduled",
  "Live (First Batch)": "live_first_batch",
  "Active (7 Days)": "active_7_days",
  "Active (30 Days)": "active_30_days",
};

export const GHL_PIPELINE_STAGE_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(GHL_PIPELINE_STAGE_MAP).map(([k, v]) => [v, k])
);

export const ALLOWED_SENDING_DOMAINS = [
  "libertypayments.co",
  "getlibertyprocessing.com",
  "libertybancard.com",
  "libertybancardconsulting.com",
] as const;

export const ACTIVE_DEAL_STAGES = [
  "New Lead",
  "Statement Received",
  "Review In Progress",
  "Call Booked",
  "Proposal Sent",
  "Negotiation / Follow-Up",
  "Contract Sent",
  "Application Started",
  "Underwriting Submitted",
  "Approved",
  "Terminal Ordered",
  "Go-Live Scheduled",
] as const;

export const CLOSED_DEAL_STAGES = [
  "Closed Won",
  "Closed Lost",
  "Nurture / Not Now",
  "Live (First Batch)",
  "Active (7 Days)",
  "Active (30 Days)",
] as const;
