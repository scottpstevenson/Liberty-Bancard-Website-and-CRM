-- Task #2003: durable per-call Serper usage log.
--
-- serper_control (id=1) only tracks aggregate counters for the CURRENT
-- billing window plus lifetime totals -- it cannot answer "how many calls
-- came from which feature, on which day". This table adds one row per
-- SerperGateway.executeSearch() attempt (success, provider error, or
-- gateway block) so usage can be broken down by day and by call site.
--
-- Written best-effort from inside the gateway: a logging failure never
-- blocks or fails the underlying search call (see logCall() in
-- server/services/serper-gateway.ts).
CREATE TABLE IF NOT EXISTS serper_call_log (
  id           SERIAL PRIMARY KEY,
  call_site    TEXT NOT NULL,
  endpoint     TEXT NOT NULL,
  outcome      TEXT NOT NULL,
  block_reason TEXT,
  http_status  INTEGER,
  error_text   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS serper_call_log_created_at_idx ON serper_call_log (created_at);
CREATE INDEX IF NOT EXISTS serper_call_log_call_site_idx ON serper_call_log (call_site, created_at);
