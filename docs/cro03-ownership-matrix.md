# CRO-03 enrichment ownership matrix

This matrix is the acceptance inventory for the durable enrichment factory. A
provider credential or application role never authorizes spend by itself.

| Surface | Subject | Disposition | Durable owner |
|---|---|---|---|
| `POST /api/cro03/batches` | canonical contacts | 202 durable command | QueueManager CRO-03 tick |
| `POST /api/contacts/enrich-batch` | canonical contacts | 202 durable command | QueueManager CRO-03 tick |
| `POST /api/contacts/:id/enrich` | canonical contact | 202 durable command; no offer routing | QueueManager CRO-03 tick |
| Apollo/Outscraper CSV imports | canonical contacts created by intake | evidence-only, no spend | import execution + CRO-03 import evidence |
| legacy prospect enrichment | staging prospect | stable 503 | none until canonical intake |
| Sunbiz single/batch/mass/deep enrichment | staging entity | stable 503 | none until canonical intake |
| Lead Ops bulk enrichment | staging entity | stable 503 | none until canonical intake |
| SDR re-enrichment route/interval | staging merchant | stable 503 / disabled | none until canonical intake |
| SLA worker enrichment sweep | mixed legacy | retired | none |
| QueueManager enrichment repeatable job | canonical CRO-03 items | canonical owner | QueueManager |
| Serper | search-gap evidence | existing SerperGateway budget/circuit authority | SerperGateway |
| ZeroBounce | final winning email only | existing validation-intent/readiness authority | provider readiness worker |
| Apollo | selected organization/person evidence | CRO-03 provider operation/control | CRO-03 worker adapter |
| Outscraper | selected business discovery evidence | CRO-03 provider operation/control | CRO-03 worker adapter |
| public web | free evidence | SafeEgress only | registered factory adapter |
| post-enrichment automation / offers / outreach / GHL | downstream effect | prohibited in CRO-03 | later authority |

Canary definitions are descriptive and non-executable. Apollo and Outscraper
ship with controls disabled and a zero local budget. Enabling them, changing
budgets, creating production batches, or running a production backfill is not
part of CRO-03.
