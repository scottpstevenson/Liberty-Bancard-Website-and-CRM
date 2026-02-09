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
  topCostDrivers: text("top_cost_drivers").array(),
  recommendedPath: text("recommended_path"),
  terminalRecommendation: text("terminal_recommendation"),
  fundingNotes: text("funding_notes"),
  goLiveDate: timestamp("go_live_date"),
  notes: text("notes"),
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
