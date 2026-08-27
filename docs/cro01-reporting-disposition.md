# CRO-01 Reporting Disposition

| Surface | Disposition | CRO-01 treatment |
| --- | --- | --- |
| `/api/analytics/pipeline` | **MIGRATE** | Uses the revenue read authority's uncapped SQL aggregate over non-archived production deals in request scope. The existing `sales` and `onboarding` response shape is retained. |
| `/api/kpi/summary` | **ADAPT** | It remains a broader KPI endpoint. Its pipeline/revenue portions are not the canonical pipeline report and require separate adaptation before being treated as CRO-01 authority. |
| `/api/kpi/pipeline-stats` | **EXCLUDED** | No active route with this path is implemented in the current server route inventory. |
| Reporting operations | **EXCLUDED** | Other analytics/reporting operations remain outside this change; no capped client-snapshot reporting operation is silently relabeled canonical. |
| Acquisition ROI calculator | **EXCLUDED** | Acquisition ROI calculation is not a CRO-01 revenue read authority and is not changed by this work. |

Only the pipeline analytics endpoint is migrated here. The disposition does not
change write behavior, data classification, or create a database migration.