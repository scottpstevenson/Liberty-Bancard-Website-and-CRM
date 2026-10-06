// Existing SLA defaults, shared by discovery and the final transactional
// eligibility check. Moving them does not change budgets, timing or schedules.
export const DEFAULT_SLA_RULES = [
  {name:"Speed-to-Lead 60min",entityType:"deal",stage:"New Lead",maxDurationMinutes:60,escalationAction:"create_task_and_notify"},
  {name:"Statement Review 2hr SLA",entityType:"deal",stage:"Statement Received",maxDurationMinutes:120,escalationAction:"create_task_and_notify"},
  {name:"New Lead 24hr Follow-up",entityType:"deal",stage:"New Lead",maxDurationMinutes:1440,escalationAction:"create_task_and_notify"},
  {name:"Statement Requested 48hr Chase",entityType:"deal",stage:"Statement Requested",maxDurationMinutes:2880,escalationAction:"create_task_and_notify"},
  {name:"Proposal Follow-up 48hr",entityType:"deal",stage:"Proposal Sent",maxDurationMinutes:2880,escalationAction:"create_task_and_notify"},
  {name:"Call Booked No Update 24hr",entityType:"deal",stage:"Call Booked",maxDurationMinutes:1440,escalationAction:"create_task_and_notify"},
  {name:"Support Ticket SLA Breach",entityType:"ticket",stage:null,maxDurationMinutes:0,escalationAction:"escalate_ticket"},
];
