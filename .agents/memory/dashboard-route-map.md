---
name: Dashboard route map
description: Complete list of /dashboard/* routes and key notes for testing.
---

Key notes:
- AI advisors are at `/dashboard/chat` — NOT `/dashboard/ai-advisors` (no such route)
- GHL Workflow IDs manager: `/dashboard/ghl-workflows`
- Settings integrations: `/dashboard/settings/integrations`  
- Boarding tracker: `/dashboard/boarding`
- MID/stats: `/dashboard/merchant-health`, `/dashboard/merchant-applications`
- Operator monitoring: `/dashboard/operator`
- Go-live flags: `/dashboard/activation`
- Security/2FA: `/dashboard/security`
- Residual reconciliation: `/dashboard/residual-revenue`

Full route list (from App.tsx as of this session):
contacts, chat, pipeline, onboarding, tickets, tasks, notifications, call-outcome, review-complete, review-requests, testimonial-submissions, onboarding-kickoff, workflows, rfis, review-queue, case-study-intake, ghl-settings, ghl-workflows, automation, prospects, prospects/import, lead-imports, campaigns, outreach-analytics, reporting, win-loss, stage-rules, sequences, lead-gen, lead-intelligence, statement-review, outreach, outreach-command, lead-engine, lead-command-center, blaze, merchant-applications, boarding, merchant-portal, merchant-health, chargebacks, nps, retention-campaigns, agent-management, residual-revenue, referral-program, partner-orgs, knowledge-base, consent-audit, calendar, user-management, permissions, security, settings/integrations, forecasting, pci-assessment, data-requests, audit-logs, blog-generator, content, social, sdr, sms-inbox, bin-lookup, round-robin, inbox-health, activation, operator, seo-health, training, leaderboard, my-day, live-chat, document-vault, virtual-terminal, ghl-sequence-guide, growth-playbook, growth-kpi
