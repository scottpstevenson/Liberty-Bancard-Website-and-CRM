import type { OperationsReportData } from "@shared/operations-report";
import { residualExportCell } from "./residual-observation-export";

type Cell = string | number | null;

/** A downloaded report keeps the reader's scope, clocks, units and model provenance. */
export function operationsReportCsv(headers: string[], rows: Cell[][], report: OperationsReportData) {
  const { meta } = report;
  const provenanceHeaders = [
    "Period days", "Period start inclusive", "Period end exclusive", "Timezone",
    "Period basis", "Scope", "As of", "Snapshot consistency", "Source capture windows",
    "Count/ratio units", "Sequence reply completeness", "Incident period start inclusive",
    "Incident period end exclusive", "Task as of", "User-entered spend estimate",
    "Currency (model assumption)", "Expense kind", "Allocation assumption", "Authoritative spend source",
  ];
  const provenance: Cell[] = [
    report.days, meta.period.startInclusive, meta.period.endExclusive, meta.period.timezone,
    meta.period.basis, meta.scope, meta.asOf, meta.snapshotConsistency, JSON.stringify(meta.sourceCapture),
    JSON.stringify(meta.units), meta.completeness.sequenceReplies, meta.operationalPeriods.incidentsStartInclusive,
    meta.operationalPeriods.incidentsEndExclusive, meta.operationalPeriods.tasksAsOf, report.adSpend,
    meta.spendAllocation.currency, meta.spendAllocation.kind, meta.spendAllocation.assumption, "Unavailable",
  ];
  const serialize = (row: Cell[]) => row.map(cell =>
    `"${String(residualExportCell(cell)).replace(/"/g, '""')}"`).join(",");
  // Keep provenance even for an authorized loaded-empty export, without manufacturing a data row.
  return [
    serialize(["Report metadata", ...provenanceHeaders]), serialize(["Metadata only", ...provenance]),
    serialize([...headers, ...provenanceHeaders]),
    ...rows.map(row => serialize([...row, ...provenance])),
  ].join("\r\n");
}
