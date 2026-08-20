import { pgTable, text, serial, integer, boolean, timestamp, jsonb, varchar, real, numeric, index, uniqueIndex, unique, date, uuid, check, bigint, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./models/auth";

export * from "./models/auth";
export * from "./models/chat";

// ---------------------------------------------------------------------------
// Import Executions — one row per file-based import run (CSV, Sunbiz, etc.)
// ---------------------------------------------------------------------------
export const importExecutions = pgTable("import_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  importType: text("import_type").notNull(), // csv_contact | sunbiz_upload | sunbiz_corevt | prospect_csv
  fileHash: text("file_hash"),
  status: text("status").notNull().default("running"), // running | completed | failed
  totalRows: integer("total_rows"),
  insertedRows: integer("inserted_rows"),
  updatedRows: integer("updated_rows"),
  skippedRows: integer("skipped_rows"),
  errorRows: integer("error_rows"),
  actorType: text("actor_type"),
  actorId: text("actor_id"),
  metadata: jsonb("metadata"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  // Prevent re-completing the same file twice (replay protection)
  uniqueIndex("import_executions_type_hash_completed_uidx")
    .on(table.importType, table.fileHash)
    .where(sql`file_hash IS NOT NULL AND status = 'completed'`),
]);

export type ImportExecution = typeof importExecutions.$inferSelect;
export type InsertImportExecution = typeof importExecutions.$inferInsert;

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
  gclid: text("gclid"),
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
  linkedinEnrichedAt: timestamp("linkedin_enriched_at"),
  outreachQueueSkippedAt: timestamp("outreach_queue_skipped_at"),
  linkedinEnrichmentLog: jsonb("linkedin_enrichment_log"),
  industry: text("industry"),
  leadSource: text("lead_source"),
  employeeCount: integer("employee_count"),
  annualRevenue: text("annual_revenue"),
  businessId: integer("business_id").references(() => businesses.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  archivedAt: timestamp("archived_at"),
  partnerOrgId: integer("partner_org_id"),
  lastSyncedAt: timestamp("last_synced_at"),
  churnRiskTier: text("churn_risk_tier"),
  isParentAccount: boolean("is_parent_account").default(false),
  parentContactId: integer("parent_contact_id"),
  locationName: text("location_name"),
  emailStatus: text("email_status").notNull().default("unvalidated"),
  bouncedAt: timestamp("bounced_at"),
  isDecisionMaker: boolean("is_decision_maker").notNull().default(false),
  decisionMakerConfidence: integer("decision_maker_confidence").notNull().default(0),
  managementType: text("management_type").notNull().default("unknown"),
  smsStatus: text("sms_status").notNull().default("active"),
  lastVoicemailAt: timestamp("last_voicemail_at"),
  reachabilityScore: integer("reachability_score").notNull().default(100),
  callAttempts: integer("call_attempts").notNull().default(0),
  doNotAutoContact: boolean("do_not_auto_contact").notNull().default(false),
  phoneType: text("phone_type"),
  consentTier: text("consent_tier").notNull().default("cold_no_consent"),
  lifecycleStage: text("lifecycle_stage").notNull().default("prospect"),
  timezone: text("timezone"),
  sourceCategory: text("source_category"),
  offerConfidence: integer("offer_confidence"),
  recommendedNextAction: text("recommended_next_action"),
  offerReasoning: text("offer_reasoning"),
  offerRoutingSource: text("offer_routing_source"),
  processorDetected: text("processor_detected"),
  offerRoutedAt: timestamp("offer_routed_at"),
  offerMatchedSignals: jsonb("offer_matched_signals"),
  optedOutEmail: boolean("opted_out_email").default(false),
  dataCompletenessScore: integer("data_completeness_score"),
  dataReadinessScore: integer("data_readiness_score"),
  dataReadinessGrade: text("data_readiness_grade"),
  readinessBreakdown: jsonb("readiness_breakdown"),
  readinessUpdatedAt: timestamp("readiness_updated_at"),
  readinessModelVersion: integer("readiness_model_version"),
  lastMeaningfulContactMutationAt: timestamp("last_meaningful_contact_mutation_at"),
  // Intake provenance — immutable after first set; dual-field design:
  // sourceCategory (line 99 above) = operational field read by contactability.ts
  // primarySourceCategory = permanent record of acquisition origin
  primarySourceCategory: text("primary_source_category"),
  primarySourceType: text("primary_source_type"),
  // DEFERRABLE INITIALLY DEFERRED: allows insert-contact-then-insert-event-then-UPDATE
  // within a single transaction without violating FK at mid-tx.
  primarySourceEventId: integer("primary_source_event_id").references((): AnyPgColumn => contactSourceEvents.id),
  // Vertical provenance — server-assigned only; never accepted from client input.
  // verticalSource: which pipeline/process last set the vertical value.
  // verticalConfidence: 0–100 integer; NULL = not yet scored.
  // manualVerticalOverride: NULL=unknown, false=evaluated/not-overridden, true=confirmed operator override.
  verticalSource: text("vertical_source"),
  verticalConfidence: integer("vertical_confidence"),
  manualVerticalOverride: boolean("manual_vertical_override"),
  // ── Suppression / compliance metadata ────────────────────────────────────
  leadConsentLevel: text("lead_consent_level").default("unknown"),     // unknown|implied|explicit|pewc
  emailReadiness: text("email_readiness").default("unknown"),          // unknown|valid|invalid|bounced|unverifiable
  smsConsentStatus: text("sms_consent_status").default("not_collected"), // not_collected|opted_in|opted_out|a2p_blocked
  optOutStatus: text("opt_out_status").default("active"),              // active|opted_out
  optOutDate: timestamp("opt_out_date"),
  optOutChannel: text("opt_out_channel"),
  unsubscribeStatus: text("unsubscribe_status").default("active"),     // active|unsubscribed
  unsubscribeDate: timestamp("unsubscribe_date"),
  bounceStatus: text("bounce_status").default("none"),                 // none|soft|hard
  bounceDate: timestamp("bounce_date"),
  bounceReason: text("bounce_reason"),
  complaintStatus: text("complaint_status").default("none"),           // none|reported
  complaintDate: timestamp("complaint_date"),
  dncDate: timestamp("dnc_date"),
  dncSource: text("dnc_source"),
  existingMerchantCustomer: boolean("existing_merchant_customer").default(false),
  suppressionReason: text("suppression_reason"),
  suppressionHistory: jsonb("suppression_history").default(sql`'[]'::jsonb`),
  nextAllowedContactDate: timestamp("next_allowed_contact_date"),
  consentAuditTrail: jsonb("consent_audit_trail").default(sql`'[]'::jsonb`),
  // ── Attribution extras ────────────────────────────────────────────────────
  referrerUrl: text("referrer_url"),
  sourcePath: text("source_path"),
  // importBatchId links every contact to its import_executions record so
  // admins can query "all contacts from batch X" without joining tables.
  importBatchId: text("import_batch_id"),
  rowProvenance: jsonb("row_provenance"),
  // ── Rep assignment ────────────────────────────────────────────────────────
  // Stores the email of the rep who owns this contact (consistent with deals.owner).
  // NULL = unassigned. Set manually or auto-populated from the deal owner.
  assignedTo: text("assigned_to"),
  // ── Canonical lifecycle state ─────────────────────────────────────────────
  // Observer/derived field managed by LifecycleService. Never set directly.
  // Valid values: see LIFECYCLE_STATES in server/services/lifecycle-service.ts
  lifecycleState: text("lifecycle_state").notNull().default("PROSPECT"),
  lifecycleStateUpdatedAt: timestamp("lifecycle_state_updated_at"),
  // ── Lead freshness SLA ────────────────────────────────────────────────────
  // Set by processNewLead() for high-score leads (score >= LEAD_SLA_SCORE_THRESHOLD).
  // The SLA worker checks this every 5 minutes and escalates when past-due
  // with no human touch. NULL = not yet set or already resolved.
  nextSlaDueAt: timestamp("next_sla_due_at"),
}, (table) => [
  uniqueIndex("contacts_email_unique_idx").on(table.email).where(sql`archived_at IS NULL`),
  index("contacts_phone_idx").on(table.phone),
  uniqueIndex("contacts_ghl_contact_id_unique").on(table.ghlContactId).where(sql`ghl_contact_id IS NOT NULL AND BTRIM(ghl_contact_id) <> ''`),
  index("contacts_created_at_idx").on(table.createdAt),
  index("contacts_email_archived_at_idx").on(table.email, table.archivedAt),
  index("contacts_phone_archived_at_idx").on(table.phone, table.archivedAt),
  index("contacts_lifecycle_state_idx").on(table.lifecycleState),
  check("contacts_vertical_confidence_range", sql`vertical_confidence IS NULL OR (vertical_confidence BETWEEN 0 AND 100)`),
]);

export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  // Provenance fields are server-assigned only — never accepted from client input.
  // Use serverInsertContactSchema (below) for internal writes that need these.
  sourceCategory: true,
  primarySourceCategory: true,
  primarySourceType: true,
  primarySourceEventId: true,
  // Vertical provenance — server-assigned; clients cannot forge vertical authority.
  verticalSource: true,
  verticalConfidence: true,
  manualVerticalOverride: true,
});

// Internal-only schema used by writeContact() — includes provenance fields.
// Never expose this to client-facing request parsing.
export const serverInsertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
});
export type ServerInsertContact = z.infer<typeof serverInsertContactSchema>;

// ---------------------------------------------------------------------------
// Contact Source Events — one row per intake event per contact
// UNIQUE (contact_id, event_key) prevents duplicate ingestion of same event
// ---------------------------------------------------------------------------
export const contactSourceEvents = pgTable("contact_source_events", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull().references(() => contacts.id),
  // eventKey is server-generated, non-null, guaranteed unique per contact.
  // Examples: form:statement_upload:<nanoid>, ghl:<ghlId>:<hash>, import:<execId>:row:<n>
  eventKey: text("event_key").notNull(),
  sourceCategory: text("source_category").notNull(),
  sourceType: text("source_type").notNull(),
  sourceExternalId: text("source_external_id"),
  importExecutionId: uuid("import_execution_id").references(() => importExecutions.id),
  sourceRowNumber: integer("source_row_number"),
  rowFingerprint: text("row_fingerprint"),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  metadata: jsonb("metadata"),
  firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  // Core idempotency constraint — non-null eventKey ensures this always fires
  uniqueIndex("contact_source_events_contact_key_uidx").on(table.contactId, table.eventKey),
  index("contact_source_events_contact_id_idx").on(table.contactId),
  index("contact_source_events_import_execution_idx").on(table.importExecutionId),
]);

export type ContactSourceEvent = typeof contactSourceEvents.$inferSelect;
export type InsertContactSourceEvent = typeof contactSourceEvents.$inferInsert;

// ---------------------------------------------------------------------------
// Contact Lifecycle History — one row per lifecycle_state transition
// ---------------------------------------------------------------------------
export const contactLifecycleHistory = pgTable("contact_lifecycle_history", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  fromState: text("from_state"),
  toState: text("to_state").notNull(),
  transitionedAt: timestamp("transitioned_at").notNull().defaultNow(),
  trigger: text("trigger"),
  actorType: text("actor_type"),
  actorId: text("actor_id"),
  source: text("source"),
  reason: text("reason"),
  automationKey: text("automation_key"),
  metadata: jsonb("metadata"),
}, (table) => [
  index("contact_lifecycle_history_contact_idx").on(table.contactId, table.transitionedAt),
]);

export type ContactLifecycleHistoryRow = typeof contactLifecycleHistory.$inferSelect;
export type InsertContactLifecycleHistory = typeof contactLifecycleHistory.$inferInsert;

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
  managementType: text("management_type").notNull().default("unknown"),
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
  name: text("name"),
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
  terminalApprovalStatus: text("terminal_approval_status").default("not_required"),
  terminalApprovalTaskId: integer("terminal_approval_task_id"),
  terminalCostAtOrder: real("terminal_cost_at_order"),
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
  analysisStatus: text("analysis_status").default("none"),
  statementReceived: boolean("statement_received").default(false),
  voidedCheckReceived: boolean("voided_check_received").default(false),
  idReceived: boolean("id_received").default(false),
  appCompleted: boolean("app_completed").default(false),
  docReadinessScore: integer("doc_readiness_score").default(0),
  lastNudgeAt: timestamp("last_nudge_at"),
  nextNudgeAt: timestamp("next_nudge_at"),
  blueprintGeneratedAt: timestamp("blueprint_generated_at"),
  closedAt: timestamp("closed_at"),
  processorApplicationId: text("processor_application_id"),
  mid: text("mid"),
  boardingStatus: text("boarding_status").default("not_submitted"),
  boardingLog: jsonb("boarding_log"),
  boardingSubmittedAt: timestamp("boarding_submitted_at"),
  boardingApprovedAt: timestamp("boarding_approved_at"),
  // Idempotency for durable processor submission (item 8).
  boardingIdempotencyKey: text("boarding_idempotency_key"),
  shareToken: varchar("share_token", { length: 64 }).unique(),
  shareData: jsonb("share_data"),
  shareViewCount: integer("share_view_count").default(0),
  shareLastViewedAt: timestamp("share_last_viewed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  archivedAt: timestamp("archived_at"),
  partnerOrgId: integer("partner_org_id"),
  vertical: text("vertical"),
  autoEnrollmentSuppressedAt: timestamp("auto_enrollment_suppressed_at"),
  autoEnrollmentSuppressedReason: text("auto_enrollment_suppressed_reason"),
  // ── VAS upsell suppression (Day-30 cross-sell) ────────────────────────────
  // Set by a rep from the portfolio page to prevent automatic VAS sequence
  // enrollment at the Day-30 milestone. Does NOT affect initial auto-enrollment.
  vasUpsellSuppressedAt: timestamp("vas_upsell_suppressed_at"),
  vasUpsellSuppressedReason: text("vas_upsell_suppressed_reason"),
  // ── Onboarding linkage ───────────────────────────────────────────────────
  // Set on onboarding pipeline deals to point back to the sales deal that
  // triggered the Closed Won → Onboarding auto-kickoff.
  salesDealId: integer("sales_deal_id").references((): AnyPgColumn => deals.id),
  // ── Google Ads attribution ────────────────────────────────────────────────
  attributionGclid: text("attribution_gclid"),
  attributionSource: text("attribution_source"),
  attributionMedium: text("attribution_medium"),
  attributionCampaign: text("attribution_campaign"),
  bookingAttributedAt: timestamp("booking_attributed_at"),
  conversionAttributedAt: timestamp("conversion_attributed_at"),
  ghlOpportunityId: text("ghl_opportunity_id"),
  // ── Post-enrichment automation ────────────────────────────────────────────
  // Set by the post-enrichment BullMQ worker when it first processes a lead
  // that received contact info from enrichment. Acts as an idempotency guard
  // so re-enrichments never double-enroll the contact.
  postEnrichmentAutomationAt: timestamp("post_enrichment_automation_at"),
  // Human-readable next action chip shown on the Kanban deal card.
  // Set by the post-enrichment worker (e.g. "Enrolled — restaurant lead, sequence started").
  nextAction: text("next_action"),
}, (table) => [
  index("deals_contact_id_idx").on(table.contactId),
  index("deals_pipeline_idx").on(table.pipeline),
  index("deals_stage_idx").on(table.stage),
  index("deals_pipeline_stage_idx").on(table.pipeline, table.stage),
  index("deals_created_at_idx").on(table.createdAt),
  index("deals_sales_deal_id_idx").on(table.salesDealId),
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

export const DOCUMENT_CATEGORIES = [
  "Application",
  "Voided Check",
  "Photo ID",
  "Bank Statement",
  "EIN Letter",
  "Signed Proposal",
  "Processing Statement",
  "Rate Review Statement",
  "KYC",
  "Other",
] as const;

export const DOCUMENT_STATUSES = ["pending", "approved", "rejected", "archived"] as const;
export type DocumentStatus = typeof DOCUMENT_STATUSES[number];

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id),
  dealId: integer("deal_id").references(() => deals.id),
  type: text("type").notNull(),
  category: text("category").default("Other"),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  uploadedBy: text("uploaded_by"),
  storageKey: text("storage_key"),
  accessScope: text("access_scope").default("internal"),
  status: text("status").default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("documents_contact_id_idx").on(table.contactId),
  index("documents_created_at_idx").on(table.createdAt),
]);

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  createdAt: true,
});

export const documentAccessLog = pgTable("document_access_log", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").references(() => documents.id).notNull(),
  userId: text("user_id").notNull(),
  ip: text("ip"),
  accessedAt: timestamp("accessed_at").defaultNow(),
}, (table) => [
  index("document_access_log_document_id_idx").on(table.documentId),
  index("document_access_log_accessed_at_idx").on(table.accessedAt),
]);

export const insertDocumentAccessLogSchema = createInsertSchema(documentAccessLog).omit({
  id: true,
  accessedAt: true,
});

