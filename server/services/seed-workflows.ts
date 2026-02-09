import { storage } from "../storage";

const PREBUILT_WORKFLOWS = [
  {
    name: "A. Statement Upload Intake",
    triggerType: "form_submitted",
    triggerConfig: { formType: "statement_upload" },
    actions: [
      { type: "create_task", title: "Review statement + send breakdown", assignedTo: "Scott Stevenson", priority: "high", dueHours: 2 },
      { type: "send_notification", channel: "internal", title: "New Statement Upload", message: "Statement uploaded - 2hr SLA to review", notificationType: "alert" },
      { type: "update_contact_tags", addTags: ["src_website", "lead_statement_upload"] },
      { type: "create_audit_log", logAction: "statement_intake_workflow" },
    ],
    enabled: true,
  },
  {
    name: "B. Estimate Request Intake",
    triggerType: "form_submitted",
    triggerConfig: { formType: "estimate" },
    actions: [
      { type: "create_task", title: "Qualify estimate lead + request statement", assignedTo: "Scott Stevenson", priority: "medium", dueHours: 4 },
      { type: "send_notification", channel: "internal", title: "New Estimate Request", message: "Estimate form submitted - qualify and request statement", notificationType: "info" },
      { type: "update_contact_tags", addTags: ["src_website", "lead_estimate"] },
      { type: "send_ghl_email", subject: "Thanks for your interest - Liberty Bancard", body: "<p>Hi {{contact.firstName}},</p><p>Thanks for requesting an estimate. To give you an accurate breakdown, we'll need your most recent processing statement.</p><p>You can upload it here: [UPLOAD_LINK]</p><p>Or reply to this email with the statement attached. Once we review it, we'll have real numbers to show you - no guesswork.</p><p>Best,<br/>Liberty Bancard Team</p><p style='font-size:11px;color:#999;'>Eligibility, underwriting, card brand rules, and applicable laws apply.</p>" },
      { type: "create_audit_log", logAction: "estimate_intake_workflow" },
    ],
    enabled: true,
  },
  {
    name: "C. Appointment Booked",
    triggerType: "deal_stage_changed",
    triggerConfig: { toStage: "Call Booked" },
    actions: [
      { type: "create_task", title: "Prepare for review call - pull statement analysis", assignedTo: "Scott Stevenson", priority: "high", dueHours: 1 },
      { type: "send_notification", channel: "internal", title: "Call Booked", message: "Review call booked - prepare statement analysis", notificationType: "info" },
      { type: "send_ghl_sms", body: "Hi {{contact.firstName}}, your call with Liberty Bancard is confirmed. We'll walk through your statement breakdown. Talk soon!" },
      { type: "send_ghl_email", subject: "Your Review Call is Confirmed", body: "<p>Hi {{contact.firstName}},</p><p>Your call is confirmed. During our 10-minute review, we'll cover:</p><ul><li>Your current effective rate</li><li>Where your fees are going</li><li>Your options for a better structure</li></ul><p>No pressure, no obligation - just real numbers from your statement.</p><p>Best,<br/>Liberty Bancard Team</p><p style='font-size:11px;color:#999;'>Eligibility, underwriting, card brand rules, and applicable laws apply.</p>" },
      { type: "create_audit_log", logAction: "appointment_booked_workflow" },
    ],
    enabled: true,
  },
  {
    name: "D. No-Show Rescue",
    triggerType: "deal_sla_breach",
    triggerConfig: { stage: "Call Booked", maxMinutes: 1440 },
    actions: [
      { type: "send_ghl_sms", body: "Hi {{contact.firstName}}, looks like we missed connecting. Want to reschedule your free 10-min statement review? Reply YES and we'll set it up." },
      { type: "wait", hours: 24 },
      { type: "send_ghl_email", subject: "We saved your analysis - reschedule anytime", body: "<p>Hi {{contact.firstName}},</p><p>We noticed we weren't able to connect for your statement review call. No worries - your analysis is saved and ready whenever you are.</p><p>Pick a new time that works: {{calendarLink}}</p><p>We'll keep your data on file so you won't need to resubmit anything.</p><p>Best,<br/>Liberty Bancard Team</p><p style='font-size:11px;color:#999;'>Eligibility, underwriting, card brand rules, and applicable laws apply.</p>" },
      { type: "create_task", title: "No-show follow-up - attempt reschedule", assignedTo: "Scott Stevenson", priority: "medium", dueHours: 48 },
      { type: "create_audit_log", logAction: "no_show_rescue_workflow" },
    ],
    enabled: true,
  },
  {
    name: "E. Proposal Follow-Up Cadence",
    triggerType: "deal_stage_changed",
    triggerConfig: { toStage: "Proposal Sent" },
    actions: [
      { type: "create_task", title: "Follow up on proposal - check if merchant reviewed", assignedTo: "Scott Stevenson", priority: "medium", dueHours: 48 },
      { type: "wait", hours: 48 },
      { type: "send_ghl_sms", body: "Hi {{contact.firstName}}, just checking if you had a chance to review the processing analysis we sent. Any questions? Happy to walk through the numbers." },
      { type: "wait", hours: 72 },
      { type: "send_ghl_email", subject: "Quick follow-up on your processing review", body: "<p>Hi {{contact.firstName}},</p><p>Just following up on the statement analysis we sent over. A few merchants in {{contact.vertical}} have seen great results switching to our recommended program.</p><p>Want to do a quick 5-minute recap? {{calendarLink}}</p><p>Best,<br/>Liberty Bancard Team</p><p style='font-size:11px;color:#999;'>Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.</p>" },
      { type: "wait", hours: 120 },
      { type: "send_ghl_email", subject: "Last check-in on your processing options", body: "<p>Hi {{contact.firstName}},</p><p>This is our last follow-up on the processing analysis we prepared for {{contact.companyName}}.</p><p>Your analysis is saved and ready whenever you want to revisit. Just reply to this email or book a call: {{calendarLink}}</p><p>We're here when you need us.</p><p>Best,<br/>Liberty Bancard Team</p><p style='font-size:11px;color:#999;'>Eligibility, underwriting, card brand rules, and applicable laws apply.</p>" },
      { type: "create_audit_log", logAction: "proposal_followup_workflow" },
    ],
    enabled: true,
  },
  {
    name: "F. Closed Won - Onboarding Kickoff",
    triggerType: "deal_stage_changed",
    triggerConfig: { toStage: "Closed Won" },
    actions: [
      { type: "update_deal", stage: "Contract Sent", notes: "Deal won - moved to onboarding pipeline" },
      { type: "create_task", title: "Send application + collect docs", assignedTo: "Scott Stevenson", priority: "high", dueHours: 2 },
      { type: "create_task", title: "Order terminal (if applicable)", assignedTo: "Scott Stevenson", priority: "medium", dueHours: 24 },
      { type: "send_notification", channel: "internal", title: "New Deal Won!", message: "Deal closed won - begin onboarding immediately", notificationType: "success" },
      { type: "send_ghl_email", subject: "Welcome to Liberty Bancard - Next Steps", body: "<p>Hi {{contact.firstName}},</p><p>Welcome aboard! We're excited to get {{contact.companyName}} set up with better processing.</p><p><strong>Here's what happens next:</strong></p><ol><li>We'll send your application (takes ~5 minutes to complete)</li><li>Underwriting review (typically 24-48 hours)</li><li>Terminal setup and configuration (if applicable)</li><li>Go-live and first batch</li></ol><p>You'll have a dedicated point of contact throughout. We'll keep you updated at every step.</p><p>Best,<br/>Liberty Bancard Team</p>" },
      { type: "send_ghl_sms", body: "Welcome to Liberty Bancard, {{contact.firstName}}! Your application is on its way. We'll guide you through every step. Questions? Just reply here." },
      { type: "update_contact_tags", addTags: ["status_onboarding", "closed_won"] },
      { type: "create_audit_log", logAction: "closed_won_onboarding_workflow" },
    ],
    enabled: true,
  },
  {
    name: "G. Go-Live Lifecycle (Day 2/7/14/30)",
    triggerType: "go_live_milestone",
    triggerConfig: {},
    actions: [
      { type: "wait", hours: 48 },
      { type: "send_ghl_sms", body: "Hi {{contact.firstName}}, it's day 2 with Liberty Bancard! How did your first batch go? Any questions about deposits or your terminal? Reply anytime." },
      { type: "create_task", title: "Day 2 check-in: verify first batch processed", assignedTo: "Scott Stevenson", priority: "medium", dueHours: 4 },
      { type: "wait", hours: 120 },
      { type: "send_ghl_email", subject: "One week in - how's everything running?", body: "<p>Hi {{contact.firstName}},</p><p>It's been a week since you went live with Liberty Bancard. How's everything going?</p><p>A few things to check:</p><ul><li>Are deposits landing on time?</li><li>Is the terminal working as expected?</li><li>Any questions about your statement?</li></ul><p>If anything needs attention, just reply to this email or call us directly.</p><p>Best,<br/>Liberty Bancard Team</p>" },
      { type: "create_task", title: "Day 7 check-in: confirm merchant satisfaction + request review", assignedTo: "Scott Stevenson", priority: "medium", dueHours: 24 },
      { type: "request_review", reviewUrl: "[GOOGLE_REVIEW_LINK]" },
      { type: "wait", hours: 168 },
      { type: "send_ghl_email", subject: "Two weeks in - quick check", body: "<p>Hi {{contact.firstName}},</p><p>Just a quick 2-week check-in. We want to make sure everything is running smoothly.</p><p>If you have any questions about your first full statement, we're happy to walk through it with you.</p><p>Best,<br/>Liberty Bancard Team</p>" },
      { type: "wait", hours: 336 },
      { type: "send_ghl_email", subject: "Your first full month - let's review", body: "<p>Hi {{contact.firstName}},</p><p>Congratulations on your first full month with Liberty Bancard!</p><p>Your first complete statement should be available now. Want us to review it together to make sure everything looks right?</p><p>Book a quick call: {{calendarLink}}</p><p>Best,<br/>Liberty Bancard Team</p>" },
      { type: "create_task", title: "Day 30: Review first full statement with merchant", assignedTo: "Scott Stevenson", priority: "medium", dueHours: 48 },
      { type: "update_contact_tags", addTags: ["milestone_30_days"] },
      { type: "create_audit_log", logAction: "go_live_lifecycle_workflow" },
    ],
    enabled: true,
  },
  {
    name: "H. Case Study Request",
    triggerType: "deal_stage_changed",
    triggerConfig: { toStage: "Active (30 Days)" },
    actions: [
      { type: "create_task", title: "Evaluate merchant for case study potential", assignedTo: "Scott Stevenson", priority: "low", dueHours: 168 },
      { type: "wait", hours: 72 },
      { type: "send_ghl_email", subject: "Would you share your experience?", body: "<p>Hi {{contact.firstName}},</p><p>You've been with Liberty Bancard for 30 days now, and we'd love to hear about your experience.</p><p>Would you be open to a quick 5-minute interview? We'll share the final piece with you before publishing, and your story could help other {{contact.vertical}} businesses make better decisions about their processing.</p><p>No pressure at all - just reply YES if you're interested!</p><p>Best,<br/>Liberty Bancard Team</p>" },
      { type: "create_audit_log", logAction: "case_study_request_workflow" },
    ],
    enabled: true,
  },
  {
    name: "I. Support SLA Escalation",
    triggerType: "ticket_sla_breach",
    triggerConfig: {},
    actions: [
      { type: "create_task", title: "URGENT: SLA breached - respond to ticket immediately", assignedTo: "Support Team", priority: "high", dueHours: 0.5 },
      { type: "send_notification", channel: "internal", title: "SLA Breach Alert", message: "A support ticket has breached its SLA deadline. Immediate response required.", notificationType: "urgent" },
      { type: "create_audit_log", logAction: "support_sla_escalation_workflow" },
    ],
    enabled: true,
  },
];

