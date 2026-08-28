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

## HTTP authorization certification (Task #1718)

The CRO-03 HTTP boundary is certified independently of worker and provider
execution. `scripts/test-cro03-http-authorization.ts` uses direct HTTP
requests against a server configured with an approved disposable test database;
its fixtures are local batch rows only and it never invokes a worker or provider.

| Route | Anonymous / agent | Owner Manager A | Non-owner Manager B | Admin |
|---|---|---|---|---|
| `POST /api/cro03/batches` | 401 / 403 | allowed | allowed | allowed |
| `GET /api/cro03/batches/:id` | 401 / 403 | 200 for own batch | exact minimal 404 | 200 for any batch |
| `POST /api/cro03/batches/:id/cancel` | 401 / 403 | allowed for own batch | exact minimal 404 | allowed for any batch |
| `GET /api/cro03/reconciliation` | 401 / 403 | 403 | 403 | 200 |
| `GET /api/cro03/policy` | 401 / 403 | 403 | 403 | 200 |

Malformed batch UUIDs return the same minimal 404 (`{"code":"not_found",
"message":"Not found"}`) to authorized admin/manager callers. A foreign batch
uses exactly that response too, so batch existence and owner identity are not
disclosed.

`scripts/scan-cro03-client-endpoints.ts` is a separate fail-closed static
client audit. It rejects retired request-detached enrichment endpoint usage and
requires retirement/disabled vocabulary where such a surface is presented; it
does not treat a legacy "enriched" success claim as truthful CRO-03 status.
