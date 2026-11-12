/**
 * Phase 6 Today / Pipeline / Reports contracts (no database): every Today queue row is one independent read whose failure is
 * "Unavailable", never zero; the Pipeline opens focused with its secondary stages counted but held back; every Reports figure opens
 * the exact list it counted using the destination's own predicate; dense worklists and the Intake entrance keep their facts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  COCKPIT_DESTINATIONS, appointmentRow, cockpitPermissions, cockpitRowText, intakeRow, unassignedRow, unreadRow, upcomingAppointmentCount,
} from "../client/src/lib/today-cockpit";
import { SECONDARY_SALES_STAGES, dealCardFacts, focusedBoardStages } from "../client/src/lib/pipeline-focus";
import { isOpenTicket, ticketCohortLabel, ticketInCohort } from "../client/src/lib/ticket-cohort";
import {
  buildPipelineStageHref, buildTicketCohortHref, pipelineStageSelection, reportDrilldowns, ticketCohortState, todayDestinations,
} from "../client/src/lib/crm-destination-state";

let checks = 0;
const ok = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const eq = <T>(actual: T, expected: T, message: string) => { assert.deepEqual(actual, expected, message); checks++; };
const read = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// ── CRM-21 Today queue rows ─────────────────────────────────────────────────────────────────────────────────────────
const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({ items, complete: true, hasMoreKnown: false, sourceStatus: [], ...extra }) as never;
eq(unreadRow({ isLoading: true, isError: false, data: undefined }).state, "loading", "a loading inbox is loading");
const failedInbox = unreadRow({ isLoading: false, isError: true, data: undefined });
ok(failedInbox.value === null && failedInbox.state === "unavailable" && failedInbox.note?.includes("not an all-clear"), "a failed inbox is unavailable, never zero");
eq(cockpitRowText(failedInbox), "Unavailable", "an unavailable row prints Unavailable");
eq(unreadRow({ isLoading: false, isError: false, data: page([]) }).value, 0, "a complete empty inbox is a real zero");
const partialInbox = unreadRow({ isLoading: false, isError: false, data: page([{}, {}], { complete: false }) });
ok(partialInbox.value === 2 && partialInbox.qualifier === "or more" && partialInbox.state === "partial", "an incomplete list is a lower bound");
eq(cockpitRowText(partialInbox), "2 or more", "a lower bound reads 'or more'");
const incompleteEmpty = unreadRow({ isLoading: false, isError: false, data: page([], { complete: false }) });
ok(incompleteEmpty.value === null, "an empty but incomplete inbox is not zero");

eq(intakeRow({ isLoading: false, isError: false, data: { needsReview: 3 } }).value, 3, "intake reports the server count");
eq(intakeRow({ isLoading: false, isError: false, data: { needsReview: 3 } }).href, "/dashboard/lead-ops?tab=pipeline", "intake opens the existing Intake destination");
for (const data of [undefined, { needsReview: null }, { needsReview: Number.NaN }] as const) {
  eq(intakeRow({ isLoading: false, isError: false, data: data as never }).value, null, "an unreadable intake count is null, not zero");
}
eq(intakeRow({ isLoading: false, isError: true, data: { needsReview: 0 } }).state, "unavailable", "an errored read is unavailable even with stale data");

const open = [{ status: "pending", assignedTo: null }, { status: "in_progress", canonicalAssignee: "a@x.test" }, { status: "completed", assignedTo: null }, { status: "pending", assignedTo: "  " }];
const unassigned = unassignedRow({ isLoading: false, isError: false, data: open });
ok(unassigned.value === 2 && unassigned.note?.includes("Counted in the 3 open tasks you can see"), "unassigned counts open unowned work and states its population");
ok(unassigned.note?.includes("Nothing is assigned automatically"), "the row says nothing is assigned");
eq(unassigned.href, todayDestinations.unassignedTasks, "unassigned opens the exact unassigned cohort");
eq(unassignedRow({ isLoading: false, isError: true, data: undefined }).value, null, "a failed task read is unavailable");

const now = new Date("2026-11-11T15:00:00Z");
const day = 86_400_000;
const appts = { appointments: [
  { startTime: now.getTime() + day, status: "confirmed" }, { startTime: new Date(now.getTime() + 2 * day).toISOString(), status: "booked" },
  { startTime: now.getTime() + 3 * day, status: "Cancelled" }, { startTime: now.getTime() + 4 * day, status: "no_show" },
  { startTime: now.getTime() - day, status: "confirmed" }, { startTime: now.getTime() + 8 * day, status: "confirmed" }, { startTime: "bad", status: "confirmed" },
] };
eq(upcomingAppointmentCount(appts, now, 7), 2, "only active appointments inside the window count");
eq(appointmentRow({ isLoading: false, isError: false, data: appts }, now).value, 2, "the row uses the same count");
ok(appointmentRow({ isLoading: false, isError: false, data: { configured: false } }, now).note?.includes("not connected"), "a missing calendar is stated, not counted as zero");
eq(appointmentRow({ isLoading: false, isError: false, data: { status: "not_configured" } }, now).value, null, "not configured has no count");
eq(appointmentRow({ isLoading: false, isError: true, data: undefined }, now).state, "unavailable", "a failed calendar read is unavailable");
eq(appointmentRow({ isLoading: false, isError: false, data: { appointments: [] } }, now).value, 0, "a configured calendar with none is zero");
eq(cockpitPermissions("agent"), { intake: false, unassigned: false }, "agents do not see management queues");
eq(cockpitPermissions("manager"), { intake: true, unassigned: true }, "managers see them");
eq(cockpitPermissions(undefined), { intake: false, unassigned: false }, "an unknown role sees none");
eq(COCKPIT_DESTINATIONS.inbox, "/dashboard/comms-hub", "unread opens the Inbox");

const queue = read("client/src/components/dashboard/TodayWorkQueue.tsx");
ok(queue.includes("enabled: permitted.intake") && queue.includes("enabled: permitted.unassigned"), "management reads are not even requested for agents");
ok(queue.includes("response.status === 409") && queue.includes("not_configured"), "the calendar's not-configured answer is handled");
ok(!/\?\? 0\b|\|\| 0\b/.test(queue), "the queue component never defaults a count to zero");
ok(read("client/src/pages/dashboard/Overview.tsx").includes("<TodayWorkQueue role={user?.role} />") && read("client/src/pages/dashboard/Overview.tsx").includes("section-daily-briefing-disclosure"), "Today shows the queue and keeps the briefing behind a disclosure");
ok(read("client/src/pages/dashboard/SalesRepHome.tsx").includes("<TodayWorkQueue role={user?.role} />"), "the rep home shows the same queue");

// ── CRM-21 Intake entrance ──────────────────────────────────────────────────────────────────────────────────────────
const leadOps = read("client/src/pages/dashboard/LeadOpsCenter.tsx");
ok(leadOps.includes("Intake: website requests") && leadOps.includes('data-testid="card-inbound-operations"'), "the website-request card is titled Intake and keeps its test id");
ok(leadOps.includes('data-testid="details-pipeline-maintenance"') && /<details[^>]*details-pipeline-maintenance/.test(leadOps.replace(/\s+/g, " ")), "maintenance panels sit behind a collapsed disclosure");
ok(!/<details[^>]*details-pipeline-maintenance[^>]*\sopen[\s>]/.test(leadOps), "the maintenance disclosure is collapsed by default");
ok(read("client/src/pages/dashboard/TasksAppointments.tsx").includes('data-testid="link-work-intake"'), "Work links to Intake for management");
ok(read("client/src/pages/dashboard/CommsHub.tsx").includes("Open Intake") && read("client/src/pages/dashboard/CommsHub.tsx").includes("link-site-scope-inbound-operations"), "Inbox cross-links to Intake");

// ── CRM-21 Pipeline focus ───────────────────────────────────────────────────────────────────────────────────────────
const stages = ["New Lead", "Contacted", "Proposal", "Closed Won", "Closed Lost", "Nurture / Not Now", "Legacy Stage"];
const counts: Record<string, number> = { "Closed Won": 4, "Closed Lost": 9, "Nurture / Not Now": 2 };
const countFor = (stage: string) => counts[stage] ?? 0;
const focused = focusedBoardStages({ stages, showAll: false, countFor });
eq(focused.visible, ["New Lead", "Contacted", "Proposal", "Legacy Stage"], "the focused board holds active and unknown stages");
eq(focused.hidden, [{ stage: "Closed Won", count: 4 }, { stage: "Closed Lost", count: 9 }, { stage: "Nurture / Not Now", count: 2 }], "held-back stages keep their counts");
eq(focused.visible.length + focused.hidden.length, focused.total, "every stage is either shown or counted");
eq(focusedBoardStages({ stages, showAll: true, countFor }).visible, stages, "show all restores every stage in order");
ok(focusedBoardStages({ stages, showAll: false, selectedStage: "Closed Won", countFor }).visible.includes("Closed Won"), "a selected deal's stage is always visible");
eq(focusedBoardStages({ stages, showAll: false, pinnedStage: "Closed Lost", countFor }), { visible: ["Closed Lost"], hidden: [], total: stages.length }, "a pinned stage shows only that stage");
eq(focusedBoardStages({ stages, showAll: false, pinnedStage: "Not A Stage", countFor }).visible, focused.visible, "an unknown pin falls back to the focused default");
eq([...SECONDARY_SALES_STAGES], ["Closed Won", "Closed Lost", "Nurture / Not Now"], "the secondary set is exactly terminal and parked stages");

const facts = dealCardFacts({ stage: "Proposal", owner: " Sam ", nextFollowUp: "2026-11-10T12:00:00Z", updatedAt: "2026-11-08T15:00:00Z" }, now);
ok(facts.owner.text === "Sam" && facts.lastUpdated.text === "Updated 3d ago" && facts.nextAction.state === "overdue" && facts.blockers.includes("Follow-up overdue"), "an overdue follow-up is a stated blocker");
const bare = dealCardFacts({ stage: "Contacted" }, now);
ok(bare.owner.state === "none" && bare.lastUpdated.state === "unknown" && bare.nextAction.state === "none", "missing facts are named as missing");
eq(bare.blockers, ["No next action", "No owner"], "a deal with no owner and no follow-up lists both");
eq(dealCardFacts({ stage: "Closed Won" }, now).blockers, [], "a closed deal has no open blockers");
eq(dealCardFacts({ stage: "Proposal", assignedTo: "legacy@x.test", nextFollowUp: "2026-11-20T12:00:00Z", updatedAt: now }, now).owner.text, "legacy@x.test", "the legacy assignee is used when no owner is recorded");
eq(dealCardFacts({ stage: "Proposal", updatedAt: "garbage" }, now).lastUpdated.state, "unknown", "an invalid update time is unknown");
const pipeline = read("client/src/pages/dashboard/Pipeline.tsx");
for (const id of ["pipeline-secondary-stages", "button-show-all-stages", "pipeline-all-stages-note", "button-focus-active-stages", "deal-card-facts-", "pipeline-stage-pin", "button-clear-stage-pin"]) ok(pipeline.includes(id), `Pipeline renders ${id}`);

// ── CRM-22 Reports drilldowns ───────────────────────────────────────────────────────────────────────────────────────
eq(reportDrilldowns.overdueTasks, "/dashboard/tasks-appointments?tab=tasks&due=overdue", "overdue tasks open the overdue cohort Today also uses");
eq(reportDrilldowns.overdueTasks, todayDestinations.overdueTasks, "Reports and Today share one overdue destination");
eq(reportDrilldowns.openTickets, "/dashboard/support-hub?tab=tickets&ticketState=open", "open tickets open the open-ticket cohort");
eq(reportDrilldowns.slaBreaches, "/dashboard/support-hub?tab=tickets&ticketState=open&ticketSla=breached", "SLA breaches open the breached cohort");
eq(reportDrilldowns.winLoss, "/dashboard/reporting?tab=win-loss", "win rate opens the Win/Loss report");
eq(buildPipelineStageHref("Closed Won"), "/dashboard/pipeline?stage=Closed+Won", "a stage count opens that stage");
eq(buildTicketCohortHref({ state: "all" }), "/dashboard/support-hub?tab=tickets", "clearing the cohort returns the full list");
eq(ticketCohortState("?ticketState=open&ticketSla=breached"), { state: "open", sla: "breached", issues: [] }, "both selectors parse");
const badCohort = ticketCohortState("?ticketState=sideways&ticketSla=breached&ticketSla=all");
ok(badCohort.state === "all" && badCohort.sla === "all" && badCohort.issues.length === 2, "an invalid or conflicting selector is reported and never broadens into a different cohort");
eq(pipelineStageSelection("?stage=Closed+Won", stages), { stage: "Closed Won", issues: [] }, "a recorded stage is selectable");
const badStage = pipelineStageSelection("?stage=Nope", stages);
ok(badStage.stage === null && badStage.issues.length === 1, "an unrecorded stage is reported and ignored");
eq(pipelineStageSelection("?stage=Closed+Won&stage=Closed+Lost", stages).stage, null, "conflicting stages select nothing");

const asOf = new Date("2026-11-11T15:00:00Z");
const tickets = [
  { status: "New Ticket", slaDeadline: "2026-11-10T00:00:00Z" }, { status: "Open", slaDeadline: "2026-11-12T00:00:00Z" }, { status: null, slaDeadline: null },
  { status: "In Progress", slaDeadline: "2026-11-11T14:59:59Z" }, { status: "Resolved", slaDeadline: "2026-11-01T00:00:00Z" }, { status: "Closed", slaDeadline: null },
];
const count = (cohort: Parameters<typeof ticketInCohort>[1]) => tickets.filter(t => ticketInCohort(t, cohort, asOf)).length;
eq(count({ state: "open", sla: "all" }), 4, "open means everything not Resolved or Closed, including no status (the analytics definition)");
eq(count({ state: "open", sla: "breached" }), 2, "breached is open with a deadline before as-of");
eq(count({ state: "resolved", sla: "all" }), 2, "resolved covers Resolved and Closed");
eq(count({ state: "all", sla: "all" }), 6, "no cohort keeps everything");
eq(count({ state: "resolved", sla: "breached" }), 0, "a resolved ticket is never breached");
ok(isOpenTicket({ status: undefined }) && !isOpenTicket({ status: "Closed" }), "open-ticket predicate");
eq(ticketCohortLabel({ state: "all", sla: "all" }), null, "no label without a cohort");
ok(ticketCohortLabel({ state: "open", sla: "breached" })?.includes("past their SLA"), "the breached cohort is labelled");

const reporting = read("client/src/pages/dashboard/Reporting.tsx");
for (const id of ["link-card-kpi-winrate", "link-card-kpi-active-pipeline", "link-card-kpi-open-tickets", "link-card-kpi-overdue-tasks", "link-sla-breaches", "link-stage-", "details-report-caveats", "text-reporting-scope"]) ok(reporting.includes(id), `Reports renders ${id}`);
ok(!/conversion funnel[^"]*:\s*\d/.test(reporting) && reporting.includes("does not estimate a conversion funnel"), "Reports states it does not fabricate a conversion funnel");
ok(reporting.includes("reporting-unavailable") && reporting.includes("support.meta?.exact"), "Reports still refuses to show inexact aggregates");
const tickets_ = read("client/src/pages/dashboard/Tickets.tsx");
ok(tickets_.includes("ticketInCohort(t, cohort, new Date())") && tickets_.includes("ticket-cohort-banner") && tickets_.includes("button-clear-ticket-cohort"), "Support applies the shared cohort predicate, states it and can clear it");
ok(tickets_.includes("loaded tickets match") && tickets_.includes("tickets are loaded"), "Support states how many tickets were loaded when it is fewer than the total");
const hub = read("client/src/pages/dashboard/ReportingHub.tsx");
ok(hub.includes('title="Reports"') && hub.includes('aria-pressed={activeArea === "sales"}') && hub.includes("aria-label=\"Report areas\""), "Reports title and the selected area are apparent");
const sidebar = read("client/src/lib/employee-sidebar.ts");
ok(/id: "reports", label: "Reports"/.test(sidebar), "the sidebar name matches the Reports page title");
ok((sidebar.match(/\{ id: "/g) ?? []).length === 11, "the sidebar keeps exactly eleven entries");

// ── Dense worklists keep every fact ─────────────────────────────────────────────────────────────────────────────────
const css = read("client/src/styles/crm-theme.css");
ok(css.includes(".crm-dense-worklist :is(td, th)") && !/crm-dense-worklist[^{]*\{[^}]*display:\s*none/.test(css), "dense rows tighten spacing and hide nothing");
for (const [file, id] of [["Tasks.tsx", "tasks-table"], ["Tickets.tsx", "table-tickets-scroll"]] as const) {
  ok(new RegExp(`crm-dense-worklist[^"]*"[^>]*data-testid="${id}"`).test(read(`client/src/pages/dashboard/${file}`)), `${file} uses the dense worklist`);
}
ok(/crm-dense-worklist[^"]*"[^>]*data-testid="inbound-table"/.test(read("client/src/components/lead-ops/InboundRequestList.tsx")), "the intake list uses the dense worklist");

console.log(`phase6 today pipeline reports: ${checks} checks passed`);