const DEFAULT_SLA_CONFIGS = [
  { name: "Statement Review 2hr", entityType: "deal", stage: "Statement Received", maxDurationMinutes: 120, escalationAction: "create_task_and_notify", isActive: true },
  { name: "New Lead 24hr Follow-up", entityType: "deal", stage: "New Lead", maxDurationMinutes: 1440, escalationAction: "create_task_and_notify", isActive: true },
  { name: "Proposal Follow-up 48hr", entityType: "deal", stage: "Proposal Sent", maxDurationMinutes: 2880, escalationAction: "create_task_and_notify", isActive: true },
  { name: "Call Booked No-Show 24hr", entityType: "deal", stage: "Call Booked", maxDurationMinutes: 1440, escalationAction: "create_task_and_notify", isActive: true },
  { name: "Support Ticket 4hr SLA", entityType: "ticket", stage: null, maxDurationMinutes: 240, escalationAction: "escalate_ticket", isActive: true },
];

const DEFAULT_MESSAGE_TEMPLATES = [
  {
    name: "Proposal Email",
    category: "proposal",
    channel: "email",
    subject: "Your Processing Analysis is Ready - {{contact.companyName}}",
    body: `<p>Hi {{contact.firstName}},</p>
<p>We've completed our review of your processing statement. Here's what we found:</p>
<ul>
<li><strong>Current Effective Rate:</strong> {{deal.effectiveRate}}</li>
<li><strong>Monthly Volume:</strong> {{deal.totalVolume}}</li>
<li><strong>Current Fees:</strong> {{deal.totalFees}}</li>
<li><strong>Top Cost Drivers:</strong> {{deal.topCostDrivers}}</li>
<li><strong>Recommended Path:</strong> {{deal.recommendedPath}}</li>
</ul>
<p><strong>Next Step:</strong> <a href="{{calendarLink}}">Book a 10-minute call</a> to walk through the numbers together.</p>
<p>Best,<br/>Liberty Bancard Team</p>
<p style="font-size:11px;color:#999;">Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.</p>`,
    mergeFields: ["contact.firstName", "contact.companyName", "deal.effectiveRate", "deal.totalVolume", "deal.totalFees", "deal.topCostDrivers", "deal.recommendedPath", "calendarLink"],
    isActive: true,
  },
  {
    name: "Follow-Up SMS",
    category: "follow_up",
    channel: "sms",
    subject: null,
    body: "Hi {{contact.firstName}}, just checking in on the processing analysis we sent over. Had a chance to review? Happy to answer any questions - reply here or book a call: {{calendarLink}}",
    mergeFields: ["contact.firstName", "calendarLink"],
    isActive: true,
  },
  {
    name: "Welcome Onboarding Email",
    category: "onboarding",
    channel: "email",
    subject: "Welcome to Liberty Bancard - Let's Get Started",
    body: `<p>Hi {{contact.firstName}},</p>
<p>Welcome to Liberty Bancard! We're excited to get {{contact.companyName}} set up.</p>
<p><strong>Your onboarding checklist:</strong></p>
<ol>
<li>Complete the merchant application (5 min)</li>
<li>Provide a voided check or bank letter</li>
<li>Confirm terminal/equipment needs</li>
</ol>
<p>We'll keep you updated through every step. Questions? Reply to this email anytime.</p>
<p>Best,<br/>Liberty Bancard Team</p>`,
    mergeFields: ["contact.firstName", "contact.companyName"],
    isActive: true,
  },
  {
    name: "Day 7 Review Request",
    category: "review_request",
    channel: "email",
    subject: "How's your experience with Liberty Bancard?",
    body: `<p>Hi {{contact.firstName}},</p>
<p>It's been a week since your switch to Liberty Bancard. We hope everything's running smoothly!</p>
<p>Would you take 30 seconds to share your experience? <a href="[GOOGLE_REVIEW_LINK]">Leave a Review</a></p>
<p>Your feedback helps other business owners make better processing decisions.</p>
<p>Best,<br/>Liberty Bancard Team</p>`,
    mergeFields: ["contact.firstName"],
    isActive: true,
  },
  {
    name: "30-Day Nurture Email",
    category: "nurture",
    channel: "email",
    subject: "Still thinking about your processing?",
    body: `<p>Hi {{contact.firstName}},</p>
<p>We know switching processors is a big decision. No rush - but we wanted to check in.</p>
<p>Your statement analysis is saved and the numbers haven't changed. When you're ready, we're here.</p>
<p><a href="{{calendarLink}}">Book a 5-minute recap</a> whenever it works for you.</p>
<p>Best,<br/>Liberty Bancard Team</p>
<p style="font-size:11px;color:#999;">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>`,
    mergeFields: ["contact.firstName", "calendarLink"],
    isActive: true,
  },
  {
    name: "90-Day Reactivation Email",
    category: "reactivation",
    channel: "email",
    subject: "Your free processing review is still available",
    body: `<p>Hi {{contact.firstName}},</p>
<p>It's been a while since we last connected. Just wanted to let you know your processing review is still available.</p>
<p>A lot can change in a few months - new card brand rules, rate adjustments, new programs. If your current processor hasn't reviewed your rates lately, it might be time.</p>
<p>Want a fresh look? <a href="{{calendarLink}}">Book a 10-minute review</a> - no obligation.</p>
<p>Best,<br/>Liberty Bancard Team</p>
<p style="font-size:11px;color:#999;">Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.</p>`,
    mergeFields: ["contact.firstName", "calendarLink"],
    isActive: true,
  },
  {
    name: "Nurture SMS",
    category: "nurture",
    channel: "sms",
    subject: null,
    body: "Hi {{contact.firstName}}, your Liberty Bancard statement analysis is still ready. Want to revisit the numbers? Reply or book: {{calendarLink}}",
    mergeFields: ["contact.firstName", "calendarLink"],
    isActive: true,
  },
  {
    name: "Support Acknowledgment",
    category: "support",
    channel: "email",
    subject: "We received your support request - Liberty Bancard",
    body: `<p>Hi {{contact.firstName}},</p>
<p>We received your support request and a team member will be in touch shortly.</p>
<p>Our typical response time is within 4 hours during business hours.</p>
<p>Best,<br/>Liberty Bancard Support Team</p>`,
    mergeFields: ["contact.firstName"],
    isActive: true,
  },
];

