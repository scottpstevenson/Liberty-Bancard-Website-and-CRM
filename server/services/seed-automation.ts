import { storage } from "../storage";

const STAGE_RULES = [
  {
    name: "New Lead → Welcome Task",
    pipeline: "sales",
    fromStage: null,
    toStage: "New Lead",
    actions: [
      { type: "create_task", title: "Welcome call - introduce Liberty Bancard", assignedTo: "Scott Stevenson", priority: "high", dueHours: 4 },
      { type: "send_notification", channel: "internal", title: "New Lead Entered Pipeline", message: "A new lead has entered the sales pipeline. Schedule initial contact within 4 hours." },
      { type: "enroll_sequence", sequenceName: "1. Switch & Save — Statement Audit" },
    ],
    enabled: true,
    priority: 10,
  },
  {
    name: "Statement Received → Review Task",
    pipeline: "sales",
    fromStage: "New Lead",
    toStage: "Statement Received",
    actions: [
      { type: "create_task", title: "Review merchant statement and prepare analysis", assignedTo: "Scott Stevenson", priority: "high", dueHours: 2 },
      { type: "send_notification", channel: "internal", title: "Statement Ready for Review", message: "Merchant statement received. Complete analysis within 2-hour SLA." },
    ],
    enabled: true,
    priority: 10,
  },
  {
    name: "Review In Progress → Analysis Task",
    pipeline: "sales",
    fromStage: "Statement Received",
    toStage: "Review In Progress",
    actions: [
      { type: "create_task", title: "Complete fee analysis and build proposal", assignedTo: "Scott Stevenson", priority: "medium", dueHours: 24 },
    ],
    enabled: true,
    priority: 10,
  },
  {
    name: "Call Booked → Prep Task",
    pipeline: "sales",
    fromStage: "Review In Progress",
    toStage: "Call Booked",
    actions: [
      { type: "create_task", title: "Prepare statement analysis for review call", assignedTo: "Scott Stevenson", priority: "high", dueHours: 4 },
      { type: "send_notification", channel: "internal", title: "Review Call Booked", message: "Merchant has booked a review call. Prepare analysis before the call." },
    ],
    enabled: true,
    priority: 10,
  },
  {
    name: "Proposal Sent → Follow-up Sequence",
    pipeline: "sales",
    fromStage: "Call Booked",
    toStage: "Proposal Sent",
    actions: [
      { type: "create_task", title: "Follow up on proposal within 48 hours", assignedTo: "Scott Stevenson", priority: "high", dueHours: 48 },
      { type: "send_notification", channel: "internal", title: "Proposal Sent", message: "Proposal delivered. Follow-up sequence activated." },
      { type: "enroll_sequence", sequenceName: "18. Objection Crusher — Overcome Hesitation" },
    ],
    enabled: true,
    priority: 10,
  },
  {
    name: "Negotiation / Follow-Up → Close Prep",
    pipeline: "sales",
    fromStage: "Proposal Sent",
    toStage: "Negotiation / Follow-Up",
    actions: [
      { type: "create_task", title: "Prepare final terms and address objections", assignedTo: "Scott Stevenson", priority: "high", dueHours: 24 },
      { type: "send_notification", channel: "internal", title: "Deal In Negotiation", message: "Merchant is actively negotiating. Prioritize closing." },
    ],
    enabled: true,
    priority: 10,
  },
  {
    name: "Verbal Commit → Collect Documents",
    pipeline: "sales",
    fromStage: "Negotiation / Follow-Up",
    toStage: "Verbal Commit",
    actions: [
      { type: "create_task", title: "Collect application, voided check, and owner ID", assignedTo: "Scott Stevenson", priority: "high", dueHours: 24 },
      { type: "send_notification", channel: "internal", title: "Verbal Commit Received!", message: "Merchant committed. Collect paperwork ASAP to prevent deal cooling." },
    ],
    enabled: true,
    priority: 10,
  },
  {
    name: "Closed Won → Onboarding Kickoff",
    pipeline: "sales",
    fromStage: "Verbal Commit",
    toStage: "Closed Won",
    actions: [
      { type: "create_task", title: "Initiate onboarding - submit application to processor", assignedTo: "Scott Stevenson", priority: "high", dueHours: 4 },
      { type: "send_notification", channel: "internal", title: "Deal Closed Won!", message: "New merchant signed! Begin onboarding process immediately." },
      { type: "enroll_sequence", sequenceName: "3. Fast Approval — Application Completion" },
    ],
    enabled: true,
    priority: 10,
  },
  {
    name: "Closed Lost → Win-Back",
    pipeline: "sales",
    fromStage: null,
    toStage: "Closed Lost",
    actions: [
      { type: "create_task", title: "Log loss reason and schedule 90-day reactivation", assignedTo: "Scott Stevenson", priority: "low", dueHours: 72 },
      { type: "enroll_sequence", sequenceName: "19. Reactivation — Cold Lead Revival" },
    ],
    enabled: true,
    priority: 5,
  },
];

