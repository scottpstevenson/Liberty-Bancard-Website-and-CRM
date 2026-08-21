# 24-Hour Launch Checklist — Liberty Bancard CRM

**Prepared:** July 26, 2026 | See `docs/go-live-audit-report-2026.md` for full context

> Complete phases in order. Do NOT unpause outbound until Phase 1 is fully confirmed ✅.

**Who runs this:** Engineering lead + operator (admin-role CRM user). Estimated time: 60–90 minutes.

---

## Phase 1 — Pre-Launch Infrastructure (T-24h)

### 1. Run Full Pre-Deploy Suite
```bash
bash scripts/run-pre-deploy.sh
```
- [ ] **All mandatory suites exit 0** — `✅  PRE-DEPLOY GATE PASSED — all suites green.`
- [ ] If it fails: fix the failing suite and re-run before continuing.

### 2. Run Full Go-Live Journey Check
```bash
npx tsx scripts/go-live-check.ts
```
- [ ] **All blocking stages show ✅ GO** (exit 0)
- [ ] Stage 5 WARN (test-domain email) is expected and non-blocking
- [ ] Stage 6: confirm `defaultSequenceId` is populated (owner maps this in Step 10 below)

### 3. Confirm Outbound Kill Switch Is ON
```sql
SELECT key, value FROM system_settings WHERE key LIKE '%Paused%';
```
- [ ] `outboundGlobalPaused` = `true`
- [ ] `emailChannelPaused` = `true`
- [ ] `smsChannelPaused` = `true`
- [ ] `coldEmailChannelPaused` = `true`

If any are missing or false:
```sql
UPDATE system_settings SET value='true'
WHERE key IN ('outboundGlobalPaused','emailChannelPaused','smsChannelPaused','coldEmailChannelPaused');
```

### 4. ✅ SMTP / SendGrid — DONE
- [x] `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_PORT` set in Replit Secrets (July 26, 2026)
- [ ] Send and confirm test email via Activation Panel or SendGrid "Verify Integration"

### 5. Refresh GHL Private Integration Token
- [ ] GHL → Settings → Private Integrations → Liberty Bancard → verify token is not expired
- [ ] If expired: regenerate → update `GHL_PRIVATE_INTEGRATION_TOKEN` in Replit Secrets → restart server
- [ ] Verify: Activation Panel → GHL Auth Test = **"Connected"**

### 6. Set GHL Ed25519 Webhook Public Key
- [ ] GHL → Settings → Integrations → Webhooks → Public Key (Ed25519 tab) → copy key
- [ ] Set `GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY` in Replit Secrets → restart server

### 7. Set Admin Email & Error Monitoring
- [ ] Set `ADMIN_DIGEST_EMAIL` in Replit Secrets (removes hardcoded `scott@libertybancard.com` fallback)
- [ ] Create Sentry project at sentry.io → set `SENTRY_DSN` in Replit Secrets → restart
- [ ] Confirm `[Sentry] initialized` in startup logs

### 8. Fix Redis Connection Timeouts
- [ ] Upstash Console → verify connection count and error rate
- [ ] Confirm `REDIS_URL` is current in Replit Secrets
- [ ] Upgrade to Pay-As-You-Go tier if on free plan
- [ ] Restart → confirm no `[WizardFlags] timeout` lines in startup logs

### 9. Verify SPF / DKIM / DMARC records
```bash
dig TXT libertybancard.com +short | grep spf
dig TXT s1._domainkey.libertybancard.com +short | grep DKIM
dig TXT _dmarc.libertybancard.com +short | grep DMARC
```
- [ ] All three records return values — if any are missing, add them in DNS before enabling email sequences

### 10. Confirm Redis / BullMQ queue health
- [ ] Go to `/dashboard/operator` → Job Queue tab
- [ ] All 11 queues show "Active" with recent last-run timestamps
- [ ] If any queue is stalled: restart the server

---

## Phase 2 — Data Hygiene (T-24h)

### 11. Clean Up Test Contacts
```bash
npx tsx scripts/purge-test-contacts.ts --dry-run   # preview only
npx tsx scripts/purge-test-contacts.ts              # execute
```
- [ ] Dry-run reviewed → purge executed (or documented as retained test artifacts)
- [ ] Verify: `Remaining test contacts: 0`

### 12. Map Default Enrollment Sequence
- [ ] Dashboard → Operator Dashboard → New Lead Enrollment tab
- [ ] Select ACTIVE sequence as default (or configure per-vertical mapping)
- [ ] **Do NOT** enable Auto-Enroll yet — wait until T+1h monitoring confirms clean initial traffic
- [ ] Verify: `SELECT value FROM system_settings WHERE key='defaultNewLeadSequenceId';` — must return a sequence ID