const DEFAULT_COLLATERAL_PACKETS = [
  {
    name: "Wholesale Pricing Packet",
    offerPath: "Wholesale",
    vertical: null,
    tags: ["wholesale"],
    pages: ["/assets/one-pagers/why-liberty", "/assets/one-pagers/how-statement-review-works", "/assets/one-pagers/hidden-fees-checklist"],
    description: "Standard wholesale pricing overview for cost-plus merchants. Includes why Liberty, statement review process, and hidden fees checklist.",
    isActive: true,
  },
  {
    name: "0% Processing Program Packet",
    offerPath: "0% Program",
    vertical: null,
    tags: ["zero-percent", "cash-discount"],
    pages: ["/assets/0-percent/overview", "/assets/0-percent/compliance-checklist", "/assets/terminal/qd4"],
    description: "Cash discount / surcharge program overview with compliance checklist and terminal specs.",
    isActive: true,
  },
  {
    name: "Terminal Solutions Packet",
    offerPath: "Terminal Needed",
    vertical: null,
    tags: ["terminal", "equipment"],
    pages: ["/assets/terminal/qd4", "/assets/terminal/go-live-checklist", "/assets/one-pagers/funding-deposits-clarity"],
    description: "Liberty Smart Terminal features, go-live checklist, and funding/deposit information.",
    isActive: true,
  },
  {
    name: "Square/Stripe Comparison Packet",
    offerPath: "Compare vs Square/Stripe",
    vertical: null,
    tags: ["comparison", "flat-rate"],
    pages: ["/assets/compare/beat-square-stripe", "/assets/one-pagers/why-liberty", "/assets/one-pagers/hidden-fees-checklist"],
    description: "Head-to-head comparison against flat-rate processors with supporting materials.",
    isActive: true,
  },
  {
    name: "Medical/Dental/Medspa Packet",
    offerPath: null,
    vertical: "Medical/Dental/Medspa",
    tags: ["medical", "dental", "medspa", "healthcare"],
    pages: ["/assets/verticals/medical", "/assets/case-studies/medical-front-desk", "/assets/0-percent/overview", "/assets/terminal/qd4"],
    description: "Healthcare-specific processing solutions with case study, 0% program info, and terminal specs.",
    isActive: true,
  },
  {
    name: "Restaurant Packet",
    offerPath: null,
    vertical: "Restaurant",
    tags: ["restaurant", "food-service"],
    pages: ["/assets/verticals/restaurant", "/assets/case-studies/restaurant-tips-speed", "/assets/terminal/qd4"],
    description: "Restaurant processing solutions with case study and terminal configuration for high-volume use.",
    isActive: true,
  },
];

