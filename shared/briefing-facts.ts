export type BriefingFacts = {
  tasksDueToday: number | null;
  overdueTaskCount: number | null;
  overdueSlaCount: number | null;
  inboundEventCount: number | null;
  outreachReadyCount: number | null;
  closedWonYesterday: number | null;
};
/** Numbers/status are never delegated to model prose. Optional model output is
 * deliberately not presented as a factual summary, including contradictions. */
export function briefingFactsSummary(facts: BriefingFacts, _modelProse?: string | null): string {
  const count = (value: number | null) => value === null ? "unavailable" : String(value);
  return `Tasks due today: ${count(facts.tasksDueToday)}. Overdue tasks: ${count(facts.overdueTaskCount)}. `
    + `SLA breaches: ${count(facts.overdueSlaCount)}. Scoped contact inbound events today: ${count(facts.inboundEventCount)}. `
    + `Outreach membership: ${count(facts.outreachReadyCount)} (permission and pause remain separate). `
    + `Deals won yesterday: ${count(facts.closedWonYesterday)}.`;
}