### 13. Set GHL Inbound Confirmation Workflow
- [ ] In GHL: create or locate the inbound confirmation workflow → copy workflow ID
- [ ] Set `GHL_WORKFLOW_INBOUND_CONFIRMATION` in Replit Secrets → restart server

### 14. Screenshot admin health dashboard
- [ ] Go to `/dashboard/admin/health` → confirm all services green
- [ ] Save screenshot as release evidence

---

## Phase 3 — Launch Moment (T-0)

### 15. Verify server is running on production URL
```bash
curl -sf https://your-production-domain.com/api/health
```
- [ ] Returns `{"status":"ok"}`

### 16. Submit a live test lead through the public form
1. Open a private/incognito browser window
2. Go to `/get-started` or `/free-analysis`
3. Fill in a real email address (yours) and phone number → submit
4. **Verify:**
   - [ ] Contact appears in CRM Contacts list within 30 seconds
   - [ ] Deal appears in Sales Pipeline → New Lead stage
   - [ ] GHL contact is created (check GHL dashboard)
   - [ ] You receive the inbound confirmation email within 2 minutes
5. **After verification:** Delete this test contact from the CRM

### 17. Enable outbound (one channel at a time)

> Wait 30 minutes between enabling each channel. Monitor the Operator Dashboard between steps.

- [ ] **Email first (lowest risk):** Admin → Activation Panel → Email → Enable
  - Wait 30 min → bounce rate < 2%, no anomaly alerts
- [ ] **SMS (after email confirmed healthy):** Confirm A2P 10DLC is active → Admin → Activation Panel → SMS → Enable
- [ ] **Cold outreach (enable last):** Confirm CAN-SPAM mailing address is correct in sequence footer → Admin → Activation Panel → Cold Email → Enable

---

## Phase 4 — First 24-Hour Monitoring (T+1h → T+24h)

| Time | Action |
|---|---|
| T+1h | Operator Dashboard — send volume, reply rate, bounce rate |
| T+1h | Admin → Queue Metrics → DLQ items = 0 |
| T+4h | Admin → GHL Identity Conflicts → empty or resolving |
| T+12h | Confirm db-backup completed in logs (or Neon PITR active) |
| T+24h | Re-run `npx tsx scripts/go-live-check.ts` → all blocking stages GO |

**Pause immediately if:** Bounce > 2% · Unsubscribe > 0.5% · Any anomaly alert · DLQ items > 10

### T+24h: Enable New Lead auto-enroll (if volume is healthy)
1. Go to `/dashboard/operator` → New Lead Enrollment
2. Toggle "Auto-Enroll New Leads" to ON
3. Monitor for the next hour — every new inbound lead will be enrolled automatically
4. Verify: `SELECT value FROM system_settings WHERE key='autoEnrollNewLeadDeals';` — must return `true`

### T+24h: Review deliverability in GHL
- GHL → Email → Deliverability Report
- Bounce rate < 5%, Complaint rate < 0.1%
- If either threshold exceeded: pause email channel immediately and investigate list quality

---

## Emergency Pause Procedures

### Pause all outbound immediately
```sql
UPDATE system_settings SET value='true'
WHERE key IN ('outboundGlobalPaused','emailChannelPaused','smsChannelPaused','coldEmailChannelPaused');
```
Or via UI: Admin → Activation Panel → Master Pause → On

### Pause only email
```sql
UPDATE system_settings SET value='true' WHERE key='emailChannelPaused';
```

### Pause only SMS
```sql
UPDATE system_settings SET value='true' WHERE key='smsChannelPaused';
```

### Remove a specific contact from all sequences
```sql
UPDATE sequence_enrollments SET status='cancelled', updated_at=NOW()
WHERE contact_id = <contactId> AND status='active';
```

### Rollback procedure
1. **Pause all outbound:** Admin → Activation Panel → Master Pause → On
2. **Roll back code:** Replit → History → Checkpoints → select checkpoint → Restore
3. **Diagnose:** `audit_logs` table records every activation event; check `/api/admin/alerts` and `/api/admin/queue-metrics`

---

## Sign-Off

| Step | Completed By | Time |
|---|---|---|
| Pre-deploy gate: PASSED | | |
| Go-live journey: GO | | |
| Outbound kill switch confirmed ON | | |
| SMTP test email confirmed | | |
| GHL token verified | | |
| Ed25519 webhook key set | | |
| Test data purged | | |
| Default sequence mapped | | |
| SPF/DKIM/DMARC verified | | |
| Live test lead submitted + verified | | |
| Outbound enabled (email first) | | |
| T+1h monitoring: clean | | |
| T+24h review: GO | | |

**Launch authorized by:** _________________________ **Date/Time:** _________________________

---

*Generated as part of Go-Live Audit Report — July 26, 2026*