const DEMO_PROSPECTS = [
  { companyName: "Mario's Italian Kitchen", ownerFirstName: "Mario", ownerLastName: "Bianchi", email: "mario@mariositalian.com", phone: "305-555-0101", vertical: "restaurant", city: "Miami", state: "FL", estimatedVolume: "$45,000", estimatedProcessor: "Toast", score: "hot", qualificationScore: "A", status: "enriched" },
  { companyName: "Sunshine Auto Repair", ownerFirstName: "James", ownerLastName: "Carter", email: "james@sunshineauto.com", phone: "407-555-0102", vertical: "auto_repair", city: "Orlando", state: "FL", estimatedVolume: "$28,000", estimatedProcessor: "Square", score: "hot", qualificationScore: "A", status: "enriched" },
  { companyName: "Coastal Dental Group", ownerFirstName: "Dr. Sarah", ownerLastName: "Nguyen", email: "sarah@coastaldental.com", phone: "561-555-0103", vertical: "medical", city: "Boca Raton", state: "FL", estimatedVolume: "$62,000", estimatedProcessor: "Worldpay", score: "hot", qualificationScore: "A", status: "enriched" },
  { companyName: "Fresh Cuts Barbershop", ownerFirstName: "Darnell", ownerLastName: "Washington", email: "darnell@freshcuts.com", phone: "954-555-0104", vertical: "retail", city: "Fort Lauderdale", state: "FL", estimatedVolume: "$12,000", estimatedProcessor: "Clover", score: "warm", qualificationScore: "B", status: "enriched" },
  { companyName: "Tampa Bay Tire Center", ownerFirstName: "Miguel", ownerLastName: "Rodriguez", email: "miguel@tbtire.com", phone: "813-555-0105", vertical: "auto_repair", city: "Tampa", state: "FL", estimatedVolume: "$35,000", estimatedProcessor: "First Data", score: "hot", qualificationScore: "A", status: "enriched" },
  { companyName: "Oceanside Pet Hospital", ownerFirstName: "Dr. Lisa", ownerLastName: "Park", email: "lisa@oceansidevet.com", phone: "239-555-0106", vertical: "medical", city: "Naples", state: "FL", estimatedVolume: "$40,000", estimatedProcessor: "Chase", score: "warm", qualificationScore: "B", status: "enriched" },
  { companyName: "Golden Dragon Chinese", ownerFirstName: "Wei", ownerLastName: "Chen", email: "wei@goldendragonfl.com", phone: "305-555-0107", vertical: "restaurant", city: "Miami", state: "FL", estimatedVolume: "$22,000", estimatedProcessor: "Stripe", score: "warm", qualificationScore: "B", status: "enriched" },
  { companyName: "Premier Plumbing Services", ownerFirstName: "Robert", ownerLastName: "Johnson", email: "rob@premierplumbing.com", phone: "904-555-0108", vertical: "retail", city: "Jacksonville", state: "FL", estimatedVolume: "$18,000", estimatedProcessor: "Square", score: "warm", qualificationScore: "B", status: "enriched" },
  { companyName: "Lakewood Family Practice", ownerFirstName: "Dr. Ahmed", ownerLastName: "Hassan", email: "ahmed@lakewoodfp.com", phone: "407-555-0109", vertical: "medical", city: "Orlando", state: "FL", estimatedVolume: "$55,000", estimatedProcessor: "Elavon", score: "hot", qualificationScore: "A", status: "enriched" },
  { companyName: "Beach Bum Taco Shack", ownerFirstName: "Chris", ownerLastName: "Martinez", email: "chris@beachbumtacos.com", phone: "727-555-0110", vertical: "restaurant", city: "St. Petersburg", state: "FL", estimatedVolume: "$30,000", estimatedProcessor: "Toast", score: "warm", qualificationScore: "B", status: "enriched" },
  { companyName: "Elite Fitness Studio", ownerFirstName: "Amanda", ownerLastName: "Brooks", email: "amanda@elitefitness.com", phone: "561-555-0111", vertical: "retail", city: "West Palm Beach", state: "FL", estimatedVolume: "$15,000", estimatedProcessor: "Mindbody", score: "cold", qualificationScore: "C", status: "enriched" },
  { companyName: "Gator Collision Center", ownerFirstName: "Tommy", ownerLastName: "Baker", email: "tommy@gatorcollision.com", phone: "352-555-0112", vertical: "auto_repair", city: "Gainesville", state: "FL", estimatedVolume: "$42,000", estimatedProcessor: "TSYS", score: "hot", qualificationScore: "A", status: "enriched" },
  { companyName: "Bella Spa & Salon", ownerFirstName: "Maria", ownerLastName: "Gonzalez", email: "maria@bellaspafl.com", phone: "305-555-0113", vertical: "retail", city: "Coral Gables", state: "FL", estimatedVolume: "$20,000", estimatedProcessor: "Square", score: "warm", qualificationScore: "B", status: "enriched" },
  { companyName: "Southeast Roofing Co", ownerFirstName: "Kevin", ownerLastName: "Thompson", email: "kevin@seroofing.com", phone: "850-555-0114", vertical: "retail", city: "Tallahassee", state: "FL", estimatedVolume: "$65,000", estimatedProcessor: "QuickBooks", score: "hot", qualificationScore: "A", status: "enriched" },
  { companyName: "Pho Saigon Vietnamese", ownerFirstName: "Tran", ownerLastName: "Nguyen", email: "tran@phosaigonfl.com", phone: "813-555-0115", vertical: "restaurant", city: "Tampa", state: "FL", estimatedVolume: "$18,000", estimatedProcessor: "Clover", score: "cold", qualificationScore: "C", status: "enriched" },
  { companyName: "Precision Auto Glass", ownerFirstName: "Steve", ownerLastName: "Williams", email: "steve@precisionglass.com", phone: "954-555-0116", vertical: "auto_repair", city: "Pembroke Pines", state: "FL", estimatedVolume: "$25,000", estimatedProcessor: "Authorize.net", score: "warm", qualificationScore: "B", status: "enriched" },
  { companyName: "Sunrise Pediatrics", ownerFirstName: "Dr. Jennifer", ownerLastName: "Kim", email: "jennifer@sunrisepeds.com", phone: "954-555-0117", vertical: "medical", city: "Sunrise", state: "FL", estimatedVolume: "$48,000", estimatedProcessor: "Worldpay", score: "hot", qualificationScore: "A", status: "enriched" },
  { companyName: "Havana Nights Cuban Grill", ownerFirstName: "Carlos", ownerLastName: "Fernandez", email: "carlos@havananights.com", phone: "305-555-0118", vertical: "restaurant", city: "Hialeah", state: "FL", estimatedVolume: "$33,000", estimatedProcessor: "Toast", score: "warm", qualificationScore: "B", status: "enriched" },
  { companyName: "Clearwater Marine Supply", ownerFirstName: "Dave", ownerLastName: "Nelson", email: "dave@clearwatermarine.com", phone: "727-555-0119", vertical: "retail", city: "Clearwater", state: "FL", estimatedVolume: "$50,000", estimatedProcessor: "First Data", score: "hot", qualificationScore: "A", status: "enriched" },
  { companyName: "Palm Coast Eye Center", ownerFirstName: "Dr. Michael", ownerLastName: "Patel", email: "michael@palmcoasteye.com", phone: "386-555-0120", vertical: "medical", city: "Palm Coast", state: "FL", estimatedVolume: "$72,000", estimatedProcessor: "Chase", score: "hot", qualificationScore: "A", status: "enriched" },
  { companyName: "Lucky's Quick Lube", ownerFirstName: "Larry", ownerLastName: "Davis", email: "larry@luckysql.com", phone: "863-555-0121", vertical: "auto_repair", city: "Lakeland", state: "FL", estimatedVolume: "$16,000", estimatedProcessor: "Square", score: "cold", qualificationScore: "C", status: "enriched" },
  { companyName: "Island Breeze Smoothie Bar", ownerFirstName: "Kayla", ownerLastName: "Brown", email: "kayla@islandbreeze.com", phone: "239-555-0122", vertical: "restaurant", city: "Fort Myers", state: "FL", estimatedVolume: "$8,000", estimatedProcessor: "Stripe", score: "cold", qualificationScore: "C", status: "enriched" },
  { companyName: "Advanced Physical Therapy", ownerFirstName: "Dr. John", ownerLastName: "Miller", email: "john@advancedpt.com", phone: "321-555-0123", vertical: "medical", city: "Melbourne", state: "FL", estimatedVolume: "$38,000", estimatedProcessor: "Elavon", score: "warm", qualificationScore: "B", status: "enriched" },
  { companyName: "Florida Keys Dive Shop", ownerFirstName: "Brian", ownerLastName: "O'Connor", email: "brian@fkdiveshop.com", phone: "305-555-0124", vertical: "retail", city: "Key West", state: "FL", estimatedVolume: "$22,000", estimatedProcessor: "PayPal", score: "warm", qualificationScore: "B", status: "enriched" },
  { companyName: "Magnolia Southern Kitchen", ownerFirstName: "Patricia", ownerLastName: "Lee", email: "patricia@magnoliask.com", phone: "850-555-0125", vertical: "restaurant", city: "Pensacola", state: "FL", estimatedVolume: "$27,000", estimatedProcessor: "Heartland", score: "warm", qualificationScore: "B", status: "enriched" },
];

