# 24-Hour Launch Checklist — Liberty Bancard CRM
**Prepared:** July 26, 2026 | See `docs/go-live-audit-report-2026.md` for full context

> Complete phases in order. Do NOT unpause outbound until Phase 1 is fully confirmed ✅.

---

## Phase 1 — Pre-Launch Infrastructure

### 1. Refresh GHL Private Integration Token
- [ ] GHL → Settings → Private Integrations → Liberty Bancard → Regenerate token
- [ ] Set `GHL_PRIVATE_INTEGRATION_TOKEN` in Replit Secrets → restart server
- [ ] Verify: Activation Panel → GHL Auth Test = **"Connected"**

### 2. ✅ SMTP / SendGrid — DONE
- [x] `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_PORT` set in Replit Secrets (July 26 2026)
- [ ] Send and confirm test email via Activation Panel or SendGrid "Verify Integration"

### 3. Set GHL Ed25519 Webhook Public Key
- [ ] GHL → Settings → Integrations → Webhooks → Public Key (Ed25519 tab)
- [ ] Set `GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY` in Replit Secrets

### 4. Set Admin Email & Error Monitoring
- [ ] Set `ADMIN_DIGEST_EMAIL` in Replit Secrets
- [ ] Create Sentry project → set `SENTRY_DSN` in Replit Secrets → restart
- [ ] Confirm `[Sentry] initialized` in startup logs

### 5. Fix Redis Connection Timeouts
- [ ] Upstash Console → verify connection count and error rate
- [ ] Confirm `REDIS_URL` is current in Replit Secrets
- [ ] Upgrade to Pay-As-You-Go tier if on free plan
- [ ] Restart → confirm no `[WizardFlags] timeout` lines in startup logs

### 6. Run Full Go-Live Check
```bash
npx tsx scripts/go-live-check.ts
```
- [ ] **All 9 stages show ✅ GO** (Stages 4 and 5 especially)

### 7. Run Full Pre-Deploy Suite
```bash
GHL_TEST_MODE=true npx tsx scripts/pre-deploy.ts
```
- [ ] **All mandatory suites exit 0**

### 8. Confirm Outbound Kill Switch Is ON
```sql
SELECT key, value FROM system_settings WHERE key LIKE '%Paused%';
```
- [ ] `outboundGlobalPaused` = `true`
- [ ] `emailChannelPaused` = `true`
- [ ] `smsChannelPaused` = `true`
- [ ] `coldEmailChannelPaused` = `true`

---

## Phase 2 — Data Hygiene

### 9. Clean Up Test Contacts
```bash
npx tsx scripts/purge-test-contacts.ts --dry-run   # preview only
npx tsx scripts/purge-test-contacts.ts              # execute
```
- [ ] Dry-run reviewed → purge executed (or documented as retained test artifacts)

### 10. Map Default Enrollment Sequence
- [ ] Dashboard → Operator Dashboard → New Lead Enrollment tab
- [ ] Select ACTIVE sequence as default (or configure per-vertical mapping)

### 11. Set GHL Inbound Confirmation Workflow
- [ ] Set `GHL_WORKFLOW_INBOUND_CONFIRMATION` in Replit Secrets

---

## Phase 3 — Controlled Outbound Activation

> One channel at a time. Monitor 30 minutes between each.

### 12. Enable Email (lowest risk — enable first)
- [ ] Admin → Activation Panel → Email → Enable
- [ ] **Wait 30 min** → Operator Dashboard → bounce rate < 2%, no anomaly alerts

### 13. Enable SMS (after email confirmed healthy)
- [ ] Confirm A2P 10DLC registration is active before going to volume
- [ ] Admin → Activation Panel → SMS → Enable

### 14. Enable Cold Outreach (enable last)
- [ ] Confirm CAN-SPAM mailing address is correct in sequence footer
- [ ] Admin → Activation Panel → Cold Email → Enable

---

## Phase 4 — First 24-Hour Monitoring

| Time | Action |
|---|---|
| T+1h | Operator Dashboard — send volume, reply rate, bounce rate |
| T+1h | Admin → Queue Metrics → DLQ items = 0 |
| T+4h | Admin → GHL Identity Conflicts → empty or resolving |
| T+12h | Confirm db-backup completed in logs (or Neon PITR active) |
| T+24h | Re-run `npx tsx scripts/go-live-check.ts` → all 9 GO |

**Pause immediately if:** Bounce > 2% · Unsubscribe > 0.5% · Any anomaly alert · DLQ items > 10

---

## Rollback Procedure

1. **Pause all outbound:** Admin → Activation Panel → Master Pause → On
2. **Roll back code:** Replit → History → Checkpoints → select checkpoint → Restore
3. **Diagnose:** `audit_logs` table records every activation event; check `/api/admin/alerts` and `/api/admin/queue-metrics`
4. **Contact:** scott@libertybancard.com

---

*Generated as part of Go-Live Audit Report — July 26, 2026*