export type DocumentAccessLog = typeof documentAccessLog.$inferSelect;
export type InsertDocumentAccessLog = z.infer<typeof insertDocumentAccessLogSchema>;

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
  ghlTaskId: text("ghl_task_id"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow(),
  source: text("source"),
  automationKey: text("automation_key"),
});

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
  source: true,
  automationKey: true,
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  entityKey: text("entity_key"),
  details: jsonb("details"),
  beforeState: jsonb("before_state"),
  afterState: jsonb("after_state"),
  actorType: text("actor_type").default("user"),
  actorId: text("actor_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("audit_logs_created_at_idx").on(table.createdAt),
  index("audit_logs_entity_type_entity_id_idx").on(table.entityType, table.entityId),
  index("audit_logs_entity_key_idx").on(table.entityKey),
  index("audit_logs_actor_type_idx").on(table.actorType),
  index("audit_logs_user_id_idx").on(table.userId),
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
  triggerConditions: jsonb("trigger_conditions"),
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

export const maEvents = pgTable("ma_events", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  eventType: text("event_type").notNull(),
  counterpartyName: text("counterparty_name"),
  counterpartyContactId: integer("counterparty_contact_id").references(() => contacts.id),
  eventDate: timestamp("event_date"),
  note: text("note"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("ma_events_entity_idx").on(table.entityType, table.entityId),
]);

export const insertMaEventSchema = createInsertSchema(maEvents).omit({
  id: true,
  createdAt: true,
});

export type MaEvent = typeof maEvents.$inferSelect;
export type InsertMaEvent = z.infer<typeof insertMaEventSchema>;

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
export type PublicTaskCreateInput = InsertTask;
export type PublicTaskUpdateInput = Partial<PublicTaskCreateInput>;
export type UpdateTaskRequest = PublicTaskUpdateInput;

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
  "inbound_message",
] as const;

export const INBOUND_CLASSIFICATIONS = [
  "booking_intent",
  "positive_reply",
  "objection",
  "unsubscribe",
  "interested",
  "callback",
  "support",
  "question",
  "neutral",
] as const;

export const INBOUND_CLASSIFICATION_LABELS: Record<string, string> = {
  booking_intent: "Booking Intent",
  positive_reply: "Positive Reply",
  objection: "Objection",
  unsubscribe: "Unsubscribe / Opt-Out",
  interested: "Interested",
  callback: "Callback Request",
  support: "Support Request",
  question: "Question",
  neutral: "Neutral",
};

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
  "Enriched",
  "Statement Received",
  "Review In Progress",
  "Call Booked",
  "Proposal Sent",
  "Negotiation / Follow-Up",
  "Verbal Commit",
  "Promise to Submit", // #513
  "Closed Won",
  "Closed Lost",
  "Nurture / Not Now",
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
  "Med Spa",
  "Dental",
  "Auto Repair",
  "Salon",
  "Gym",
  "Hotel",
  "Landscaping",
  "Construction",
  "Legal",
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
  fileHash: text("file_hash"),
  importType: text("import_type"),
  totalRecords: integer("total_records").default(0),
  enrichedRecords: integer("enriched_records").default(0),
  qualifiedRecords: integer("qualified_records").default(0),
  insertedRows: integer("inserted_rows").default(0),
  skippedWithinFile: integer("skipped_within_file").default(0),
  skippedExisting: integer("skipped_existing").default(0),
  conflictRows: integer("conflict_rows").default(0),
  actor: text("actor"),
  status: text("status").default("processing"),
  uploadedBy: text("uploaded_by"),
  // Archival fields — set when a list is soft-deleted (e.g. demo cleanup)
  archivedAt: timestamp("archived_at"),
  archivedReason: text("archived_reason"),
  // Staged import pipeline — tracks where in the readiness lifecycle this list sits
  // Values: uploaded | mapped | validated | scored | suppressed | ready
  readinessState: text("readiness_state").notNull().default("uploaded"),
  // Required lead source for compliance and attribution tracking
  leadSource: text("lead_source"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Replay protection: same (importType, fileHash) cannot produce two running/complete lists.
  uniqueIndex("prospect_lists_import_type_hash_uidx")
    .on(table.importType, table.fileHash)
    .where(sql`status IN ('running', 'complete')`),
  index("prospect_lists_archived_at_idx").on(table.archivedAt),
]);

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
  importExecutionId: integer("import_execution_id").references(() => prospectLists.id),
  sourceRowIndex: integer("source_row_index"),
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
  conversionClaimId: text("conversion_claim_id"),
  conversionClaimedAt: timestamp("conversion_claimed_at"),
  conversionClaimOwnerId: text("conversion_claim_owner_id"),
  conversionContactId: integer("conversion_contact_id").references(() => contacts.id),
  conversionLastError: text("conversion_last_error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("prospects_list_id_idx").on(table.listId),
  index("prospects_status_idx").on(table.status),
  index("prospects_created_at_idx").on(table.createdAt),
  // Provenance + retry protection: same (importExecutionId, sourceRowIndex) cannot be inserted twice.
  uniqueIndex("prospects_execution_row_uidx")
    .on(table.importExecutionId, table.sourceRowIndex)
    .where(sql`import_execution_id IS NOT NULL AND source_row_index IS NOT NULL`),
  // DB-level email uniqueness for new imports (import_execution_id IS NOT NULL).
  // Pre-existing rows have NULL import_execution_id so they are excluded.
  uniqueIndex("prospects_email_import_unique_idx")
    .on(table.email)
    .where(sql`email IS NOT NULL AND import_execution_id IS NOT NULL`),
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
  readinessThreshold: integer("readiness_threshold"),
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

// ---------------------------------------------------------------------------
// Campaign Previews — durable DB record of every audience preview run.
// The queue endpoint verifies a completed, unexpired, unconsumed, hash-matching
// preview before proceeding. Status lifecycle:
//   running → done | failed | interrupted (server restart)
// ---------------------------------------------------------------------------
export const campaignPreviews = pgTable("campaign_previews", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("running"),
  eligibleCount: integer("eligible_count"),
  totalInVerticals: integer("total_in_verticals"),
  blockedCount: integer("blocked_count"),
  blockReasons: jsonb("block_reasons").$type<Record<string, number>>().default({}),
  sampleContacts: jsonb("sample_contacts").$type<Array<{ id: number; name: string; email: string; vertical: string | null }>>().default([]),
  targetVerticals: text("target_verticals").array().default([]),
  targetingHash: text("targeting_hash").notNull(),
  requestedBy: text("requested_by"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  expiresAt: timestamp("expires_at"),
  consumedAt: timestamp("consumed_at"),
  readinessThreshold: integer("readiness_threshold"),
  readinessModelVersion: integer("readiness_model_version"),
  readinessBreakdown: jsonb("readiness_breakdown"),
});

export const insertCampaignPreviewSchema = createInsertSchema(campaignPreviews).omit({ id: true, createdAt: true });
export type CampaignPreview = typeof campaignPreviews.$inferSelect;
export type InsertCampaignPreview = z.infer<typeof insertCampaignPreviewSchema>;

// ---------------------------------------------------------------------------
// Contact Readiness Runs — tracks backfill execution state
// ---------------------------------------------------------------------------
export const contactReadinessRuns = pgTable("contact_readiness_runs", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull().unique(),
  modelVersion: integer("model_version").notNull(),
  status: text("status").notNull().default("idle"),
  totalEligible: integer("total_eligible"),
  processed: integer("processed").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  force: boolean("force").notNull().default(false),
  lastProcessedContactId: integer("last_processed_contact_id"),
  startedAt: timestamp("started_at").defaultNow(),
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  completedAt: timestamp("completed_at"),
  lastError: text("last_error"),
});

export type ContactReadinessRun = typeof contactReadinessRuns.$inferSelect;
export type InsertContactReadinessRun = typeof contactReadinessRuns.$inferInsert;

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
  sendingAt: timestamp("sending_at"),
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
  clickedAt: timestamp("clicked_at"),
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
  status: text("status").default("paused"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  sequenceFamily: text("sequence_family"),
  eligibleConsentTiers: text("eligible_consent_tiers").array(),
  channelsAllowed: text("channels_allowed").array(),
  offerRoutes: text("offer_routes").array(),
  lifecycleStagesAllowed: text("lifecycle_stages_allowed").array(),
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
  variantBSubject: text("variant_b_subject"),
  variantBBody: text("variant_b_body"),
  abTestConfig: jsonb("ab_test_config"),
  abTestResults: jsonb("ab_test_results"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSequenceStepSchema = createInsertSchema(sequenceSteps).omit({
  id: true,
  createdAt: true,
});

export type SequenceStep = typeof sequenceSteps.$inferSelect;
export type InsertSequenceStep = z.infer<typeof insertSequenceStepSchema>;

export interface AbTestConfig {
  splitRatio?: number;
  minSampleSize?: number;
  winnerCriteria?: "open_rate" | "click_rate" | "reply_rate";
}

export interface AbTestResults {
  variantASent: number;
  variantBSent: number;
  aOpens: number;
  bOpens: number;
  aClicks: number;
  bClicks: number;
  aReplies: number;
  bReplies: number;
  winnerSelected: string | null;
  winnerAt: string | null;
  startedAt: string | null;
  statisticallySignificant?: boolean;
}

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
  uniqueIndex("idx_sequence_enrollments_active_unique").on(table.contactId, table.sequenceId).where(sql`status IN ('active', 'paused')`),
  index("seq_enrollments_status_next_action_idx").on(table.status, table.nextActionAt).where(sql`status = 'active'`),
]);