export async function seedDefaultData() {
  try {
    const existingWorkflows = await storage.getWorkflows();
    const existingNames = new Set(existingWorkflows.map(w => w.name));
    const newWorkflows = PREBUILT_WORKFLOWS.filter(wf => !existingNames.has(wf.name));
    if (newWorkflows.length > 0) {
      console.log(`Seeding ${newWorkflows.length} pre-built workflows...`);
      for (const wf of newWorkflows) {
        await storage.createWorkflow(wf);
      }
      console.log(`Seeded ${newWorkflows.length} workflows`);
    }

    const existingSlaConfigs = await storage.getSlaConfigs();
    if (existingSlaConfigs.length === 0) {
      console.log("Seeding SLA configurations...");
      for (const config of DEFAULT_SLA_CONFIGS) {
        await storage.createSlaConfig(config);
      }
      console.log(`Seeded ${DEFAULT_SLA_CONFIGS.length} SLA configs`);
    }

    const existingTemplates = await storage.getMessageTemplates();
    if (existingTemplates.length === 0) {
      console.log("Seeding message templates...");
      for (const template of DEFAULT_MESSAGE_TEMPLATES) {
        await storage.createMessageTemplate(template);
      }
      console.log(`Seeded ${DEFAULT_MESSAGE_TEMPLATES.length} message templates`);
    }

    const existingPackets = await storage.getCollateralPackets();
    if (existingPackets.length === 0) {
      console.log("Seeding collateral packets...");
      for (const packet of DEFAULT_COLLATERAL_PACKETS) {
        await storage.createCollateralPacket(packet);
      }
      console.log(`Seeded ${DEFAULT_COLLATERAL_PACKETS.length} collateral packets`);
    }
  } catch (err) {
    console.error("Seed error:", err);
  }
}