export async function seedStageRules() {
  const existing = await storage.getStageAutomationRules();
  if (existing.length >= 6) {
    console.log(`[Seed] ${existing.length} stage rules already exist, skipping.`);
    return;
  }

  for (const rule of STAGE_RULES) {
    const exists = existing.find(e => e.name === rule.name);
    if (exists) continue;
    await storage.createStageAutomationRule({
      name: rule.name,
      pipeline: rule.pipeline,
      fromStage: rule.fromStage,
      toStage: rule.toStage,
      actions: rule.actions,
      enabled: rule.enabled,
      priority: rule.priority,
    });
  }
  console.log(`[Seed] ${STAGE_RULES.length} stage automation rules seeded.`);
}

export async function seedDemoProspects() {
  const lists = await storage.getProspectLists();
  const demoList = lists.find(l => l.name === "Florida Business Leads - Demo");
  if (demoList && (demoList.totalRecords || 0) >= 20) {
    console.log(`[Seed] Demo prospect list already exists with ${demoList.totalRecords} records, skipping.`);
    return;
  }

  let listId: number;
  if (demoList) {
    listId = demoList.id;
  } else {
    const newList = await storage.createProspectList({
      name: "Florida Business Leads - Demo",
      description: "25 pre-enriched Florida business prospects across restaurant, auto, medical, and retail verticals",
      totalRecords: DEMO_PROSPECTS.length,
      enrichedRecords: DEMO_PROSPECTS.length,
      qualifiedRecords: DEMO_PROSPECTS.filter(p => p.qualificationScore === "A" || p.qualificationScore === "B").length,
      status: "completed",
      uploadedBy: "system",
    });
    listId = newList.id;
  }

  const existingProspects = await storage.getProspects(listId);
  const existingEmails = new Set(existingProspects.map(p => p.email));

  let created = 0;
  for (const p of DEMO_PROSPECTS) {
    if (existingEmails.has(p.email)) continue;
    await storage.createProspect({
      listId,
      companyName: p.companyName,
      ownerFirstName: p.ownerFirstName,
      ownerLastName: p.ownerLastName,
      email: p.email,
      phone: p.phone,
      vertical: p.vertical,
      city: p.city,
      state: p.state,
      estimatedVolume: p.estimatedVolume,
      estimatedProcessor: p.estimatedProcessor,
      score: p.score,
      qualificationScore: p.qualificationScore,
      status: p.status,
      aiSummary: `${p.vertical} business in ${p.city}, FL processing ~${p.estimatedVolume}/mo on ${p.estimatedProcessor}. ${p.score === "hot" ? "High switching potential." : p.score === "warm" ? "Moderate interest signals." : "Early stage prospect."}`,
      aiPitchAngle: p.estimatedProcessor === "Square" || p.estimatedProcessor === "Stripe"
        ? "Flat-rate to interchange-plus savings opportunity"
        : p.estimatedProcessor === "Toast"
        ? "Restaurant-specific pricing with better terminal options"
        : "Competitive rate review and service upgrade",
      tags: [p.vertical, p.score, p.state.toLowerCase()],
    });
    created++;
  }

  if (!demoList) {
    await storage.updateProspectList(listId, {
      totalRecords: DEMO_PROSPECTS.length,
      enrichedRecords: DEMO_PROSPECTS.length,
      status: "completed",
    });
  }

  console.log(`[Seed] ${created} demo prospects created in list #${listId}.`);
}