export const insertSequenceEnrollmentSchema = createInsertSchema(sequenceEnrollments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SequenceEnrollment = typeof sequenceEnrollments.$inferSelect;
export type InsertSequenceEnrollment = z.infer<typeof insertSequenceEnrollmentSchema>;

// ── Canonical Communication Events (Wave A3) ─────────────────────────────────
// Single normalized record for every inbound and outbound communication across
// all channels. Additive: existing channel-specific tables are not removed.
export const communicationEvents = pgTable("communication_events", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  dealId: integer("deal_id").references(() => deals.id, { onDelete: "set null" }),
  direction: text("direction").notNull(), // 'inbound' | 'outbound'
  channel: text("channel").notNull(),     // 'email'|'sms'|'call'|'voicemail'|'chat'|'form'|'portal'|'rvm'
  provider: text("provider"),             // 'ghl'|'smtp'|'twilio'|'internal'|'manual'
  subject: text("subject"),
  body: text("body"),
  status: text("status").notNull().default("sent"),
  intentClassification: text("intent_classification"),
  intentConfidence: numeric("intent_confidence", { precision: 5, scale: 4 }),
  automationStopped: boolean("automation_stopped").notNull().default(false),
  automationStopReason: text("automation_stop_reason"),
  sentBy: text("sent_by").notNull().default("automation"),
  sequenceId: integer("sequence_id").references(() => followUpSequences.id, { onDelete: "set null" }),
  sequenceStepId: integer("sequence_step_id").references(() => sequenceSteps.id, { onDelete: "set null" }),
  externalMessageId: text("external_message_id"),
  ghlMessageId: text("ghl_message_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("comm_events_contact_id_created_at_idx").on(table.contactId, table.createdAt),
  index("comm_events_deal_id_created_at_idx").on(table.dealId, table.createdAt),
  index("comm_events_direction_channel_idx").on(table.direction, table.channel),
  index("comm_events_contact_id_direction_idx").on(table.contactId, table.direction),
  index("comm_events_status_idx").on(table.status),
]);

export const insertCommunicationEventSchema = createInsertSchema(communicationEvents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CommunicationEvent = typeof communicationEvents.$inferSelect;
export type InsertCommunicationEvent = z.infer<typeof insertCommunicationEventSchema>;

// ── GHL Shadow Log (Wave B1) ──────────────────────────────────────────────────
// Captures what GHL inbound sync WOULD have written to Liberty when
// GHL_CRM_SYNC_MODE='shadow'. Allows admins to review CRM drift before
// disabling write-back entirely. Does NOT affect outbound sends.
export const ghlShadowLog = pgTable("ghl_shadow_log", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  syncFunction: text("sync_function").notNull(),
  ghlId: text("ghl_id"),
  field: text("field"),
  currentValue: jsonb("current_value"),
  ghlValue: jsonb("ghl_value"),
  wouldHaveWritten: boolean("would_have_written").notNull().default(true),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("ghl_shadow_log_entity_type_entity_id_idx").on(table.entityType, table.entityId),
  index("ghl_shadow_log_sync_function_idx").on(table.syncFunction),
  index("ghl_shadow_log_created_at_idx").on(table.createdAt),
]);

export type GhlShadowLog = typeof ghlShadowLog.$inferSelect;

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
  // Provenance: links each entity batch back to a specific import execution
  importExecutionId: uuid("import_execution_id").references(() => importExecutions.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("sunbiz_entities_source_fn_unique").on(table.source, table.filingNumber).where(sql`source IS NOT NULL AND filing_number IS NOT NULL`),
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

export type UnderwritingNoteEntry = {
  note: string;
  author: string;
  authorId?: string | null;
  createdAt: string;
};

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
  underwritingNotesLog: jsonb("underwriting_notes_log").$type<UnderwritingNoteEntry[]>().default(sql`'[]'::jsonb`),
  approvedAt: timestamp("approved_at"),
  declinedAt: timestamp("declined_at"),
  declineReason: text("decline_reason"),
  submittedAt: timestamp("submitted_at"),
  completedAt: timestamp("completed_at"),
  draftTokenHash: text("draft_token_hash"),
  // ── Protected-data (AES-256-GCM) envelope metadata ──────────────────────
  // Non-reversible fingerprints (keyed HMAC) for equality/dedup lookups only.
  einFingerprint: text("ein_fingerprint"),
  ssnFingerprint: text("ssn_fingerprint"),
  bankAccountFingerprint: text("bank_account_fingerprint"),
  // Masked, display-safe representations (never plaintext).
  einMask: text("ein_mask"),
  ssnMask: text("ssn_mask"),
  bankAccountMask: text("bank_account_mask"),
  bankRoutingMask: text("bank_routing_mask"),
  // Ciphertext scheme version applied to the protected fields on this row.
  protectedDataVersion: integer("protected_data_version"),
  // Per-field/nested protected-data metadata (which fields encrypted, scheme, etc.).
  protectedDataMetadata: jsonb("protected_data_metadata").$type<Record<string, unknown>>(),
  // Optional expiry for time-boxed retention of protected data.
  protectedDataExpiresAt: timestamp("protected_data_expires_at"),
  // Idempotency key for at-most-once protected-data write/submit operations.
  // Scoped per-application (combined with id) to avoid global uniqueness conflicts.
  protectedDataIdempotencyKey: text("protected_data_idempotency_key"),
  // ── Draft lifecycle ──────────────────────────────────────────────────────
  draftTokenExpiresAt: timestamp("draft_token_expires_at"),
  draftTokenRevokedAt: timestamp("draft_token_revoked_at"),
  // ── Optimistic-concurrency state version ────────────────────────────────
  stateVersion: integer("state_version").notNull().default(0),
  // ── Finalize idempotency (processor-side) ───────────────────────────────
  finalizeIdempotencyKey: text("finalize_idempotency_key"),
  finalizeAck: jsonb("finalize_ack").$type<Record<string, unknown>>(),
  // ── eSign capability ────────────────────────────────────────────────────
  esignCapabilityHash: text("esign_capability_hash"),
  esignCapabilityExpiresAt: timestamp("esign_capability_expires_at"),
  esignCapabilityRevokedAt: timestamp("esign_capability_revoked_at"),
  esignSendState: text("esign_send_state").notNull().default("idle"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // UNIQUE partial fingerprint index for eligible finalized applications only.
  // Guarantees no two finalized applications share the same normalized EIN.
  // Legacy rows (fingerprint NULL) are excluded; they are never part of the dedup scope.
  uniqueIndex("merchant_applications_ein_fingerprint_unique_idx")
    .on(table.einFingerprint)
    .where(sql`ein_fingerprint IS NOT NULL AND status IN ('submitted', 'under_review', 'approved', 'declined', 'withdrawn')`),
  // Idempotency unique: scoped per-application (application_id + key).
  // The global uniqueIndex is removed; per-app uniqueness is enforced here.
  index("merchant_applications_protected_idempotency_idx")
    .on(table.id, table.protectedDataIdempotencyKey)
    .where(sql`protected_data_idempotency_key IS NOT NULL`),
  // eSign document index for fast lookups by external document ID.
  index("merchant_applications_esign_document_id_idx")
    .on(table.esignDocumentId)
    .where(sql`esign_document_id IS NOT NULL`),
]);

// ---------------------------------------------------------------------------
// Merchant Application Protected-Data Outbox
// Durable, at-least-once change log for protected-data envelope mutations.
// Consumed by downstream sync/audit; never stores plaintext — only envelope
// metadata, fingerprints, and masks.
// ---------------------------------------------------------------------------
export const merchantApplicationProtectedOutbox = pgTable("merchant_application_protected_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: integer("application_id").notNull().references(() => merchantApplications.id),
  eventType: text("event_type").notNull(), // encrypted | rotated | expired | purged
  protectedDataVersion: integer("protected_data_version"),
  // Envelope-only payload: fingerprints, masks, changed field list — NO plaintext.
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  // Idempotency guard so re-processing the same logical event is a no-op.
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull().default("pending"), // pending | processing | delivered | failed
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  availableAt: timestamp("available_at").defaultNow(),
  lockedAt: timestamp("locked_at"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("merchant_app_protected_outbox_idempotency_uidx").on(table.idempotencyKey),
  index("merchant_app_protected_outbox_dispatch_idx")
    .on(table.status, table.availableAt)
    .where(sql`status IN ('pending', 'failed')`),
  index("merchant_app_protected_outbox_application_idx").on(table.applicationId),
]);

export type MerchantApplicationProtectedOutbox = typeof merchantApplicationProtectedOutbox.$inferSelect;
export type InsertMerchantApplicationProtectedOutbox = typeof merchantApplicationProtectedOutbox.$inferInsert;

// ── Deal Boarding Outbox ────────────────────────────────────────────────────
// Durable outbox for processor_submit effects. Keyed per deal + idempotency
// key so replays are no-ops. No sensitive values in payload.
export const dealBoardingOutbox = pgTable("deal_boarding_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  applicationId: integer("application_id"),
  eventType: text("event_type").notNull().default("processor_submit"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  idempotencyKey: text("idempotency_key").notNull(),
  processorName: text("processor_name"),
  status: text("status").notNull().default("pending"), // pending | processing | delivered | failed | dead_letter
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  availableAt: timestamp("available_at").defaultNow(),
  lockedAt: timestamp("locked_at"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("deal_boarding_outbox_idempotency_uidx").on(table.idempotencyKey),
  index("deal_boarding_outbox_dispatch_idx")
    .on(table.status, table.availableAt)
    .where(sql`status IN ('pending', 'failed')`),
  index("deal_boarding_outbox_deal_idx").on(table.dealId),
]);

export type DealBoardingOutbox = typeof dealBoardingOutbox.$inferSelect;
export type InsertDealBoardingOutbox = typeof dealBoardingOutbox.$inferInsert;

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
  referralCode: text("referral_code").unique(),
  referralCredits: text("referral_credits").default("0"),
  referralCount: integer("referral_count").default(0),
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
  libertyCost: numeric("liberty_cost"),
  estimatedMonthlyGp: numeric("estimated_monthly_gp"),
  paybackMonths: numeric("payback_months"),
  approvalTier: text("approval_tier"),
  managerApproved: boolean("manager_approved").default(false),
  approvedAt: timestamp("approved_at"),
  approvedByUserId: varchar("approved_by_user_id"),
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

export const equipmentModels = pgTable("equipment_models", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").default("Terminal"),
  description: text("description"),
  msrp: real("msrp").default(0).notNull(),
  libertyCost: real("liberty_cost").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertEquipmentModelSchema = createInsertSchema(equipmentModels).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type EquipmentModel = typeof equipmentModels.$inferSelect;
export type InsertEquipmentModel = z.infer<typeof insertEquipmentModelSchema>;

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
  mid: text("mid"),
  assignedAt: timestamp("assigned_at").defaultNow(),
}, (table) => [
  index("agent_merchants_agent_id_idx").on(table.agentId),
  index("agent_merchants_mid_idx").on(table.mid),
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
  importId: integer("import_id").references(() => residualImports.id, { onDelete: "set null" }),
  dealId: integer("deal_id").references(() => deals.id),
  contactId: integer("contact_id").references(() => contacts.id),
  merchantMid: text("merchant_mid"),
  merchantName: text("merchant_name"),
  month: text("month").notNull(),
  volume: text("volume").default("0"),
  transactions: integer("transactions"),
  revenue: text("revenue").default("0"),
  cost: text("cost"),
  netRevenue: text("net_revenue").default("0"),
  agentId: integer("agent_id").references(() => agents.id),
  agentCommission: text("agent_commission").default("0"),
  partnerCommission: text("partner_commission").default("0"),
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

// ── Residual Import Reconciliation ────────────────────────────────────────────
export const residualImports = pgTable("residual_imports", {
  id: serial("id").primaryKey(),
  month: text("month").notNull(),
  fileName: text("file_name").notNull(),
  status: text("status").notNull().default("pending"),
  importedBy: text("imported_by"),
  totalRows: integer("total_rows").default(0),
  matchedRows: integer("matched_rows").default(0),
  unmatchedRows: integer("unmatched_rows").default(0),
  flaggedRows: integer("flagged_rows").default(0),
  totalGrossResidual: text("total_gross_residual").default("0"),
  totalNetResidual: text("total_net_residual").default("0"),
  totalVariance: text("total_variance").default("0"),
  varianceThresholdPct: real("variance_threshold_pct").default(5),
  varianceThresholdAmt: real("variance_threshold_amt").default(50),
  confirmedAt: timestamp("confirmed_at"),
  confirmedBy: text("confirmed_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertResidualImportSchema = createInsertSchema(residualImports).omit({
  id: true,
  createdAt: true,
});

export type ResidualImport = typeof residualImports.$inferSelect;
export type InsertResidualImport = z.infer<typeof insertResidualImportSchema>;

export const residualImportRows = pgTable("residual_import_rows", {
  id: serial("id").primaryKey(),
  importId: integer("import_id").notNull().references(() => residualImports.id, { onDelete: "cascade" }),
  mid: text("mid").notNull(),
  merchantName: text("merchant_name"),
  volume: text("volume").default("0"),
  grossResidual: text("gross_residual").default("0"),
  netResidual: text("net_residual").default("0"),
  expectedResidual: text("expected_residual").default("0"),
  variance: text("variance").default("0"),
  variancePct: text("variance_pct").default("0"),
  varianceStatus: text("variance_status").default("in_range"),
  isMatched: boolean("is_matched").default(false),
  matchedDealId: integer("matched_deal_id").references(() => deals.id),
  matchedProfileId: integer("matched_profile_id"),
  agentId: integer("agent_id").references(() => agents.id),
  agentName: text("agent_name"),
  transactions: integer("transactions"),
  processingCost: text("processing_cost"),
  rawData: jsonb("raw_data"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("residual_import_rows_import_id_idx").on(table.importId),
  index("residual_import_rows_mid_idx").on(table.mid),
]);

export const insertResidualImportRowSchema = createInsertSchema(residualImportRows).omit({
  id: true,
  createdAt: true,
});

export type ResidualImportRow = typeof residualImportRows.$inferSelect;
export type InsertResidualImportRow = z.infer<typeof insertResidualImportRowSchema>;

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

export const BOARDING_STATUSES = [
  "not_submitted",
  "submitted",
  "under_review",
  "approved",
  "declined",
  "more_info_needed",
] as const;

export const midDailyStats = pgTable("mid_daily_stats", {
  id: serial("id").primaryKey(),
  mid: text("mid").notNull(),
  dealId: integer("deal_id").references(() => deals.id),
  contactId: integer("contact_id").references(() => contacts.id),
  date: text("date").notNull(),
  volume: real("volume").default(0),
  txCount: integer("tx_count").default(0),
  avgTicket: real("avg_ticket").default(0),
  effectiveRate: real("effective_rate").default(0),
  chargebackCount: integer("chargeback_count").default(0),
  chargebackAmount: real("chargeback_amount").default(0),
  refundCount: integer("refund_count").default(0),
  fetchedAt: timestamp("fetched_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("mid_daily_stats_mid_idx").on(table.mid),
  index("mid_daily_stats_date_idx").on(table.date),
  index("mid_daily_stats_deal_id_idx").on(table.dealId),
  uniqueIndex("mid_daily_stats_mid_date_unique").on(table.mid, table.date),
]);

export const insertMidDailyStatSchema = createInsertSchema(midDailyStats).omit({
  id: true,
  createdAt: true,
});

export type MidDailyStat = typeof midDailyStats.$inferSelect;
export type InsertMidDailyStat = z.infer<typeof insertMidDailyStatSchema>;

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
  passwordResetToken: text("password_reset_token"),
  passwordResetExpiresAt: timestamp("password_reset_expires_at"),
  inviteToken: text("invite_token"),
  inviteTokenExpiresAt: timestamp("invite_token_expires_at"),
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
  // Enhanced partner tracking (added in migration 0087)
  referralOwner: text("referral_owner"),
  commissionStatus: text("commission_status").default("pending"),
  lastContactAt: timestamp("last_contact_at"),
  partnerCategory: text("partner_category").default("referral"),
  referredCount: integer("referred_count").default(0),
  pipelineValue: text("pipeline_value").default("0"),
  nextFollowupTaskId: integer("next_followup_task_id"),
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
  convertedAt: timestamp("converted_at"),
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
  "Sales Scripts",
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
  googleClickedAt: timestamp("google_clicked_at"),
  trustpilotClickedAt: timestamp("trustpilot_clicked_at"),
  npsResponseId: integer("nps_response_id"),
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

export const consentSubjects = pgTable("consent_subjects", {
  id: serial("id").primaryKey(),
  subjectType: text("subject_type").notNull(),
  subjectRecordId: integer("subject_record_id").notNull(),
  canonicalKey: text("canonical_key").notNull(),
  normalizedEmail: text("normalized_email"),
  normalizedPhone: text("normalized_phone"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("consent_subjects_type_record_uidx").on(table.subjectType, table.subjectRecordId),
  index("consent_subjects_email_idx").on(table.normalizedEmail),
  index("consent_subjects_phone_idx").on(table.normalizedPhone),
]);

export const consentSubjectChannelStates = pgTable("consent_subject_channel_states", {
  id: serial("id").primaryKey(),
  subjectId: integer("subject_id").notNull().references(() => consentSubjects.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  purpose: text("purpose").notNull(),
  permissionState: text("permission_state").notNull().default("unknown"),
  restrictionReason: text("restriction_reason"),
  sourceEventId: integer("source_event_id"),
  effectiveAt: timestamp("effective_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  evidence: jsonb("evidence"),
}, (table) => [
  uniqueIndex("consent_subject_channel_purpose_uidx").on(table.subjectId, table.channel, table.purpose),
  index("consent_subject_channel_state_subject_idx").on(table.subjectId),
]);

export const consentSubjectGlobalSuppressions = pgTable("consent_subject_global_suppressions", {
  subjectId: integer("subject_id").primaryKey().references(() => consentSubjects.id, { onDelete: "cascade" }),
  isSuppressed: boolean("is_suppressed").notNull().default(false),
  restrictionReason: text("restriction_reason"),
  sourceEventId: integer("source_event_id"),
  effectiveAt: timestamp("effective_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const consentSubjectReachability = pgTable("consent_subject_reachability", {
  id: serial("id").primaryKey(),
  subjectId: integer("subject_id").notNull().references(() => consentSubjects.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  reachabilityState: text("reachability_state").notNull(),
  sourceEventId: integer("source_event_id"),
  observedAt: timestamp("observed_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  details: jsonb("details"),
}, (table) => [
  uniqueIndex("consent_subject_reachability_uidx").on(table.subjectId, table.channel),
]);

export const consentAuditLogs = pgTable("consent_audit_logs", {
  id: serial("id").primaryKey(),
  // Legacy rows may not resolve to a canonical subject. Only canonical_fact
  // rows are consumed by the reducer; legacy_trace rows remain historical.
  subjectId: integer("subject_id").references(() => consentSubjects.id),
  contactId: integer("contact_id").references(() => contacts.id),
  userId: text("user_id"),
  channel: text("channel").notNull(),
  action: text("action").notNull(),
  consented: boolean("consented").notNull(),
  consentType: text("consent_type").default("general_optin"),
  source: text("source"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  details: jsonb("details"),
  disclosureVersion: text("disclosure_version"),
  disclosureText: text("disclosure_text"),
  formId: text("form_id"),
  consentedPhone: text("consented_phone"),
  recordKind: text("record_kind").notNull().default("legacy_trace"),
  schemaVersion: integer("schema_version").notNull().default(1),
  eventNamespace: text("event_namespace"),
  eventKey: text("event_key"),
  purpose: text("purpose"),
  receiptAt: timestamp("receipt_at"),
  effectiveAt: timestamp("effective_at"),
  evidence: jsonb("evidence"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("consent_audit_canonical_event_uidx")
    .on(table.eventNamespace, table.eventKey)
    .where(sql`record_kind = 'canonical_fact' AND event_namespace IS NOT NULL AND event_key IS NOT NULL`),
  uniqueIndex("consent_audit_reachability_event_uidx")
    .on(table.eventNamespace, table.eventKey)
    .where(sql`record_kind = 'reachability_fact' AND event_namespace IS NOT NULL AND event_key IS NOT NULL`),
  index("consent_audit_subject_idx").on(table.subjectId, table.createdAt),
]);

export const insertConsentAuditLogSchema = createInsertSchema(consentAuditLogs).omit({
  id: true,
  createdAt: true,
});

export type ConsentAuditLog = typeof consentAuditLogs.$inferSelect;
export type InsertConsentAuditLog = z.infer<typeof insertConsentAuditLogSchema>;

// Task #695 — Voice/SMS/Ringless Go-Live Audit (Approval Gate, not activation).
// Append-only audit trail for channel approval-gate actions. This table is
// never used to enable/disable a channel — SMS_ENABLED, VOICE_AI_ENABLED, and
// RINGLESS_VM_ENABLED remain Replit Secrets requiring manual operator action.
// Canonical channel keys: "sms" | "voice_ai" | "ringless_vm" — never "voice",
// "ringless", or bare "call".
export const channelAuditLog = pgTable("channel_audit_log", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull(),
  action: text("action").notNull(), // checklist_viewed | enable_approved | disabled_recorded | test_batch_preview
  checklistSnapshot: jsonb("checklist_snapshot"),
  actorUserId: text("actor_user_id"),
  actorEmail: text("actor_email"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertChannelAuditLogSchema = createInsertSchema(channelAuditLog).omit({
  id: true,
  createdAt: true,
});

export type ChannelAuditLog = typeof channelAuditLog.$inferSelect;
export type InsertChannelAuditLog = z.infer<typeof insertChannelAuditLogSchema>;

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
  "channel_approved",
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
  updatedRecords: integer("updated_records").default(0),
  invalidRows: integer("invalid_rows").default(0),
  skippedRows: integer("skipped_rows").default(0),
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
  processedRows: integer("processed_rows"),
  lastProgressAt: timestamp("last_progress_at"),
  staleReason: text("stale_reason"),
  optOutPreserved: integer("opt_out_preserved").default(0),
  optOutApplied: integer("opt_out_applied").default(0),
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
  authorId: integer("author_id"),
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
  pillar: text("pillar"),
  cluster: text("cluster"),
  seoTitle: text("seo_title"),
  ogImage: text("og_image"),
  internalLinks: jsonb("internal_links"),
  reviewerNotes: text("reviewer_notes"),
});

export const insertGeneratedBlogPostSchema = createInsertSchema(generatedBlogPosts).omit({
  id: true,
  createdAt: true,
});

export type GeneratedBlogPost = typeof generatedBlogPosts.$inferSelect;
export type InsertGeneratedBlogPost = z.infer<typeof insertGeneratedBlogPostSchema>;

export const contentAuthors = pgTable("content_authors", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  title: text("title").notNull(),
  bio: text("bio").notNull(),
  longBio: text("long_bio"),
  avatarUrl: text("avatar_url"),
  linkedinUrl: text("linkedin_url"),
  twitterUrl: text("twitter_url"),
  websiteUrl: text("website_url"),
  expertise: text("expertise").array(),
  email: text("email"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertContentAuthorSchema = createInsertSchema(contentAuthors).omit({ id: true, createdAt: true });
export type ContentAuthor = typeof contentAuthors.$inferSelect;
export type InsertContentAuthor = z.infer<typeof insertContentAuthorSchema>;

export const socialPosts = pgTable("social_posts", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull().default("linkedin"),
  body: text("body").notNull(),
  hashtags: text("hashtags").array(),
  linkUrl: text("link_url"),
  imageUrl: text("image_url"),
  authorId: integer("author_id"),
  authorName: text("author_name"),
  status: text("status").notNull().default("draft"),
  scheduledAt: timestamp("scheduled_at"),
  publishedAt: timestamp("published_at"),
  externalPostId: text("external_post_id"),
  externalPostUrl: text("external_post_url"),
  pillar: text("pillar"),
  cluster: text("cluster"),
  reviewerNotes: text("reviewer_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: integer("created_by"),
});

export const insertSocialPostSchema = createInsertSchema(socialPosts).omit({ id: true, createdAt: true });
export type SocialPost = typeof socialPosts.$inferSelect;
export type InsertSocialPost = z.infer<typeof insertSocialPostSchema>;

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
  ownerFirstName: text("owner_first_name"),
  ownerLastName: text("owner_last_name"),
  formationDate: date("formation_date"),
  yearsInBusiness: integer("years_in_business"),
  registrySource: text("registry_source"),
  licenseNumber: text("license_number"),
  bbbAccredited: boolean("bbb_accredited").default(false),
  sourceCount: integer("source_count").default(1),
  sourcedVia: text("sourced_via"),
  ownerEnrichmentStatus: text("owner_enrichment_status").default("pending"),
  // Vertical provenance — separate fields for coarse vertical and fine subvertical.
  // verticalSource/verticalConfidence describe the coarse `vertical` field.
  // subverticalSource/subverticalConfidence describe the `subvertical` field.
  // Resolver (991B-1) must always write coarse + fine together.
  // manualVerticalOverride: NULL=unknown, false=evaluated/not-overridden, true=confirmed operator override.
  verticalSource: text("vertical_source"),
  verticalConfidence: integer("vertical_confidence"),
  subverticalSource: text("subvertical_source"),
  subverticalConfidence: integer("subvertical_confidence"),
  manualVerticalOverride: boolean("manual_vertical_override"),
  // ── Serper zero-yield cooldown state (#1599, migration 0141) ─────────────
  // Written ONLY by serper-enrichment outcome recording + admin manual requeue.
  // Provider/control failures never touch attempts or next_eligible_at.
  lastSerperCheckedAt: timestamp("last_serper_checked_at", { withTimezone: true }),
  serperNoResultAttempts: integer("serper_no_result_attempts").notNull().default(0),
  serperNextEligibleAt: timestamp("serper_next_eligible_at", { withTimezone: true }),
  serperLastOutcome: text("serper_last_outcome"),
  serperLastReasonCode: text("serper_last_reason_code"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("sdr_merchants_ghl_contact_id_idx").on(table.ghlContactId),
  index("sdr_merchants_serper_eligibility_idx").on(table.serperNextEligibleAt, table.doNotContactFlag),
  check("sdr_merchants_vertical_confidence_range", sql`vertical_confidence IS NULL OR (vertical_confidence BETWEEN 0 AND 100)`),
  check("sdr_merchants_subvertical_confidence_range", sql`subvertical_confidence IS NULL OR (subvertical_confidence BETWEEN 0 AND 100)`),
]);

export const insertSdrMerchantSchema = createInsertSchema(sdrMerchants).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  // Vertical provenance — server-assigned; clients cannot forge vertical authority.
  verticalSource: true,
  verticalConfidence: true,
  subverticalSource: true,
  subverticalConfidence: true,
  manualVerticalOverride: true,
});

export type SdrMerchant = typeof sdrMerchants.$inferSelect;
export type InsertSdrMerchant = z.infer<typeof insertSdrMerchantSchema>;

export const registryImportLog = pgTable("registry_import_log", {
  id: serial("id").primaryKey(),
  importId: text("import_id").notNull(),
  source: text("source").notNull(),
  state: text("state").notNull(),
  rawRow: jsonb("raw_row").notNull(),
  matchedMerchantId: integer("matched_merchant_id").references(() => sdrMerchants.id),
  status: text("status").notNull().default("unmatched"),
  matchConfidence: integer("match_confidence"),
  matchBasis: jsonb("match_basis"),
  contradictions: jsonb("contradictions"),
  runnerUpMerchantId: integer("runner_up_merchant_id").references(() => sdrMerchants.id),
  runnerUpConfidence: integer("runner_up_confidence"),
  matchAlgorithmVersion: text("match_algorithm_version"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("registry_import_log_import_id_idx").on(table.importId),
  index("registry_import_log_status_idx").on(table.status),
]);

export const insertRegistryImportLogSchema = createInsertSchema(registryImportLog).omit({
  id: true,
  createdAt: true,
});

export type RegistryImportLog = typeof registryImportLog.$inferSelect;
export type InsertRegistryImportLog = z.infer<typeof insertRegistryImportLogSchema>;

export const sdrMerchantContacts = pgTable("sdr_merchant_contacts", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").references(() => sdrMerchants.id),
  contactName: text("contact_name"),
  title: text("title"),
  email: text("email"),
  mobile: text("mobile"),
  directPhone: text("direct_phone"),
  roleGuess: text("role_guess"),
  emailConfidence: integer("email_confidence").default(0),
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
  // Unknown is fail-closed. An address or import source is never affirmative evidence.
  consentEmail: boolean("consent_email").default(false),
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
  // Vertical provenance — resolved projection from authority tables (contacts/sdrMerchants).
  // Lead state does NOT own override authority; it reflects what the resolver decided.
  // verticalResolutionReason explains which source won and why.
  verticalSource: text("vertical_source"),
  verticalConfidence: integer("vertical_confidence"),
  verticalResolutionReason: text("vertical_resolution_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("sdr_lead_state_stage_idx").on(table.stage),
  index("sdr_lead_state_priority_bucket_idx").on(table.priorityBucket),
  index("sdr_lead_state_merchant_id_idx").on(table.merchantId),
  index("sdr_lead_state_contact_id_idx").on(table.contactId),
  index("sdr_lead_state_next_action_at_idx").on(table.nextActionAt),
  index("sdr_lead_state_stage_updated_at_idx").on(table.stage, table.updatedAt),
  index("sdr_lead_state_current_stage_updated_at_idx").on(table.currentStage, table.updatedAt),
  check("sdr_lead_state_vertical_confidence_range", sql`vertical_confidence IS NULL OR (vertical_confidence BETWEEN 0 AND 100)`),
]);

export const insertSdrLeadStateSchema = createInsertSchema(sdrLeadState).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  // Vertical provenance — server-assigned; clients cannot forge vertical resolution.
  verticalSource: true,
  verticalConfidence: true,
  verticalResolutionReason: true,
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
}, (table) => [
  index("sdr_lead_events_event_type_created_at_idx").on(table.eventType, table.createdAt),
  index("sdr_lead_events_created_at_idx").on(table.createdAt),
]);

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

export type ProcessorEvidence = {
  vendor: string | null;
  confidence: number | null;
  source: "processorSignals" | "enrichmentData" | "none";
  detectedAt: string | null;
};

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

export const syncConflicts = pgTable("sync_conflicts", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id).notNull(),
  fieldName: text("field_name").notNull(),
  internalValue: text("internal_value"),
  ghlValue: text("ghl_value"),
  internalUpdatedAt: timestamp("internal_updated_at"),
  ghlUpdatedAt: timestamp("ghl_updated_at"),
  resolution: text("resolution").default("pending").notNull(),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("sync_conflicts_contact_id_idx").on(table.contactId),
  index("sync_conflicts_resolution_idx").on(table.resolution),
  index("sync_conflicts_created_at_idx").on(table.createdAt),
]);

export const insertSyncConflictSchema = createInsertSchema(syncConflicts).omit({
  id: true,
  createdAt: true,
});

export type SyncConflict = typeof syncConflicts.$inferSelect;
export type InsertSyncConflict = z.infer<typeof insertSyncConflictSchema>;

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

export const chargebacks = pgTable("chargebacks", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id),
  dealId: integer("deal_id").references(() => deals.id),
  transactionDate: timestamp("transaction_date").notNull(),
  amount: real("amount").notNull(),
  cardBrand: text("card_brand").notNull(),
  reasonCode: text("reason_code").notNull(),
  reasonDescription: text("reason_description"),
  status: text("status").notNull().default("New"),
  responseDeadline: timestamp("response_deadline"),
  evidenceFiles: jsonb("evidence_files").$type<{ name: string; url?: string; storageKey?: string; mimeType?: string; fileSize?: number; uploadedAt: string }[]>().default([]),
  respondedAt: timestamp("responded_at"),
  outcome: text("outcome"),
  notes: text("notes"),
  aiEvidencePacket: jsonb("ai_evidence_packet").$type<{
    rebuttalletter: string;
    evidenceChecklist: { item: string; status: "included" | "missing" | "partial"; notes?: string }[];
    winLikelihood: { estimate: string; rationale: string };
    reasonCodeContext: string;
    generatedAt: string;
    finalizedAt?: string;
    editedRebuttal?: string;
    merchantProfile?: {
      merchantName: string;
      address?: string;
      city?: string;
      state?: string;
      website?: string;
      vertical?: string;
      mid?: string;
    };
    auditTrail?: {
      systemPrompt: string;
      userPrompt: string;
      rawModelOutput: string;
      model: string;
      promptTokens?: number;
      completionTokens?: number;
      generatedByUserId?: string;
      generatedByRole?: string;
    };
    finalizationTrail?: {
      finalizedByUserId?: string;
      finalizedByRole?: string;
      hadEdits: boolean;
      finalizedAt: string;
    };
  } | null>().default(null),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("chargebacks_contact_id_idx").on(table.contactId),
  index("chargebacks_deal_id_idx").on(table.dealId),
  index("chargebacks_status_idx").on(table.status),
  index("chargebacks_response_deadline_idx").on(table.responseDeadline),
  index("chargebacks_created_at_idx").on(table.createdAt),
]);

export const insertChargebackSchema = createInsertSchema(chargebacks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  aiEvidencePacket: z.custom<NonNullable<typeof chargebacks.$inferInsert.aiEvidencePacket>>().nullable().optional(),
});

export type Chargeback = typeof chargebacks.$inferSelect;
export type InsertChargeback = z.infer<typeof insertChargebackSchema>;
export type UpdateChargebackRequest = Partial<InsertChargeback>;

export const CHARGEBACK_STATUSES = ["New", "Under Review", "Responded", "Won", "Lost"] as const;
export const CHARGEBACK_CARD_BRANDS = ["Visa", "Mastercard", "Amex", "Discover"] as const;

export const CHARGEBACK_DEADLINE_DAYS: Record<string, number> = {
  Visa: 30,
  Mastercard: 45,
  Amex: 20,
  Discover: 30,
};

export const GHL_PIPELINE_STAGE_MAP: Record<string, string> = {
  "New Lead": "new_lead",
  "Statement Received": "statement_received",
  "Review In Progress": "review_in_progress",
  "Call Booked": "call_booked",
  "Proposal Sent": "proposal_sent",
  "Negotiation / Follow-Up": "negotiation",
  "Verbal Commit": "verbal_commit",
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
  "Verbal Commit",
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

// ── Live Chat ─────────────────────────────────────────────────────────────────
export const liveChats = pgTable("live_chats", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  visitorName: text("visitor_name"),
  visitorEmail: text("visitor_email"),
  pageUrl: text("page_url"),
  status: text("status").notNull().default("active"), // active | closed | offline_captured
  contactId: integer("contact_id").references(() => contacts.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
  closedAt: timestamp("closed_at"),
}, (table) => [
  index("live_chats_session_id_idx").on(table.sessionId),
  index("live_chats_status_idx").on(table.status),
]);

export const liveChatMessages = pgTable("live_chat_messages", {
  id: serial("id").primaryKey(),
  chatId: integer("chat_id").notNull().references(() => liveChats.id, { onDelete: "cascade" }),
  senderType: text("sender_type").notNull(), // visitor | agent
  senderName: text("sender_name"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("live_chat_messages_chat_id_idx").on(table.chatId),
]);

export const insertLiveChatSchema = createInsertSchema(liveChats).omit({
  id: true,
  createdAt: true,
  lastMessageAt: true,
  closedAt: true,
});

export const insertLiveChatMessageSchema = createInsertSchema(liveChatMessages).omit({
  id: true,
  createdAt: true,
});

export type LiveChat = typeof liveChats.$inferSelect;
export type InsertLiveChat = z.infer<typeof insertLiveChatSchema>;
export type LiveChatMessage = typeof liveChatMessages.$inferSelect;
export type InsertLiveChatMessage = z.infer<typeof insertLiveChatMessageSchema>;

// ── NPS Responses ─────────────────────────────────────────────────────────────
export const npsResponses = pgTable("nps_responses", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  contactId: integer("contact_id").references(() => contacts.id),
  dealId: integer("deal_id").references(() => deals.id),
  merchantProfileId: integer("merchant_profile_id").references(() => merchantProfiles.id),
  dayTrigger: integer("day_trigger").notNull(),
  score: integer("score"),
  comment: text("comment"),
  submittedAt: timestamp("submitted_at"),
  emailSentAt: timestamp("email_sent_at"),
  sendAttemptedAt: timestamp("send_attempted_at"),
  reviewRequestQueued: boolean("review_request_queued").default(false),
  healthAlertCreated: boolean("health_alert_created").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("nps_responses_token_idx").on(table.token),
  index("nps_responses_contact_id_idx").on(table.contactId),
]);

export const insertNpsResponseSchema = createInsertSchema(npsResponses).omit({
  id: true,
  createdAt: true,
});

export type NpsResponse = typeof npsResponses.$inferSelect;
export type InsertNpsResponse = z.infer<typeof insertNpsResponseSchema>;

// ── Merchant Referrals ────────────────────────────────────────────────────────
export const merchantReferrals = pgTable("merchant_referrals", {
  id: serial("id").primaryKey(),
  referrerProfileId: integer("referrer_profile_id").references(() => merchantProfiles.id),
  referredEmail: text("referred_email").notNull(),
  referredName: text("referred_name"),
  referredCompany: text("referred_company"),
  referralCode: text("referral_code").notNull(),
  status: text("status").default("pending"),
  creditAmount: text("credit_amount").default("0"),
  creditPaidAt: timestamp("credit_paid_at"),
  referredContactId: integer("referred_contact_id").references(() => contacts.id),
  referredDealId: integer("referred_deal_id").references(() => deals.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("merchant_referrals_referrer_idx").on(table.referrerProfileId),
  index("merchant_referrals_code_idx").on(table.referralCode),
]);

export const insertMerchantReferralSchema = createInsertSchema(merchantReferrals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type MerchantReferral = typeof merchantReferrals.$inferSelect;
export type InsertMerchantReferral = z.infer<typeof insertMerchantReferralSchema>;

export const MERCHANT_REFERRAL_STATUSES = [
  "pending",
  "signed_up",
  "activated",
  "credited",
  "expired",
] as const;

// ── AI Roleplay Sessions ──────────────────────────────────────────────────────
export const roleplaySessions = pgTable("roleplay_sessions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id),
  scenario: text("scenario").notNull(),
  persona: text("persona").notNull(),
  difficulty: text("difficulty").default("standard"),
  status: text("status").default("active"),
  totalExchanges: integer("total_exchanges").default(0),
  overallScore: integer("overall_score"),
  coachingSummary: text("coaching_summary"),
  strengths: text("strengths").array(),
  gaps: text("gaps").array(),
  suggestedPhrasing: text("suggested_phrasing").array(),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertRoleplaySessionSchema = createInsertSchema(roleplaySessions).omit({
  id: true,
  createdAt: true,
});

export type RoleplaySession = typeof roleplaySessions.$inferSelect;
export type InsertRoleplaySession = z.infer<typeof insertRoleplaySessionSchema>;

export const roleplayExchanges = pgTable("roleplay_exchanges", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => roleplaySessions.id),
  repMessage: text("rep_message").notNull(),
  merchantReply: text("merchant_reply").notNull(),
  toneScore: integer("tone_score"),
  clarityScore: integer("clarity_score"),
  objectionAddressed: boolean("objection_addressed"),
  feedback: text("feedback"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("roleplay_exchanges_session_id_idx").on(table.sessionId),
]);

export const insertRoleplayExchangeSchema = createInsertSchema(roleplayExchanges).omit({
  id: true,
  createdAt: true,
});

export type RoleplayExchange = typeof roleplayExchanges.$inferSelect;
export type InsertRoleplayExchange = z.infer<typeof insertRoleplayExchangeSchema>;

// ── Leaderboard Settings ──────────────────────────────────────────────────────
export const leaderboardSettings = pgTable("leaderboard_settings", {
  id: serial("id").primaryKey(),
  showDeals: boolean("show_deals").default(true),
  showRevenue: boolean("show_revenue").default(true),
  showProposals: boolean("show_proposals").default(true),
  showCallsMade: boolean("show_calls_made").default(true),
  showResponseRate: boolean("show_response_rate").default(false),
  visibleToAgents: boolean("visible_to_agents").default(true),
  monthlyDealGoal: integer("monthly_deal_goal").default(10),
  monthlyRevenueGoal: text("monthly_revenue_goal").default("50000"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type LeaderboardSettings = typeof leaderboardSettings.$inferSelect;

// ── Retention Campaign Configs ────────────────────────────────────────────────
export const retentionCampaignConfigs = pgTable("retention_campaign_configs", {
  id: serial("id").primaryKey(),
  alertType: text("alert_type").notNull(),
  campaignName: text("campaign_name").notNull(),
  enabled: boolean("enabled").default(true),
  suggestedMessage: text("suggested_message"),
  taskPriority: text("task_priority").default("high"),
  taskDueDays: integer("task_due_days").default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertRetentionCampaignConfigSchema = createInsertSchema(retentionCampaignConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type RetentionCampaignConfig = typeof retentionCampaignConfigs.$inferSelect;
export type InsertRetentionCampaignConfig = z.infer<typeof insertRetentionCampaignConfigSchema>;

// ── Virtual Terminal Transactions ─────────────────────────────────────────────
export const virtualTerminalTransactions = pgTable("virtual_terminal_transactions", {
  id: serial("id").primaryKey(),
  gatewayTransactionId: text("gateway_transaction_id"),
  authCode: text("auth_code"),
  status: text("status").notNull().default("pending"),
  amount: text("amount").notNull(),
  refundedAmount: text("refunded_amount").default("0"),
  cardType: text("card_type"),
  lastFour: text("last_four"),
  cardholderName: text("cardholder_name"),
  billingZip: text("billing_zip"),
  memo: text("memo"),
  responseCode: text("response_code"),
  responseText: text("response_text"),
  processedBy: text("processed_by"),
  refundedBy: text("refunded_by"),
  refundedAt: timestamp("refunded_at"),
  rawResponse: jsonb("raw_response"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("vt_transactions_status_idx").on(table.status),
  index("vt_transactions_created_at_idx").on(table.createdAt),
  index("vt_transactions_processed_by_idx").on(table.processedBy),
]);

export const insertVirtualTerminalTransactionSchema = createInsertSchema(virtualTerminalTransactions).omit({
  id: true,
  createdAt: true,
});

export type VirtualTerminalTransaction = typeof virtualTerminalTransactions.$inferSelect;
export type InsertVirtualTerminalTransaction = z.infer<typeof insertVirtualTerminalTransactionSchema>;

// ── Sub-ISO White-Label Partner Organizations ─────────────────────────────────
export const partnerOrganizations = pgTable("partner_organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color").default("#2563eb"),
  tagline: text("tagline"),
  commissionRate: real("commission_rate").default(10),
  status: text("status").default("active"),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("partner_orgs_slug_idx").on(table.slug),
]);

export const insertPartnerOrgSchema = createInsertSchema(partnerOrganizations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type PartnerOrganization = typeof partnerOrganizations.$inferSelect;
export type InsertPartnerOrganization = z.infer<typeof insertPartnerOrgSchema>;

// ── Co-Branded Proposals ───────────────────────────────────────────────────────
export const coBrandedProposals = pgTable("co_branded_proposals", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").references(() => deals.id),
  contactId: integer("contact_id").references(() => contacts.id),
  partnerOrgId: integer("partner_org_id").references(() => partnerOrganizations.id),
  token: text("token").notNull().unique(),
  status: text("status").default("draft"),
  pricingPlan: text("pricing_plan"),
  proposalData: jsonb("proposal_data"),
  merchantName: text("merchant_name"),
  merchantMonthlyVolume: text("merchant_monthly_volume"),
  merchantEffectiveRate: text("merchant_effective_rate"),
  merchantEmail: text("merchant_email"),
  customMessage: text("custom_message"),
  deliveredAt: timestamp("delivered_at"),
  viewedAt: timestamp("viewed_at"),
  viewCount: integer("view_count").default(0),
  acceptedAt: timestamp("accepted_at"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("co_branded_proposals_partner_org_id_idx").on(table.partnerOrgId),
  index("co_branded_proposals_deal_id_idx").on(table.dealId),
  index("co_branded_proposals_token_idx").on(table.token),
]);

export const insertCoBrandedProposalSchema = createInsertSchema(coBrandedProposals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CoBrandedProposal = typeof coBrandedProposals.$inferSelect;
export type InsertCoBrandedProposal = z.infer<typeof insertCoBrandedProposalSchema>;

export const partnerOrgUsers = pgTable("partner_org_users", {
  id: serial("id").primaryKey(),
  partnerOrgId: integer("partner_org_id").references(() => partnerOrganizations.id).notNull(),
  email: text("email").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").default(""),
  passwordHash: text("password_hash"),
  role: text("role").default("member"),
  status: text("status").default("active"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("partner_org_users_email_org_idx").on(table.email, table.partnerOrgId),
]);

export const insertPartnerOrgUserSchema = createInsertSchema(partnerOrgUsers).omit({
  id: true,
  createdAt: true,
});

export type PartnerOrgUser = typeof partnerOrgUsers.$inferSelect;
export type InsertPartnerOrgUser = z.infer<typeof insertPartnerOrgUserSchema>;

export const TESTIMONIAL_SUBMISSION_STATUSES = ["pending", "approved", "rejected"] as const;

export const testimonialSubmissions = pgTable("testimonial_submissions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  businessName: text("business_name"),
  email: text("email").notNull(),
  phone: text("phone"),
  industry: text("industry"),
  videoLink: text("video_link"),
  savingsAmount: text("savings_amount"),
  story: text("story").notNull(),
  status: text("status").default("pending").notNull(),
  publish: boolean("publish").default(false).notNull(),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  contactId: integer("contact_id").references(() => contacts.id),
  dealId: integer("deal_id").references(() => deals.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("testimonial_submissions_status_idx").on(table.status),
  index("testimonial_submissions_created_at_idx").on(table.createdAt),
]);

export const insertTestimonialSubmissionSchema = createInsertSchema(testimonialSubmissions).omit({
  id: true,
  createdAt: true,
  reviewedAt: true,
});

export type TestimonialSubmission = typeof testimonialSubmissions.$inferSelect;
export type InsertTestimonialSubmission = z.infer<typeof insertTestimonialSubmissionSchema>;

// ── Background Job Orchestration Ledger ──────────────────────────────────────
export const backgroundJobs = pgTable("background_jobs", {
  id: serial("id").primaryKey(),
  jobName: text("job_name").notNull().unique(),
  status: text("status").notNull().default("idle"),
  lastStartedAt: timestamp("last_started_at"),
  lastFinishedAt: timestamp("last_finished_at"),
  lastError: text("last_error"),
  runCount: integer("run_count").notNull().default(0),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
  /** Fencing token set on each acquireJobLock(); releaseJobLock() validates it. */
  lockToken: text("lock_token"),
}, (table) => [
  index("background_jobs_job_name_idx").on(table.jobName),
  index("background_jobs_status_idx").on(table.status),
]);

export const insertBackgroundJobSchema = createInsertSchema(backgroundJobs).omit({
  id: true,
  updatedAt: true,
});

export type BackgroundJob = typeof backgroundJobs.$inferSelect;
export type InsertBackgroundJob = z.infer<typeof insertBackgroundJobSchema>;

export const AI_TRIGGER_TYPES = [
  "enrichment",
  "proposal",
  "reply",
  "reply-classify",
  "advisor",
  "advisor-chat",
  "blueprint",
  "outbound-copy",
  "statement-analysis",
  "ticket-classification",
  "ticket-classify",
  "website-quality",
  "insights",
  "email-compose",
  "compose-email",
  "nightly-discovery",
  "content-generation",
  "social-generation",
  "training-generation",
  "auto-reply",
  "chargeback-copilot",
  "credential_error",
  // System / infrastructure triggers
  "executive-briefing",
  "executive-coaching",
  "offer-routing",
  "sales-prep",
  "sequence-analysis",
  "system-health",
  "ghl-reply",
  "knowledge-embedding",
] as const;

export type AiTriggerType = typeof AI_TRIGGER_TYPES[number];

export const aiAuditLogs = pgTable("ai_audit_logs", {
  id: serial("id").primaryKey(),
  triggerType: text("trigger_type").notNull(),
  actorType: text("actor_type").notNull().default("system"),
  actorId: text("actor_id"),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens").default(0),
  completionTokens: integer("completion_tokens").default(0),
  costCents: real("cost_cents").default(0),
  responseSummary: text("response_summary"),
  error: text("error"),
  durationMs: integer("duration_ms"),
  promptHash: text("prompt_hash"),
  confidenceScore: real("confidence_score"),
  flagged: boolean("flagged").default(false),
  rawPrompt: text("raw_prompt"),
  rawResponse: text("raw_response"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("ai_audit_logs_trigger_type_idx").on(table.triggerType),
  index("ai_audit_logs_created_at_idx").on(table.createdAt),
  index("ai_audit_logs_flagged_idx").on(table.flagged),
]);

export const insertAiAuditLogSchema = createInsertSchema(aiAuditLogs).omit({
  id: true,
  createdAt: true,
});

export type AiAuditLog = typeof aiAuditLogs.$inferSelect;
export type InsertAiAuditLog = z.infer<typeof insertAiAuditLogSchema>;

export const reviewQueue = pgTable("review_queue", {
  id: serial("id").primaryKey(),
  sourceType: text("source_type").notNull().$type<"rfi" | "quiz" | "dead_letter_job" | "ai_output">(),
  sourceId: integer("source_id").notNull(),
  status: text("status").notNull().default("pending").$type<"pending" | "approved">(),
  checklistState: jsonb("checklist_state").$type<Record<string, boolean>>().default({}),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  ghlWorkflowId: text("ghl_workflow_id"),
  notes: text("notes"),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("review_queue_status_idx").on(table.status),
  index("review_queue_source_type_idx").on(table.sourceType),
  index("review_queue_created_at_idx").on(table.createdAt),
]);

export const insertReviewQueueSchema = createInsertSchema(reviewQueue).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  sourceType: z.enum(["rfi", "quiz", "dead_letter_job", "ai_output"]),
  status: z.enum(["pending", "approved"]).optional(),
});

export type ReviewQueueItem = typeof reviewQueue.$inferSelect;
export type InsertReviewQueueItem = z.infer<typeof insertReviewQueueSchema>;

export const REVIEW_CHECKLIST_ITEMS = [
  { key: "verify_identity", label: "Verify contact identity" },
  { key: "confirm_business", label: "Confirm business type and volume" },
  { key: "review_data", label: "Review submitted data for completeness" },
  { key: "check_duplicate", label: "Check for duplicate contact" },
  { key: "confirm_lead_source", label: "Confirm lead source / UTM" },
  { key: "internal_notes", label: "Internal notes added" },
] as const;

// ── Churn Risk & Health Scoring ───────────────────────────────────────────────

export const CHURN_RISK_TIERS = ["Low", "Medium", "High", "Critical"] as const;
export type ChurnRiskTier = typeof CHURN_RISK_TIERS[number];

export const churnScoreWeights = pgTable("churn_score_weights", {
  id: serial("id").primaryKey(),
  signalKey: text("signal_key").notNull().unique(),
  label: text("label").notNull(),
  weight: real("weight").notNull().default(1.0),
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertChurnScoreWeightsSchema = createInsertSchema(churnScoreWeights).omit({
  id: true,
  updatedAt: true,
});

export type ChurnScoreWeight = typeof churnScoreWeights.$inferSelect;
export type InsertChurnScoreWeight = z.infer<typeof insertChurnScoreWeightsSchema>;

export const merchantHealthScores = pgTable("merchant_health_scores", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id).notNull(),
  churnScore: real("churn_score").notNull().default(0),
  riskTier: text("risk_tier").notNull().default("Low"),
  volumeTrendScore: real("volume_trend_score").default(0),
  chargebackTrendScore: real("chargeback_trend_score").default(0),
  ticketVelocityScore: real("ticket_velocity_score").default(0),
  npsScore: real("nps_score").default(0),
  portalActivityScore: real("portal_activity_score").default(0),
  outreachResponseScore: real("outreach_response_score").default(0),
  overrideScore: real("override_score"),
  overrideNote: text("override_note"),
  overriddenAt: timestamp("overridden_at"),
  overriddenBy: text("overridden_by"),
  retentionCampaignTriggered: boolean("retention_campaign_triggered").default(false),
  agentNotified: boolean("agent_notified").default(false),
  computedAt: timestamp("computed_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("merchant_health_scores_contact_id_idx").on(table.contactId),
  index("merchant_health_scores_risk_tier_idx").on(table.riskTier),
  index("merchant_health_scores_computed_at_idx").on(table.computedAt),
]);

export const insertMerchantHealthScoreSchema = createInsertSchema(merchantHealthScores).omit({
  id: true,
  createdAt: true,
});

export type MerchantHealthScore = typeof merchantHealthScores.$inferSelect;
export type InsertMerchantHealthScore = z.infer<typeof insertMerchantHealthScoreSchema>;

// ── Entity Relationship Knowledge Graph ───────────────────────────────────────

export const ENTITY_RELATIONSHIP_TYPES = [
  "same_ein",
  "same_bank",
  "same_phone",
  "same_owner",
  "same_address",
  "iso_agent",
  "company_member",
  "manual",
] as const;

export type EntityRelationshipType = typeof ENTITY_RELATIONSHIP_TYPES[number];

export const ENTITY_TYPES = [
  "contact",
  "company",
  "deal",
  "mid",
  "iso_partner",
  "user",
  "partner",
] as const;

export type EntityType = typeof ENTITY_TYPES[number];

export const entityRelationships = pgTable("entity_relationships", {
  id: serial("id").primaryKey(),
  sourceEntityType: text("source_entity_type").notNull().$type<EntityType>(),
  sourceEntityId: integer("source_entity_id").notNull(),
  targetEntityType: text("target_entity_type").notNull().$type<EntityType>(),
  targetEntityId: integer("target_entity_id").notNull(),
  relationshipType: text("relationship_type").notNull().$type<EntityRelationshipType>(),
  confidence: real("confidence").notNull().default(1.0),
  source: text("source").notNull().default("system"),
  riskFlag: boolean("risk_flag").default(false),
  riskReason: text("risk_reason"),
  note: text("note"),
  dismissedAt: timestamp("dismissed_at"),
  dismissedBy: text("dismissed_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("entity_relationships_source_idx").on(table.sourceEntityType, table.sourceEntityId),
  index("entity_relationships_target_idx").on(table.targetEntityType, table.targetEntityId),
  index("entity_relationships_type_idx").on(table.relationshipType),
  index("entity_relationships_risk_flag_idx").on(table.riskFlag),
  uniqueIndex("entity_relationships_unique_idx").on(
    table.sourceEntityType,
    table.sourceEntityId,
    table.targetEntityType,
    table.targetEntityId,
    table.relationshipType,
  ),
]);

export const insertEntityRelationshipSchema = createInsertSchema(entityRelationships).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  sourceEntityType: z.enum(ENTITY_TYPES),
  targetEntityType: z.enum(ENTITY_TYPES),
  relationshipType: z.enum(ENTITY_RELATIONSHIP_TYPES),
});

export type EntityRelationship = typeof entityRelationships.$inferSelect;
export type InsertEntityRelationship = z.infer<typeof insertEntityRelationshipSchema>;

export const ONBOARDING_CHECKLIST_ITEM_KEYS = [
  "voided_check",
  "government_id",
  "signed_agreement",
  "bank_letter",
  "business_license",
] as const;

// ---------------------------------------------------------------------------
// Merchant Onboarding Workflow Stages (10-stage pipeline tracker)
// Separate from onboarding_checklist_items (document tracking)
// ---------------------------------------------------------------------------
export const MERCHANT_ONBOARDING_STAGE_KEYS = [
  "application_started",
  "docs_requested",
  "docs_received",
  "underwriting",
  "approved",
  "equipment_terminal",
  "training",
  "go_live",
  "first_batch_processed",
  "support_handoff",
] as const;

export type MerchantOnboardingStageKey = typeof MERCHANT_ONBOARDING_STAGE_KEYS[number];

export const MERCHANT_ONBOARDING_STAGE_LABELS: Record<MerchantOnboardingStageKey, string> = {
  application_started: "Application Started",
  docs_requested: "Docs Requested",
  docs_received: "Docs Received",
  underwriting: "Underwriting",
  approved: "Approved",
  equipment_terminal: "Equipment / Terminal",
  training: "Training",
  go_live: "Go-Live",
  first_batch_processed: "First Batch Processed",
  support_handoff: "Support Handoff",
};

export const MERCHANT_ONBOARDING_STAGE_STATUSES = [
  "pending",
  "in_progress",
  "complete",
  "blocked",
] as const;

export type MerchantOnboardingStageStatus = typeof MERCHANT_ONBOARDING_STAGE_STATUSES[number];

export const merchantOnboardingStages = pgTable("merchant_onboarding_stages", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").references(() => deals.id).notNull(),
  stageKey: text("stage_key").notNull(),
  status: text("status").notNull().default("pending"),
  owner: text("owner"),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  equipmentOrderRef: text("equipment_order_ref"),
  ghlStageSyncedAt: timestamp("ghl_stage_synced_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("merchant_onboarding_stages_deal_id_idx").on(table.dealId),
  uniqueIndex("merchant_onboarding_stages_deal_key_unique").on(table.dealId, table.stageKey),
]);

export const insertMerchantOnboardingStageSchema = createInsertSchema(merchantOnboardingStages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type MerchantOnboardingStage = typeof merchantOnboardingStages.$inferSelect;
export type InsertMerchantOnboardingStage = z.infer<typeof insertMerchantOnboardingStageSchema>;

export type OnboardingChecklistItemKey = typeof ONBOARDING_CHECKLIST_ITEM_KEYS[number];

export const ONBOARDING_CHECKLIST_ITEM_LABELS: Record<OnboardingChecklistItemKey, string> = {
  voided_check: "Voided Check",
  government_id: "Government-Issued ID",
  signed_agreement: "Signed Merchant Agreement",
  bank_letter: "Bank Letter",
  business_license: "Business License",
};

export const ONBOARDING_CHECKLIST_ITEM_STATUSES = [
  "not_requested",
  "requested",
  "received",
  "approved",
  "rejected",
] as const;

export type OnboardingChecklistItemStatus = typeof ONBOARDING_CHECKLIST_ITEM_STATUSES[number];

export const onboardingChecklistItems = pgTable("onboarding_checklist_items", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").references(() => deals.id).notNull(),
  itemKey: text("item_key").notNull(),
  status: text("status").default("not_requested"),
  documentId: integer("document_id").references(() => documents.id),
  notes: text("notes"),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("checklist_deal_id_idx").on(table.dealId),
  uniqueIndex("checklist_deal_item_unique_idx").on(table.dealId, table.itemKey),
]);

export const insertOnboardingChecklistItemSchema = createInsertSchema(onboardingChecklistItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type OnboardingChecklistItem = typeof onboardingChecklistItems.$inferSelect;
export type InsertOnboardingChecklistItem = z.infer<typeof insertOnboardingChecklistItemSchema>;

export const rateReviewRequests = pgTable("rate_review_requests", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id),
  dealId: integer("deal_id").references(() => deals.id),
  documentId: integer("document_id").references(() => documents.id),
  status: text("status").default("requested"),
  analysisResult: jsonb("analysis_result"),
  isOptimalPricing: boolean("is_optimal_pricing"),
  requestNotes: text("request_notes"),
  repViewedAt: timestamp("rep_viewed_at"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  resolution: text("resolution"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("rate_review_requests_contact_id_idx").on(table.contactId),
  index("rate_review_requests_status_idx").on(table.status),
  index("rate_review_requests_created_at_idx").on(table.createdAt),
]);

export const insertRateReviewRequestSchema = createInsertSchema(rateReviewRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type RateReviewRequest = typeof rateReviewRequests.$inferSelect;
export type InsertRateReviewRequest = z.infer<typeof insertRateReviewRequestSchema>;

export const toolClickEvents = pgTable("tool_click_events", {
  id: serial("id").primaryKey(),
  toolId: text("tool_id").notNull(),
  toolTitle: text("tool_title"),
  source: text("source").default("sales-tools-hub"),
  userId: text("user_id"),
  sessionId: text("session_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("tool_click_events_tool_id_idx").on(table.toolId),
  index("tool_click_events_created_at_idx").on(table.createdAt),
]);

export const insertToolClickEventSchema = createInsertSchema(toolClickEvents).omit({
  id: true,
  createdAt: true,
});

export type ToolClickEvent = typeof toolClickEvents.$inferSelect;
export type InsertToolClickEvent = z.infer<typeof insertToolClickEventSchema>;

// ─── Statement Proposals ─────────────────────────────────────────────────────
// Dedicated proposal draft entity created at upload time (step 10 of the
// statement upload chain). Overwritten when AI analysis completes.
export const statementProposals = pgTable("statement_proposals", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").references(() => deals.id),
  contactId: integer("contact_id").references(() => contacts.id),
  status: text("status").default("draft"),
  merchantName: text("merchant_name"),
  source: text("source"),
  statementFileName: text("statement_file_name"),
  plans: jsonb("plans"),
  savingsEstimate: text("savings_estimate"),
  effectiveRate: text("effective_rate"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("statement_proposals_deal_id_idx").on(table.dealId),
  index("statement_proposals_contact_id_idx").on(table.contactId),
]);

export const insertStatementProposalSchema = createInsertSchema(statementProposals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type StatementProposal = typeof statementProposals.$inferSelect;
export type InsertStatementProposal = z.infer<typeof insertStatementProposalSchema>;

// ─── Underwriting Rules Engine ───────────────────────────────────────────────
export const underwritingRules = pgTable("underwriting_rules", {
  id: serial("id").primaryKey(),
  minMonthlyVolume: numeric("min_monthly_volume").default("5000"),
  maxMonthlyVolume: numeric("max_monthly_volume").default("500000"),
  effectiveRateCeiling: numeric("effective_rate_ceiling").default("3.5"),
  chargebackRateLimit: numeric("chargeback_rate_limit").default("1.0"),
  chargebackRateHardLimit: numeric("chargeback_rate_hard_limit").default("2.0"),
  volumeHardDeviationPct: numeric("volume_hard_deviation_pct").default("50"),
  allowedProcessors: text("allowed_processors").array(),
  blockedProcessors: text("blocked_processors").array(),
  autoApproveEnabled: boolean("auto_approve_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUnderwritingRulesSchema = createInsertSchema(underwritingRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type UnderwritingRules = typeof underwritingRules.$inferSelect;
export type InsertUnderwritingRules = z.infer<typeof insertUnderwritingRulesSchema>;

export const underwritingDecisions = pgTable("underwriting_decisions", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").references(() => deals.id),
  decision: text("decision").notNull(),
  score: integer("score").notNull().default(0),
  reasons: text("reasons").array(),
  rulesSnapshot: jsonb("rules_snapshot"),
  decidedAt: timestamp("decided_at").defaultNow(),
  overriddenBy: text("overridden_by"),
  overriddenAt: timestamp("overridden_at"),
  overrideAction: text("override_action"),
  overrideNote: text("override_note"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("underwriting_decisions_deal_id_idx").on(table.dealId),
  index("underwriting_decisions_decision_idx").on(table.decision),
  index("underwriting_decisions_created_at_idx").on(table.createdAt),
]);

export const insertUnderwritingDecisionSchema = createInsertSchema(underwritingDecisions).omit({
  id: true,
  createdAt: true,
});

export type UnderwritingDecision = typeof underwritingDecisions.$inferSelect;
export type InsertUnderwritingDecision = z.infer<typeof insertUnderwritingDecisionSchema>;

// ─── Underwriting Conditions (#1403) ─────────────────────────────────────────
export const underwritingConditions = pgTable("underwriting_conditions", {
  id:              serial("id").primaryKey(),
  dealId:          integer("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  decisionId:      integer("decision_id").references(() => underwritingDecisions.id),
  conditionType:   text("condition_type").notNull(),
  description:     text("description").notNull(),
  status:          text("status").notNull().default("pending"),
  merchantVisible: boolean("merchant_visible").notNull().default(true),
  dueDate:         timestamp("due_date"),
  submittedAt:     timestamp("submitted_at"),
  approvedAt:      timestamp("approved_at"),
  waivedAt:        timestamp("waived_at"),
  waivedReason:    text("waived_reason"),
  documentId:      integer("document_id"),
  notes:           text("notes"),
  createdBy:       integer("created_by"),
  updatedBy:       integer("updated_by"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_uw_conditions_deal_id").on(t.dealId),
  index("idx_uw_conditions_status").on(t.dealId, t.status),
]);

export const insertUnderwritingConditionSchema = createInsertSchema(underwritingConditions).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type UnderwritingCondition = typeof underwritingConditions.$inferSelect;
export type InsertUnderwritingCondition = z.infer<typeof insertUnderwritingConditionSchema>;

// ─── Push Subscriptions ──────────────────────────────────────────────────────
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  auth: text("auth").notNull(),
  p256dh: text("p256dh").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("push_subscriptions_user_id_idx").on(table.userId),
  uniqueIndex("push_subscriptions_endpoint_idx").on(table.endpoint),
]);

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({
  id: true,
  createdAt: true,
});

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;

// ─── Bot Contexts (GHL AI Bot Management) ────────────────────────────────────
export const botContexts = pgTable("bot_contexts", {
  id: serial("id").primaryKey(),
  contextId: text("context_id").notNull(),
  name: text("name").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  faqItems: jsonb("faq_items").default([]),
  active: boolean("active").default(true),
  autoReplyEnabled: boolean("auto_reply_enabled").default(false),
  autoReplyDelaySeconds: integer("auto_reply_delay_seconds").default(180),
  confidenceThreshold: integer("confidence_threshold").default(60),
  channel: text("channel").default("all"),
  verticalKey: text("vertical_key"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("bot_contexts_context_id_idx").on(table.contextId),
]);

export const insertBotContextSchema = createInsertSchema(botContexts).omit({ id: true, createdAt: true, updatedAt: true });
export type BotContextRecord = typeof botContexts.$inferSelect;
export type InsertBotContextRecord = z.infer<typeof insertBotContextSchema>;

// ─── Handoff Rules ────────────────────────────────────────────────────────────
export const handoffRules = pgTable("handoff_rules", {
  id: serial("id").primaryKey(),
  pattern: text("pattern").notNull(),
  type: text("type").notNull(),
  active: boolean("active").default(true),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertHandoffRuleSchema = createInsertSchema(handoffRules).omit({ id: true, createdAt: true });
export type HandoffRule = typeof handoffRules.$inferSelect;
export type InsertHandoffRule = z.infer<typeof insertHandoffRuleSchema>;

// ─── Analytics Events ─────────────────────────────────────────────────────────
export const analyticsEvents = pgTable("analytics_events", {
  id: serial("id").primaryKey(),
  eventName: text("event_name").notNull(),
  eventId: text("event_id"),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  sessionId: text("session_id"),
  visitorId: text("visitor_id"),
  bookingTrackingId: text("booking_tracking_id"),
  contactId: integer("contact_id"),
  dealId: integer("deal_id"),
  sequenceId: integer("sequence_id"),
  pagePath: text("page_path"),
  landingPage: text("landing_page"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),
  utmTerm: text("utm_term"),
  gclidPresent: boolean("gclid_present"),
  fbclidPresent: boolean("fbclid_present"),
  msclkidPresent: boolean("msclkid_present"),
  offerRoute: text("offer_route"),
  vertical: text("vertical"),
  consentTier: text("consent_tier"),
  lifecycleStage: text("lifecycle_stage"),
  sourceCategory: text("source_category"),
  formId: text("form_id"),
  channel: text("channel"),
  blockReason: text("block_reason"),
  dealStage: text("deal_stage"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("analytics_events_event_name_idx").on(table.eventName),
  index("analytics_events_occurred_at_idx").on(table.occurredAt),
  index("analytics_events_contact_id_idx").on(table.contactId),
  index("analytics_events_utm_source_campaign_idx").on(table.utmSource, table.utmCampaign),
  index("analytics_events_page_path_idx").on(table.pagePath),
  index("analytics_events_booking_tracking_id_idx").on(table.bookingTrackingId),
  uniqueIndex("analytics_events_event_id_idx").on(table.eventId),
]);

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export const insertAnalyticsEventSchema = createInsertSchema(analyticsEvents).omit({ id: true, createdAt: true });
export type InsertAnalyticsEvent = z.infer<typeof insertAnalyticsEventSchema>;

// ─── Statement Requests ───────────────────────────────────────────────────────
export const statementRequests = pgTable("statement_requests", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id).notNull(),
  dealId: integer("deal_id").references(() => deals.id),
  sdrLeadStateId: integer("sdr_lead_state_id").references(() => sdrLeadState.id),
  status: text("status").notNull().default("requested"),
  uploadToken: text("upload_token").notNull(),
  uploadUrl: text("upload_url").notNull(),
  requestedAt: timestamp("requested_at").notNull(),
  uploadedAt: timestamp("uploaded_at"),
  reviewedAt: timestamp("reviewed_at"),
  abandonedAt: timestamp("abandoned_at"),
  lastReminderTaskAt: timestamp("last_reminder_task_at"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("statement_requests_upload_token_idx").on(table.uploadToken),
  index("statement_requests_contact_id_idx").on(table.contactId),
  index("statement_requests_status_idx").on(table.status),
]);

export const insertStatementRequestSchema = createInsertSchema(statementRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type StatementRequest = typeof statementRequests.$inferSelect;
export type InsertStatementRequest = z.infer<typeof insertStatementRequestSchema>;

// ─── Contact AI Cache ─────────────────────────────────────────────────────────
export const contactAiCache = pgTable("contact_ai_cache", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id).notNull(),
  cacheKey: text("cache_key").notNull(),
  output: jsonb("output").notNull(),
  model: text("model"),
  generatedAt: timestamp("generated_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("contact_ai_cache_contact_key_idx").on(table.contactId, table.cacheKey),
  index("contact_ai_cache_contact_id_idx").on(table.contactId),
]);

export const insertContactAiCacheSchema = createInsertSchema(contactAiCache).omit({
  id: true,
  createdAt: true,
});

export type ContactAiCache = typeof contactAiCache.$inferSelect;
export type InsertContactAiCache = z.infer<typeof insertContactAiCacheSchema>;

// ─── Outbound Send Counters (Task #792 — Global Kill Switch & Daily Caps) ─────
export const outboundSendCounters = pgTable("outbound_send_counters", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  channel: text("channel").notNull(),
  scope: text("scope").notNull(),
  count: integer("count").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  unique("outbound_send_counters_date_channel_scope_uidx").on(table.date, table.channel, table.scope),
  index("outbound_send_counters_date_idx").on(table.date),
]);

export const insertOutboundSendCounterSchema = createInsertSchema(outboundSendCounters).omit({
  id: true,
});

export type OutboundSendCounter = typeof outboundSendCounters.$inferSelect;
export type InsertOutboundSendCounter = z.infer<typeof insertOutboundSendCounterSchema>;

// ─── Promotional Enrollment Jobs ──────────────────────────────────────────────
export const promotionalEnrollmentJobs = pgTable("promotional_enrollment_jobs", {
  id: serial("id").primaryKey(),
  sourceEventId: text("source_event_id").notNull().unique(),
  contactId: integer("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  triggerType: text("trigger_type").notNull(),
  formType: text("form_type"),
  status: text("status").notNull().default("pending"),
  reasonCodes: text("reason_codes").array(),
  enrollmentIds: integer("enrollment_ids").array(),
  attempts: integer("attempts").notNull().default(0),
  jobId: text("job_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
}, (table) => [
  index("promotional_enrollment_jobs_contact_id_idx").on(table.contactId),
  index("promotional_enrollment_jobs_status_idx").on(table.status),
]);

export const insertPromotionalEnrollmentJobSchema = createInsertSchema(promotionalEnrollmentJobs).omit({
  id: true,
  createdAt: true,
});

export type PromotionalEnrollmentJob = typeof promotionalEnrollmentJobs.$inferSelect;
export type InsertPromotionalEnrollmentJob = z.infer<typeof insertPromotionalEnrollmentJobSchema>;

export type PromotionalEnrollmentJobStatus =
  | "pending"
  | "processing"
  | "enrolled"
  | "blocked"
  | "no_matching_sequence"
  | "already_enrolled"
  | "failed"
  | "deferred_queue_unavailable";

export type PromotionalEligibilityReason =
  | "contact_not_found"
  | "dnc"
  | "existing_opt_out"
  | "existing_opt_out_preserved_on_resubmission"
  | "no_usable_channel"
  | "invalid_email_format"
  | "disposable_email_domain"
  | "email_status_blocked"
  | "eligible";

// ─── Per-Contact Lead Scoring Jobs ────────────────────────────────────────────
export const contactLeadScoringJobs = pgTable("contact_lead_scoring_jobs", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull().references(() => contacts.id),
  requestedGeneration: integer("requested_generation").notNull().default(1),
  processedGeneration: integer("processed_generation").notNull().default(0),
  status: text("status").notNull(),
  triggerSources: text("trigger_sources").array(),
  inputVersionSnapshot: timestamp("input_version_snapshot", { withTimezone: true }),
  enqueueAttempts: integer("enqueue_attempts").notNull().default(0),
  executionAttempts: integer("execution_attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("contact_lead_scoring_jobs_contact_id_idx").on(table.contactId),
  index("contact_lead_scoring_jobs_status_idx").on(table.status),
]);

export const insertContactLeadScoringJobSchema = createInsertSchema(contactLeadScoringJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ContactLeadScoringJob = typeof contactLeadScoringJobs.$inferSelect;
export type InsertContactLeadScoringJob = z.infer<typeof insertContactLeadScoringJobSchema>;

export type ContactLeadScoringJobStatus =
  | "pending_enqueue"
  | "queued"
  | "processing"
  | "completed"
  | "contact_not_found"
  | "failed_terminal"
  | "deferred_queue_unavailable";

// ─── System Audit Runs ────────────────────────────────────────────────────────
export const systemAuditRuns = pgTable("system_audit_runs", {
  id: serial("id").primaryKey(),
  ranAt: timestamp("ran_at", { withTimezone: true }).defaultNow().notNull(),
  overallScore: integer("overall_score"),
  probeResults: jsonb("probe_results"),
  claudeNarrative: text("claude_narrative"),
  slackStatus: text("slack_status").notNull().default("skipped"),
  triggeredBy: text("triggered_by").notNull().default("schedule"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("system_audit_runs_ran_at_idx").on(table.ranAt),
  index("system_audit_runs_triggered_idx").on(table.triggeredBy),
]);

export const insertSystemAuditRunSchema = createInsertSchema(systemAuditRuns).omit({
  id: true,
  createdAt: true,
});

export type SystemAuditRun = typeof systemAuditRuns.$inferSelect;
export type InsertSystemAuditRun = z.infer<typeof insertSystemAuditRunSchema>;

// AI Assistant tables (migration 0084)
export * from "./schema-ai-assistant";

// ---------------------------------------------------------------------------
// Master Lead Database — staged import pipeline (migration 0087)
// Rows land here first (status=staged) before any CRM enrollment/outbound.
// ---------------------------------------------------------------------------
export const masterLeadBatches = pgTable("master_lead_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchName: text("batch_name").notNull(),
  sheetId: text("sheet_id"),
  sheetName: text("sheet_name"),
  tabName: text("tab_name"),
  sourceMethod: text("source_method").notNull().default("csv_upload"), // sheets_api | csv_upload
  totalRows: integer("total_rows").default(0),
  stagedCount: integer("staged_count").default(0),
  duplicateCount: integer("duplicate_count").default(0),
  suppressedCount: integer("suppressed_count").default(0),
  invalidCount: integer("invalid_count").default(0),
  promotedCount: integer("promoted_count").default(0),
  readyCount: integer("ready_count").default(0),
  status: text("status").notNull().default("processing"), // processing | completed | failed
  errorMessage: text("error_message"),
  importedBy: text("imported_by"),
  importedAt: timestamp("imported_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type MasterLeadBatch = typeof masterLeadBatches.$inferSelect;
export type InsertMasterLeadBatch = typeof masterLeadBatches.$inferInsert;

// ---------------------------------------------------------------------------
// Inbox Items — ownership / routing metadata for AI inbox entries
// ---------------------------------------------------------------------------
export const inboxItems = pgTable("inbox_items", {
  id: serial("id").primaryKey(),
  sourceItemId: text("source_item_id").notNull(), // e.g. "email-123", "sms-456"
  sourceItemType: text("source_item_type").notNull().default("email"), // email|sms|ghl_chat|statement
  contactId: integer("contact_id").references(() => contacts.id),
  dealId: integer("deal_id").references(() => deals.id),
  ownerId: text("owner_id"),
  ownerName: text("owner_name"),
  department: text("department").default("sales"), // sales|support|onboarding|accounts
  status: text("status").default("new"), // new|in_progress|waiting|resolved|escalated
  priority: text("priority").default("normal"), // low|normal|high|urgent
  slaDueAt: timestamp("sla_due_at"),
  nextAction: text("next_action"),
  escalationPath: text("escalation_path"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("inbox_items_source_item_id_uidx").on(table.sourceItemId),
  index("inbox_items_status_idx").on(table.status),
  index("inbox_items_contact_id_idx").on(table.contactId),
  index("inbox_items_sla_due_at_idx").on(table.slaDueAt),
]);

export const insertInboxItemSchema = createInsertSchema(inboxItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InboxItemRow = typeof inboxItems.$inferSelect;
export type InsertInboxItem = z.infer<typeof insertInboxItemSchema>;

// ---------------------------------------------------------------------------
// Statement Reviews — analyst workflow for processing statement reviews
// ---------------------------------------------------------------------------
export const statementReviews = pgTable("statement_reviews", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").references(() => documents.id),
  contactId: integer("contact_id").references(() => contacts.id),
  dealId: integer("deal_id").references(() => deals.id),
  status: text("status").default("received"), // received|in_review|ai_analyzed|reviewed|follow_up_sent|complete
  analystId: text("analyst_id"),
  analystName: text("analyst_name"),
  aiSummary: jsonb("ai_summary"),
  analystNotes: text("analyst_notes"),
  savingsEstimateOverride: text("savings_estimate_override"),
  followUpDraft: text("follow_up_draft"),
  followUpSentAt: timestamp("follow_up_sent_at"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("statement_reviews_contact_id_idx").on(table.contactId),
  index("statement_reviews_status_idx").on(table.status),
  index("statement_reviews_document_id_idx").on(table.documentId),
]);

export const insertStatementReviewSchema = createInsertSchema(statementReviews).omit({ id: true, createdAt: true, updatedAt: true });
export type StatementReview = typeof statementReviews.$inferSelect;
export type InsertStatementReview = z.infer<typeof insertStatementReviewSchema>;

export const masterLeads = pgTable("master_leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").references(() => masterLeadBatches.id),
  // Lifecycle status pipeline (text field — not an enum so values can be added without migrations):
  //   staged | imported | duplicate | suppressed | needs_website_check | needs_mx_verification
  //   | ready_for_internal_test | ready_for_controlled_cohort | enrolled | paused
  //   | bounced | unsubscribed | client_customer
  status: text("status").notNull().default("staged"),

  // Source columns (verbatim from sheet / CSV)
  company: text("company"),
  normalizedCompany: text("normalized_company"),
  domain: text("domain"),
  email: text("email"),
  emailType: text("email_type"),
  phone: text("phone"),
  normalizedPhone: text("normalized_phone"),
  contactName: text("contact_name"),
  contactTitle: text("contact_title"),
  vertical: text("vertical"),
  qualityScore: real("quality_score"),
  fitTier: text("fit_tier"),
  outreachReadiness: text("outreach_readiness"),
  readinessReason: text("readiness_reason"),
  source: text("source"),
  sourcePath: text("source_path"),
  sourceModifiedDate: text("source_modified_date"),

  // Address / location (from backfill or enrichment)
  address: text("address"),
  city: text("city"),
  state: text("state"),
  website: text("website"),

  // Channel status flags (set during validation / suppression check)
  emailValid: boolean("email_valid"),   // null=unchecked, true=valid, false=invalid
  phoneValid: boolean("phone_valid"),   // null=unchecked, true=valid, false=invalid
  smsEligible: boolean("sms_eligible"), // false until GHL_PHONE_NUMBER_ID + A2P_REGISTRATION_ID set

  // Provenance
  sheetId: text("sheet_id"),
  sheetName: text("sheet_name"),
  tabName: text("tab_name"),
  rowNumber: integer("row_number"),

  // Dedup / suppression metadata
  canonicalLeadId: uuid("canonical_lead_id"),
  duplicateOfId: uuid("duplicate_of_id").references((): any => masterLeads.id),
  suppressionReason: text("suppression_reason"),

  // Promotion tracking (ready_for_internal_test → ready_for_controlled_cohort requires admin click)
  promotedAt: timestamp("promoted_at"),
  promotedBy: text("promoted_by"),

  // Admin notes
  notes: text("notes"),

  importedAt: timestamp("imported_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("master_leads_batch_id_idx").on(table.importBatchId),
  index("master_leads_domain_idx").on(table.domain),
  index("master_leads_email_idx").on(table.email),
  index("master_leads_status_idx").on(table.status),
  index("master_leads_status_source_idx").on(table.status, table.source),
  index("master_leads_vertical_idx").on(table.vertical),
  index("master_leads_fit_tier_idx").on(table.fitTier),
  index("master_leads_promoted_at_idx").on(table.promotedAt),
]);

export type MasterLead = typeof masterLeads.$inferSelect;
export type InsertMasterLead = typeof masterLeads.$inferInsert;

// ── Agent Payout Ledger ────────────────────────────────────────────────────────
export const agentPayouts = pgTable("agent_payouts", {
  id: serial("id").primaryKey(),
  agentUserId: varchar("agent_user_id").references(() => users.id).notNull(),
  // partnerUserId is kept for future use when partner org members have platform user accounts.
  // For now, use partnerOrgId to identify the partner organization that earned partnerShare.
  partnerUserId: varchar("partner_user_id").references(() => users.id),
  // Links to the partner organization responsible for this period's partnerShare.
  // Resolved at generation time via merchantResiduals.dealId -> deals.partnerOrgId.
  partnerOrgId: integer("partner_org_id").references(() => partnerOrganizations.id),
  periodMonth: text("period_month").notNull(),
  grossResidual: text("gross_residual").notNull().default("0"),
  agentShare: text("agent_share").notNull().default("0"),
  partnerShare: text("partner_share").notNull().default("0"),
  status: text("status").notNull().default("pending"), // pending | approved | paid
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Partial unique indexes: one row per (agent, month) when no partner,
  // one row per (agent, month, partnerOrg) when a partner is present.
  // (The old single unique constraint on (agentUserId, periodMonth) was dropped in migration 0101.)
  index("agent_payouts_agent_user_id_idx").on(table.agentUserId),
  index("agent_payouts_status_idx").on(table.status),
  index("agent_payouts_partner_org_idx").on(table.partnerOrgId),
]);

export const insertAgentPayoutSchema = createInsertSchema(agentPayouts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type AgentPayout = typeof agentPayouts.$inferSelect;
export type InsertAgentPayout = z.infer<typeof insertAgentPayoutSchema>;

// ---------------------------------------------------------------------------
// Executive Weekly Snapshots — weekly KPI roll-up with AI narratives
// ---------------------------------------------------------------------------
export const executiveWeeklySnapshots = pgTable("executive_weekly_snapshots", {
  id: serial("id").primaryKey(),
  weekStart: text("week_start").notNull().unique(),
  closedWonRevenue: numeric("closed_won_revenue", { precision: 14, scale: 2 }).default("0"),
  grossProfit: numeric("gross_profit", { precision: 14, scale: 2 }).default("0"),
  netProfit: numeric("net_profit", { precision: 14, scale: 2 }).default("0"),
  grossMarginPct: numeric("gross_margin_pct", { precision: 6, scale: 2 }).default("0"),
  netMarginPct: numeric("net_margin_pct", { precision: 6, scale: 2 }).default("0"),
  pipelineValue: numeric("pipeline_value", { precision: 14, scale: 2 }).default("0"),
  newDealsClosed: integer("new_deals_closed").default(0),
  proposalsSent: integer("proposals_sent").default(0),
  statementsReceived: integer("statements_received").default(0),
  meetingsBooked: integer("meetings_booked").default(0),
  outreachAttempts: integer("outreach_attempts").default(0),
  perRepBreakdown: jsonb("per_rep_breakdown"),
  goalsVsActuals: jsonb("goals_vs_actuals"),
  gptBriefing: text("gpt_briefing"),
  claudeCoaching: jsonb("claude_coaching"),
  generatedAt: timestamp("generated_at"),
  trigger: text("trigger").default("schedule"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("exec_snapshots_week_start_idx").on(table.weekStart),
]);

export const insertExecutiveWeeklySnapshotSchema = createInsertSchema(executiveWeeklySnapshots).omit({
  id: true,
  createdAt: true,
});
export type ExecutiveWeeklySnapshot = typeof executiveWeeklySnapshots.$inferSelect;

export type InsertExecutiveWeeklySnapshot = z.infer<typeof insertExecutiveWeeklySnapshotSchema>;
export const executiveGoals = pgTable("executive_goals", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  value: numeric("value", { precision: 14, scale: 2 }).notNull(),
  periodType: text("period_type").notNull().default("weekly"),
  setBy: text("set_by"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("executive_goals_key_period_idx").on(table.key, table.periodType),
]);

export const insertExecutiveGoalSchema = createInsertSchema(executiveGoals).omit({ id: true });
export type ExecutiveGoal = typeof executiveGoals.$inferSelect;

// ---------------------------------------------------------------------------
// Automation Registry — one row per BullMQ queue / scheduled automation.
// Allows operators to see status, last-run metrics, and kill-switch each one.
// ---------------------------------------------------------------------------
export const automationRegistry = pgTable("automation_registry", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  title: text("title"),
  triggerDescription: text("trigger_description"),
  status: text("status").notNull().default("active"),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  lastRunRecordsAffected: integer("last_run_records_affected"),
  lastRunErrors: integer("last_run_errors"),
  killSwitchEnabled: boolean("kill_switch_enabled").notNull().default(false),
  owner: text("owner"),
  version: text("version"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAutomationRegistrySchema = createInsertSchema(automationRegistry).omit({
  id: true,
  updatedAt: true,
});

export type AutomationRegistry = typeof automationRegistry.$inferSelect;
export type InsertAutomationRegistry = z.infer<typeof insertAutomationRegistrySchema>;

// ---------------------------------------------------------------------------
// Contact NBA — Next Best Action Engine
// One active recommendation per contact (UPSERT on contact_id).
// ---------------------------------------------------------------------------
export const contactNba = pgTable("contact_nba", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),

  actionType: text("action_type").notNull(),
  channel: text("channel"),
  ownerRole: text("owner_role"),

  dueAt: timestamp("due_at"),
  urgency: text("urgency").notNull().default("normal"),
  expiresAt: timestamp("expires_at"),

  reasonCode: text("reason_code").notNull(),
  explanation: text("explanation"),
  confidence: integer("confidence"),
  ruleVersion: text("rule_version"),
  modelVersion: text("model_version"),
  evidence: jsonb("evidence"),

  opportunityValueCents: integer("opportunity_value_cents"),
  automationEligible: boolean("automation_eligible").notNull().default(false),
  humanRequired: boolean("human_required").notNull().default(false),

  status: text("status").notNull().default("OPEN"),
  generatedAt: timestamp("generated_at").defaultNow(),
  executedAt: timestamp("executed_at"),
  dismissedAt: timestamp("dismissed_at"),
  dismissedBy: text("dismissed_by"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("contact_nba_contact_id_unique").on(table.contactId),
  index("contact_nba_status_urgency_idx").on(table.status, table.urgency),
  index("contact_nba_due_at_idx").on(table.dueAt),
]);

export const insertContactNbaSchema = createInsertSchema(contactNba).omit({ id: true, generatedAt: true, updatedAt: true });
export type ContactNba = typeof contactNba.$inferSelect;
export type InsertContactNba = z.infer<typeof insertContactNbaSchema>;

// ---------------------------------------------------------------------------
// NBA Recommendation History — audit trail of superseded recommendations
// ---------------------------------------------------------------------------
export const nbaRecommendationHistory = pgTable("nba_recommendation_history", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),

  actionType: text("action_type").notNull(),
  channel: text("channel"),
  ownerRole: text("owner_role"),
  dueAt: timestamp("due_at"),
  urgency: text("urgency").notNull(),
  expiresAt: timestamp("expires_at"),
  reasonCode: text("reason_code").notNull(),
  explanation: text("explanation"),
  confidence: integer("confidence"),
  ruleVersion: text("rule_version"),
  modelVersion: text("model_version"),
  evidence: jsonb("evidence"),
  opportunityValueCents: integer("opportunity_value_cents"),
  automationEligible: boolean("automation_eligible").notNull().default(false),
  humanRequired: boolean("human_required").notNull().default(false),
  status: text("status").notNull(),
  generatedAt: timestamp("generated_at").notNull(),
  executedAt: timestamp("executed_at"),
  dismissedAt: timestamp("dismissed_at"),
  dismissedBy: text("dismissed_by"),

  supersededAt: timestamp("superseded_at").defaultNow(),
  supersededReason: text("superseded_reason"),
}, (table) => [
  index("nba_history_contact_id_idx").on(table.contactId),
  index("nba_history_generated_at_idx").on(table.generatedAt),
]);

export type NbaRecommendationHistory = typeof nbaRecommendationHistory.$inferSelect;

// ─── Merchant MID Registry (#1404) ───────────────────────────────────────────
export const merchantMids = pgTable("merchant_mids", {
  id:               serial("id").primaryKey(),
  contactId:        integer("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  dealId:           integer("deal_id").references(() => deals.id),
  mid:              text("mid").notNull(),
  tids:             text("tids").array().notNull().default(sql`'{}'::text[]`),
  processorName:    text("processor_name").notNull().default("payarc"),
  status:           text("status").notNull().default("assigned"),
  monthlyVolumeCap: numeric("monthly_volume_cap"),
  assignedAt:       timestamp("assigned_at").notNull().defaultNow(),
  activatedAt:      timestamp("activated_at"),
  suspendedAt:      timestamp("suspended_at"),
  closedAt:         timestamp("closed_at"),
  suspensionReason: text("suspension_reason"),
  notes:            text("notes"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("idx_merchant_mids_mid").on(t.mid),
  index("idx_merchant_mids_contact_id").on(t.contactId),
  index("idx_merchant_mids_deal_id").on(t.dealId),
]);

export const insertMerchantMidSchema = createInsertSchema(merchantMids).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type MerchantMid = typeof merchantMids.$inferSelect;
export type InsertMerchantMid = z.infer<typeof insertMerchantMidSchema>;

// ─── Equipment Shipments (#1404) ─────────────────────────────────────────────
export const equipmentShipments = pgTable("equipment_shipments", {
  id:                serial("id").primaryKey(),
  contactId:         integer("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  dealId:            integer("deal_id").references(() => deals.id),
  equipmentOrderId:  integer("equipment_order_id"),
  deviceType:        text("device_type"),
  serialNumber:      text("serial_number"),
  carrier:           text("carrier"),
  trackingNumber:    text("tracking_number"),
  status:            text("status").notNull().default("pending"),
  shippedAt:         timestamp("shipped_at"),
  estimatedDelivery: timestamp("estimated_delivery"),
  deliveredAt:       timestamp("delivered_at"),
  notes:             text("notes"),
  createdAt:         timestamp("created_at").notNull().defaultNow(),
  updatedAt:         timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_equipment_shipments_contact_id").on(t.contactId),
  index("idx_equipment_shipments_deal_id").on(t.dealId),
]);

export const insertEquipmentShipmentSchema = createInsertSchema(equipmentShipments).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type EquipmentShipment = typeof equipmentShipments.$inferSelect;
export type InsertEquipmentShipment = z.infer<typeof insertEquipmentShipmentSchema>;

// ─── Save Cases (#1407) ──────────────────────────────────────────────────────
export const saveCases = pgTable("save_cases", {
  id:                   serial("id").primaryKey(),
  contactId:            integer("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  dealId:               integer("deal_id").references(() => deals.id),
  healthAlertId:        integer("health_alert_id").references(() => healthAlerts.id),
  churnScore:           integer("churn_score"),
  riskTier:             text("risk_tier").notNull(),
  triggerSignals:       jsonb("trigger_signals").notNull().default(sql`'[]'::jsonb`),
  status:               text("status").notNull().default("open"),
  assignedTo:           text("assigned_to"),
  outcome:              text("outcome"),
  outcomeNotes:         text("outcome_notes"),
  playbookDay:          integer("playbook_day").notNull().default(0),
  escalationLevel:      integer("escalation_level").notNull().default(0),
  day2EmailSent:        boolean("day2_email_sent").notNull().default(false),
  day5ManagerNotified:  boolean("day5_manager_notified").notNull().default(false),
  day10ExecNotified:    boolean("day10_exec_notified").notNull().default(false),
  lastActivityAt:       timestamp("last_activity_at"),
  resolvedAt:           timestamp("resolved_at"),
  createdAt:            timestamp("created_at").notNull().defaultNow(),
  updatedAt:            timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_save_cases_contact_id").on(t.contactId),
  index("idx_save_cases_status").on(t.status),
]);

export const insertSaveCaseSchema = createInsertSchema(saveCases).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type SaveCase = typeof saveCases.$inferSelect;
export type InsertSaveCase = z.infer<typeof insertSaveCaseSchema>;

// ─── Entity Memory (#1408) ────────────────────────────────────────────────────
export const entityMemory = pgTable("entity_memory", {
  id:            serial("id").primaryKey(),
  entityType:    text("entity_type").notNull(),
  entityId:      integer("entity_id").notNull(),
  factKey:       text("fact_key").notNull(),
  factValue:     jsonb("fact_value").notNull(),
  source:        text("source").notNull().default("system"),
  confidence:    real("confidence"),
  sourceEventId: integer("source_event_id"),
  version:       integer("version").notNull().default(1),
  lastUpdatedAt: timestamp("last_updated_at").notNull().defaultNow(),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("idx_entity_memory_upsert").on(t.entityType, t.entityId, t.factKey),
  index("idx_entity_memory_entity").on(t.entityType, t.entityId),
]);
export type EntityMemory = typeof entityMemory.$inferSelect;

// ─── AI Decision Log (#1408) ──────────────────────────────────────────────────
export const aiDecisionLog = pgTable("ai_decision_log", {
  id:             serial("id").primaryKey(),
  decisionType:   text("decision_type").notNull(),
  contactId:      integer("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  dealId:         integer("deal_id").references(() => deals.id, { onDelete: "set null" }),
  model:          text("model"),
  promptKey:      text("prompt_key"),
  promptVersion:  text("prompt_version"),
  inputSummary:   jsonb("input_summary").notNull().default(sql`'{}'::jsonb`),
  decisionOutput: jsonb("decision_output").notNull().default(sql`'{}'::jsonb`),
  confidence:     real("confidence"),
  confidenceTier: text("confidence_tier"),
  wasOverridden:  boolean("was_overridden").notNull().default(false),
  overrideReason: text("override_reason"),
  outcome:        text("outcome"),
  tokensUsed:     integer("tokens_used"),
  costCents:      real("cost_cents"),
  durationMs:     integer("duration_ms"),
  sourceEventId:  integer("source_event_id"),
  flagged:        boolean("flagged").notNull().default(false),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_ai_decision_log_contact_id").on(t.contactId),
  index("idx_ai_decision_log_decision_type").on(t.decisionType),
  index("idx_ai_decision_log_created_at").on(t.createdAt),
]);
export const insertAiDecisionLogSchema = createInsertSchema(aiDecisionLog).omit({ id: true, createdAt: true });
export type AiDecisionLog = typeof aiDecisionLog.$inferSelect;
export type InsertAiDecisionLog = z.infer<typeof insertAiDecisionLogSchema>;

// ─── AI Corrections (#1409) ───────────────────────────────────────────────────
export const aiCorrections = pgTable("ai_corrections", {
  id:               serial("id").primaryKey(),
  decisionLogId:    integer("decision_log_id").references(() => aiDecisionLog.id, { onDelete: "set null" }),
  contactId:        integer("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  decisionType:     text("decision_type").notNull(),
  originalValue:    jsonb("original_value").notNull(),
  correctedValue:   jsonb("corrected_value").notNull(),
  correctionReason: text("correction_reason"),
  correctedBy:      text("corrected_by"),
  sessionId:        text("session_id"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_ai_corrections_decision_type").on(t.decisionType),
  index("idx_ai_corrections_created_at").on(t.createdAt),
  index("idx_ai_corrections_contact_id").on(t.contactId),
]);
export const insertAiCorrectionSchema = createInsertSchema(aiCorrections).omit({ id: true, createdAt: true });
export type AiCorrection = typeof aiCorrections.$inferSelect;
export type InsertAiCorrection = z.infer<typeof insertAiCorrectionSchema>;

// ─── Prompt Versions (#1409) ─────────────────────────────────────────────────
export const promptVersions = pgTable("prompt_versions", {
  id:            serial("id").primaryKey(),
  promptKey:     text("prompt_key").notNull(),
  version:       text("version").notNull(),
  promptText:    text("prompt_text").notNull(),
  modelId:       text("model_id"),
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  effectiveTo:   timestamp("effective_to"),
  deployedBy:    text("deployed_by"),
  notes:         text("notes"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("idx_prompt_versions_key_version").on(t.promptKey, t.version),
  index("idx_prompt_versions_key_active").on(t.promptKey, t.effectiveFrom),
]);
export type PromptVersion = typeof promptVersions.$inferSelect;

// ─── Golden Examples (#1409) ─────────────────────────────────────────────────
export const goldenExamples = pgTable("golden_examples", {
  id:             serial("id").primaryKey(),
  decisionType:   text("decision_type").notNull(),
  inputSnapshot:  jsonb("input_snapshot").notNull(),
  expectedOutput: jsonb("expected_output").notNull(),
  source:         text("source").notNull().default("human_label"),
  label:          text("label"),
  active:         boolean("active").notNull().default(true),
  createdBy:      text("created_by"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_golden_examples_decision_type").on(t.decisionType),
]);
export type GoldenExample = typeof goldenExamples.$inferSelect;

export type InsertExecutiveGoal = z.infer<typeof insertExecutiveGoalSchema>;

// ─── Outbound Pause Control Authority (#1531) ─────────────────────────────────

export const outboundPauseControl = pgTable("outbound_pause_control", {
  id:              serial("id").primaryKey(),
  state:           text("state").notNull(),       // 'paused' | 'activating' | 'unpaused'
  reason:          text("reason"),
  epoch:           bigint("epoch", { mode: "bigint" }).notNull().default(1n),
  actor:           text("actor"),
  idempotencyKey:  text("idempotency_key"),
  committedAt:     timestamp("committed_at", { withTimezone: true }).defaultNow(),
});

export type OutboundPauseControl = typeof outboundPauseControl.$inferSelect;

// ─── Serper Canonical Gateway Control (#1600) ────────────────────────────────
// Singleton row (id=1). All Serper API calls flow through SerperGateway which
// reads/writes this row atomically (fail-closed when missing or malformed).
export const serperControl = pgTable("serper_control", {
  id:                      integer("id").primaryKey(),
  enabled:                 boolean("enabled").notNull().default(false),
  state:                   text("state").notNull().default("closed"), // 'closed' | 'open' | 'half_open'
  consecutiveFailures:     integer("consecutive_failures").notNull().default(0),
  openedAt:                timestamp("opened_at", { withTimezone: true }),
  reasonCode:              text("reason_code"),
  lastFailureAt:           timestamp("last_failure_at", { withTimezone: true }),
  lastSuccessAt:           timestamp("last_success_at", { withTimezone: true }),
  halfOpenProbeClaimedAt:  timestamp("half_open_probe_claimed_at", { withTimezone: true }),
  policyVersion:           integer("policy_version").notNull().default(1),
  lifetimeCalls:           bigint("lifetime_calls", { mode: "number" }).notNull().default(0),
  lifetimeSuccesses:       bigint("lifetime_successes", { mode: "number" }).notNull().default(0),
  lifetimeFailures:        bigint("lifetime_failures", { mode: "number" }).notNull().default(0),
  windowCalls:             integer("window_calls").notNull().default(0),
  windowSuccesses:         integer("window_successes").notNull().default(0),
  windowFailures:          integer("window_failures").notNull().default(0),
  windowStartedAt:         timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
  windowEndsAt:            timestamp("window_ends_at", { withTimezone: true }).notNull(),
  localBudget:             integer("local_budget").notNull().default(50000),
  providerBalance:         integer("provider_balance"),
  yieldWebsites:           bigint("yield_websites", { mode: "number" }).notNull().default(0),
  yieldEmails:             bigint("yield_emails", { mode: "number" }).notNull().default(0),
  yieldPhones:             bigint("yield_phones", { mode: "number" }).notNull().default(0),
  updatedAt:               timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SerperControl = typeof serperControl.$inferSelect;

export const outboundPauseAudit = pgTable("outbound_pause_audit", {
  id:            serial("id").primaryKey(),
  epoch:         bigint("epoch", { mode: "bigint" }).notNull(),
  changeType:    text("change_type").notNull(),   // 'state-transition' | 'metadata-revision' | 'idempotent-return'
  fromState:     text("from_state").notNull(),
  toState:       text("to_state").notNull(),
  actor:         text("actor"),
  correlationId: text("correlation_id"),
  reason:        text("reason"),
  details:       jsonb("details"),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  index("outbound_pause_audit_epoch_idx").on(t.epoch),
  index("outbound_pause_audit_created_at_idx").on(t.createdAt),
]);

export type OutboundPauseAudit = typeof outboundPauseAudit.$inferSelect;

// ─── ZeroBounce Durable Batch Campaign Engine (#1541 / 1540B) ─────────────────

export const zerobounceCampaigns = pgTable("zerobounce_campaigns", {
  id:                   varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  filterDefinition:     jsonb("filter_definition").notNull().default(sql`'{}'::jsonb`),
  initialEligibleTotal: integer("initial_eligible_total").notNull().default(0),
  status:               text("status").notNull().default("active"), // active | completed | cancelled
  createdBy:            text("created_by"),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt:          timestamp("completed_at", { withTimezone: true }),
});
export type ZerobounceCampaign = typeof zerobounceCampaigns.$inferSelect;

export const zerobounceRuns = pgTable("zerobounce_runs", {
  id:              varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId:      varchar("campaign_id").notNull().references(() => zerobounceCampaigns.id, { onDelete: "cascade" }),
  bullJobId:       text("bull_job_id"),
  // running | completed | budget_stopped | cancelled | interrupted | error
  state:           text("state").notNull().default("running"),
  stopReason:      text("stop_reason"),
  cancelRequested: boolean("cancel_requested").notNull().default(false),
  contactLimit:    integer("contact_limit").notNull().default(100),
  claimedCount:    integer("claimed_count").notNull().default(0),
  completedCount:  integer("completed_count").notNull().default(0),
  retryableCount:  integer("retryable_count").notNull().default(0),
  skippedCount:    integer("skipped_count").notNull().default(0),
  errorCount:      integer("error_count").notNull().default(0),
  validCount:      integer("valid_count").notNull().default(0),
  blockedCount:    integer("blocked_count").notNull().default(0),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
  startedAt:       timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt:      timestamp("finished_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("zb_runs_campaign_idx").on(t.campaignId, t.createdAt),
]);
export type ZerobounceRun = typeof zerobounceRuns.$inferSelect;

export const zerobounceAttempts = pgTable("zerobounce_attempts", {
  id:             bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  campaignId:     varchar("campaign_id").notNull().references(() => zerobounceCampaigns.id, { onDelete: "cascade" }),
  runId:          varchar("run_id").notNull().references(() => zerobounceRuns.id, { onDelete: "cascade" }),
  contactId:      integer("contact_id").notNull(),
  // pending | completed | retryable_failed | skipped
  outcome:        text("outcome").notNull().default("pending"),
  providerStatus: text("provider_status"),
  subStatus:      text("sub_status"),
  // none | reserved — 'reserved' is a LOCAL daily-cap reservation, NOT confirmed provider billing
  creditState:    text("credit_state").notNull().default("none"),
  retryable:      boolean("retryable").notNull().default(false),
  errorCode:      text("error_code"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("zb_attempts_campaign_contact_idx").on(t.campaignId, t.contactId),
  index("zb_attempts_run_idx").on(t.runId),
]);
export type ZerobounceAttempt = typeof zerobounceAttempts.$inferSelect;

// ─── Logical Job Control Holds (#1532) ───────────────────────────────────────

export const logicalJobControlHolds = pgTable("logical_job_control_holds", {
  holdId:        varchar("hold_id").primaryKey().default(sql`gen_random_uuid()`),
  logicalJobKey: text("logical_job_key").notNull(),
  reasonCode:    text("reason_code").notNull(), // global_outbound | manual_operator | maintenance | incident | automation_kill_switch | channel_pause
  sourceType:    text("source_type").notNull(), // system | operator | automation | channel
  sourceKey:     text("source_key").notNull(),  // owner identity
  sourceEpoch:   bigint("source_epoch", { mode: "bigint" }),
  ledgerEpoch:   bigint("ledger_epoch", { mode: "bigint" }).notNull(),
  active:        boolean("active").notNull().default(true),
  activatedAt:   timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
  releasedAt:    timestamp("released_at", { withTimezone: true }),
  expiresAt:     timestamp("expires_at", { withTimezone: true }),
  actor:         text("actor"),
  correlationId: text("correlation_id"),
  metadata:      jsonb("metadata"),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("logical_job_holds_active_key_idx").on(t.logicalJobKey).where(sql`${t.active} = true`),
  index("logical_job_holds_expires_idx").on(t.expiresAt).where(sql`${t.active} = true AND ${t.expiresAt} IS NOT NULL`),
]);

export type LogicalJobControlHold = typeof logicalJobControlHolds.$inferSelect;
export type InsertLogicalJobControlHold = typeof logicalJobControlHolds.$inferInsert;

export const logicalJobHoldEvents = pgTable("logical_job_hold_events", {
  id:            bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  holdId:        varchar("hold_id").notNull(),
  eventType:     text("event_type").notNull(), // activated | released | expired | superseded
  logicalJobKey: text("logical_job_key").notNull(),
  reasonCode:    text("reason_code").notNull(),
  sourceKey:     text("source_key").notNull(),
  ledgerEpoch:   bigint("ledger_epoch", { mode: "bigint" }).notNull(),
  actor:         text("actor"),
  correlationId: text("correlation_id"),
  metadata:      jsonb("metadata"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("hold_events_hold_id_idx").on(t.holdId),
  index("hold_events_created_at_idx").on(t.createdAt),
  index("hold_events_logical_job_key_idx").on(t.logicalJobKey, t.createdAt),
]);

export type LogicalJobHoldEvent = typeof logicalJobHoldEvents.$inferSelect;

export const queueReconciliationState = pgTable("queue_reconciliation_state", {
  physicalQueue:  text("physical_queue").primaryKey(),
  desiredState:   text("desired_state"),   // 'paused' | 'running'
  desiredEpoch:   bigint("desired_epoch", { mode: "bigint" }),
  observedState:  text("observed_state"),  // 'paused' | 'running' | null
  observedEpoch:  bigint("observed_epoch", { mode: "bigint" }),
  reconciledAt:   timestamp("reconciled_at", { withTimezone: true }),
  lastAttemptAt:  timestamp("last_attempt_at", { withTimezone: true }),
  lastError:      text("last_error"),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type QueueReconciliationState = typeof queueReconciliationState.$inferSelect;

export const postEnrichmentEnrollmentIntents = pgTable("post_enrichment_enrollment_intents", {
  id:                     bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  dealId:                 integer("deal_id").notNull(),
  contactId:              integer("contact_id").notNull(),
  entityId:               integer("entity_id"),
  idempotencyKey:         text("idempotency_key").notNull().unique(),
  status:                 text("status").notNull().default("pending"), // pending | processing | completed | failed | cancelled
  attempts:               integer("attempts").notNull().default(0),
  lastError:              text("last_error"),
  createdAt:              timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:              timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt:            timestamp("processed_at", { withTimezone: true }),
  eligibleAfter:          timestamp("eligible_after", { withTimezone: true }),
  // ── 0138: Transactional intent fields ─────────────────────────────────────
  // sequenceId: nullable in DB (pre-0138 rows may be null/failed); app always sets on new rows
  sequenceId:             integer("sequence_id"),
  purpose:                varchar("purpose", { length: 100 }),
  channels:               jsonb("channels").$type<string[]>(),
  selectionPolicyVersion: varchar("selection_policy_version", { length: 50 }),
  selectionSnapshot:      jsonb("selection_snapshot").$type<Record<string, unknown>>(),
  // Claim/lease fields for exactly-once processing
  claimToken:             uuid("claim_token"),
  claimedAt:              timestamp("claimed_at", { withTimezone: true }),
  leaseExpiresAt:         timestamp("lease_expires_at", { withTimezone: true }),
  claimedBy:              varchar("claimed_by", { length: 100 }),
  maxAttempts:            integer("max_attempts").notNull().default(5),
  // Terminal outcome classification
  lastErrorCode:          varchar("last_error_code", { length: 100 }),
  lastErrorClass:         varchar("last_error_class", { length: 50 }), // retryable | permanent | terminal_no_op
  completedEnrollmentId:  integer("completed_enrollment_id"),
}, (t) => [
  index("pe_intents_pending_idx").on(t.status, t.eligibleAfter).where(sql`${t.status} = 'pending'`),
  index("pe_intents_deal_idx").on(t.dealId),
  index("pe_intents_claim_idx").on(t.status, t.leaseExpiresAt).where(sql`${t.status} IN ('pending', 'processing')`),
]);

export type PostEnrichmentEnrollmentIntent = typeof postEnrichmentEnrollmentIntents.$inferSelect;

export const backlogReleaseRuns = pgTable("backlog_release_runs", {
  id:             varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scope:          text("scope").notNull(),  // logical_job_key or '*'
  limits:         jsonb("limits").notNull(), // { chunkSize, ratePerMin, maxTotal }
  actor:          text("actor").notNull(),
  stage:          text("stage").notNull().default("pending"), // pending | running | completed | aborted | failed
  cursor:         jsonb("cursor"),
  abortRequested: boolean("abort_requested").notNull().default(false),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt:      timestamp("started_at", { withTimezone: true }),
  completedAt:    timestamp("completed_at", { withTimezone: true }),
  abortedAt:      timestamp("aborted_at", { withTimezone: true }),
  stats:          jsonb("stats"),
});

export type BacklogReleaseRun = typeof backlogReleaseRuns.$inferSelect;
