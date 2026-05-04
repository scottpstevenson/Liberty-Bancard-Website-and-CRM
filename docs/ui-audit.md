# UI Audit — Confirm & Responsive Polish Pass

Completed: 2026-05-04

## Scope

Single confirmation + cleanup pass across all dashboard and public pages for visual consistency, density, mobile behavior, and accessibility. No new features added.

## Layout Primitives Created

| Component | Path | Purpose |
|-----------|------|---------|
| `PageHeader` | `client/src/components/ui/page-header.tsx` | Consistent H1 + subtitle + action slot, responsive flex-wrap |
| `ResponsiveTable` | `client/src/components/ui/responsive-table.tsx` | Desktop table with mobile card-list fallback via `mobileCard` render prop; type-safe column accessor (no `any` casts) |
| `DataState` | `client/src/components/ui/data-state.tsx` | Unified loading / error / empty states (pre-existing, now adopted more broadly) |

---

## Full Route Audit

### Public Routes

| Route | Component | Viewport | Status | Notes |
|-------|-----------|----------|--------|-------|
| `/` | Home | 375px / 1280px | PASS | Hero responsive `text-4xl md:text-5xl lg:text-6xl`; buttons flex-wrap; sections `overflow-hidden`; no horizontal scroll |
| `/login` | Login | 375px / 1280px | PASS | Centered card layout; responsive width |
| `/signup` | Signup | 375px / 1280px | PASS | Same card layout as login |
| `/forgot-password` | ForgotPassword | 375px / 1280px | PASS | Single-column form |
| `/reset-password` | ResetPassword | 375px / 1280px | PASS | Single-column form |
| `/verify-email` | VerifyEmail | 375px / 1280px | PASS | Simple centered content |
| `/get-started` | GetStarted | 375px / 1280px | PASS | Form layout |
| `/upload-statement` | UploadStatement | 375px / 1280px | PASS | File upload form |
| `/0-percent-processing` | ZeroPercent | 375px / 1280px | PASS | Marketing page |
| `/beat-square-stripe` | BeatSquareStripe | 375px / 1280px | PASS | Marketing page |
| `/about-contact` | AboutContact | 375px / 1280px | PASS | Contact form |
| `/estimate` | Estimate | 375px / 1280px | PASS | Form layout |
| `/support` | Support | 375px / 1280px | PASS | Support form |
| `/privacy-policy` | PrivacyPolicy | 375px / 1280px | PASS | Prose layout |
| `/terms` | Terms | 375px / 1280px | PASS | Prose layout |
| `/cookie-policy` | CookiePolicy | 375px / 1280px | PASS | Prose layout |
| `/advertising-disclosure` | AdvertisingDisclosure | 375px / 1280px | PASS | Prose layout |
| `/accessibility` | AccessibilityStatement | 375px / 1280px | PASS | Prose layout |
| `/sms-terms` | SmsTerms | 375px / 1280px | PASS | Prose layout |
| `/esign-consent` | ESignConsent | 375px / 1280px | PASS | Prose layout |
| `/surcharging-disclosure` | SurchargingDisclosure | 375px / 1280px | PASS | Prose layout |
| `/merchant-policies` | MerchantPolicies | 375px / 1280px | PASS | Prose layout |
| `/regulatory-notices` | RegulatoryNotices | 375px / 1280px | PASS | Prose layout |
| `/security-compliance` | SecurityCompliance | 375px / 1280px | PASS | Prose layout |
| `/do-not-sell` | DoNotSell | 375px / 1280px | PASS | Prose layout |
| `/data-processing-agreement` | DataProcessingAgreement | 375px / 1280px | PASS | Prose layout |
| `/responsible-ai` | ResponsibleAI | 375px / 1280px | PASS | Prose layout |
| `/testimonials-disclosure` | TestimonialsDisclosure | 375px / 1280px | PASS | Prose layout |
| `/law-enforcement` | LawEnforcementGuidelines | 375px / 1280px | PASS | Prose layout |
| `/dispute-resolution` | DisputeResolution | 375px / 1280px | PASS | Prose layout |
| `/data-retention` | DataRetention | 375px / 1280px | PASS | Prose layout |
| `/tcpa-consent` | TCPAConsent | 375px / 1280px | PASS | Prose layout |
| `/refund-policy` | RefundPolicy | 375px / 1280px | PASS | Prose layout |
| `/california-privacy` | CaliforniaPrivacy | 375px / 1280px | PASS | Prose layout |
| `/ada-compliance` | ADACompliance | 375px / 1280px | PASS | Prose layout |
| `/thanks-statement` | ThanksStatement | 375px / 1280px | PASS | Confirmation page |
| `/proposal/:token` | ProposalViewer | 375px / 1280px | PASS | Dynamic proposal |
| `/thanks-estimate` | ThanksEstimate | 375px / 1280px | PASS | Confirmation page |
| `/thanks-call` | ThanksCall | 375px / 1280px | PASS | Confirmation page |
| `/thanks-support` | ThanksSupport | 375px / 1280px | PASS | Confirmation page |
| `/thanks/application` | ThanksApplication | 375px / 1280px | PASS | Confirmation page |
| `/merchant-application` | MerchantApplication | 375px / 1280px | PASS | Multi-step wizard |
| `/equipment` | Redirect→Shop | — | PASS | Redirect only |
| `/shop` | TerminalShop | 375px / 1280px | PASS | Product grid responsive |
| `/savings-calculator` | SavingsCalculator | 375px / 1280px | PASS | Calculator form |
| `/compare-rates` | RateComparison | 375px / 1280px | PASS | Tables hidden on mobile (`hidden sm:block`) with mobile card layout |
| `/compare/:competitor` | CompareVs | 375px / 1280px | PASS | Table `overflow-x-auto` with negative margin compensation |
| `/why-liberty-bancard` | WhyLiberty | 375px / 1280px | PASS | Marketing page |
| `/case-studies` | CaseStudies | 375px / 1280px | PASS | Card grid |
| `/testimonials/submit` | TestimonialsSubmit | 375px / 1280px | PASS | Form layout |
| `/testimonials` | Testimonials | 375px / 1280px | PASS | Card grid |
| `/integrations` | Integrations | 375px / 1280px | PASS | Grid layout |
| `/faq` | FAQ | 375px / 1280px | PASS | Accordion layout |
| `/affiliate` | AffiliateProgram | 375px / 1280px | PASS | Marketing + form |
| `/partners` | ISOPartnerProgram | 375px / 1280px | PASS | Marketing + form |
| `/partner-portal` | PartnerPortal | 375px / 1280px | PASS | Dashboard layout |
| `/partner-login` | PartnerLogin | 375px / 1280px | PASS | Login form |
| `/partner/:slug` | PartnerBrandedPage | 375px / 1280px | PASS | Dynamic branded page |
| `/partner-org/:slug` | PartnerOrgDashboard | 375px / 1280px | PASS | Dashboard layout |
| `/blog/:slug` | BlogPost | 375px / 1280px | PASS | Prose layout |
| `/blog` | Blog | 375px / 1280px | PASS | Card grid |
| `/authors/:slug` | AuthorPage | 375px / 1280px | PASS | Author profile |
| `/help/:category/:slug` | HelpArticle | 375px / 1280px | PASS | Article layout |
| `/help/:category` | HelpArticle | 375px / 1280px | PASS | Category listing |
| `/help` | HelpCenter | 375px / 1280px | PASS | Chat + categories |
| `/nps/:token` | NpsSurvey | 375px / 1280px | PASS | Survey form |
| `/mobile/*` | MobileApp | 375px | PASS | PWA shell, bottom tabs |
| `/sales-tools` | SalesToolsHub | 375px / 1280px | PASS | Grid layout |
| `/free-analysis` | FreeAnalysis | 375px / 1280px | PASS | Form layout |
| `/quiz/processing-cost` | CostQuiz | 375px / 1280px | PASS | Step wizard |
| `/sales/:slug` | SalesOnePager | 375px / 1280px | PASS | One-pager layout |
| `/industries/:slug` | IndustryPage | 375px / 1280px | PASS | Dynamic industry page |
| `/locations/:city/:industry` | LocationIndustryPage | 375px / 1280px | PASS | Location page |
| `/assets/*` | AssetPage | 375px / 1280px | PASS | Asset viewer |
| `/packet/*` | AssetPage | 375px / 1280px | PASS | Packet viewer |

### Dashboard Routes

| Route | Component | Changes Made | Status |
|-------|-----------|-------------|--------|
| `/dashboard` | Overview | — | PASS (no changes needed) |
| `/dashboard/contacts/:id` | ContactDetail | aria-label on remove-company icon button | PASS |
| `/dashboard/contacts` | Contacts | aria-label on restore, view, more-actions icon buttons | PASS |
| `/dashboard/chat` | Chat | aria-label on send-message icon button | PASS |
| `/dashboard/pipeline` | Pipeline | aria-label on deal actions, stage move/edit/delete icon buttons | PASS |
| `/dashboard/onboarding` | Onboarding | — | PASS (no changes needed) |
| `/dashboard/tickets` | Tickets | Adopted `PageHeader`; export demoted to `variant="outline"` | PASS |
| `/dashboard/tasks` | Tasks | Adopted `PageHeader`; AI Generate demoted to `variant="outline"`, New Task remains primary | PASS |
| `/dashboard/notifications` | Notifications | Adopted `PageHeader`; aria-label on settings and dismiss icon buttons | PASS |
| `/dashboard/call-outcome` | CallOutcome | — | PASS (no changes needed) |
| `/dashboard/review-complete` | ReviewComplete | — | PASS (no changes needed) |
| `/dashboard/review-requests` | ReviewRequests | — | PASS (no changes needed) |
| `/dashboard/testimonial-submissions` | TestimonialSubmissions | — | PASS (no changes needed) |
| `/dashboard/onboarding-kickoff` | OnboardingKickoff | — | PASS (no changes needed) |
| `/dashboard/workflows` | Workflows | aria-label on settings, run, delete, remove-action icon buttons | PASS |
| `/dashboard/rfis` | RFIs | — | PASS (no changes needed) |
| `/dashboard/case-study-intake` | CaseStudyIntake | — | PASS (no changes needed) |
| `/dashboard/ghl-settings` | GhlSettings | — | PASS (no changes needed) |
| `/dashboard/ghl-workflows` | GhlWorkflowManager | — | PASS (no changes needed) |
| `/dashboard/automation` | Automation | — | PASS (no changes needed) |
| `/dashboard/prospects` | Prospects | aria-label on enrich and convert icon buttons | PASS |
| `/dashboard/prospects/import` | ProspectImport | — | PASS (no changes needed) |
| `/dashboard/lead-imports` | LeadImports | — | PASS (no changes needed) |
| `/dashboard/campaigns` | Campaigns | aria-label on delete-step icon button | PASS |
| `/dashboard/outreach-analytics` | OutreachAnalytics | — | PASS (no changes needed) |
| `/dashboard/reporting` | Reporting | — | PASS (no changes needed) |
| `/dashboard/win-loss` | WinLoss | — | PASS (no changes needed) |
| `/dashboard/stage-rules` | StageRules | aria-label on edit, delete, remove-action icon buttons | PASS |
| `/dashboard/sequences` | Sequences | aria-label on toggle, expand, delete, remove-step icon buttons | PASS |
| `/dashboard/lead-gen` | LeadGenCleaner | aria-label on view and enrich icon buttons | PASS |
| `/dashboard/lead-intelligence` | LeadIntelligence | — | PASS (no changes needed) |
| `/dashboard/statement-review` | StatementReview | — | PASS (no changes needed) |
| `/dashboard/outreach` | Outreach | — | PASS (no changes needed) |
| `/dashboard/outreach-command` | OutreachCommand | — | PASS (no changes needed) |
| `/dashboard/lead-engine` | LeadEngine | — | PASS (no changes needed) |
| `/dashboard/lead-command-center` | LeadCommandCenter | aria-label on all pagination and expand-row icon buttons | PASS |
| `/dashboard/blaze` | BlazeIntegration | aria-label on copy-webhook icon button | PASS |
| `/dashboard/merchant-applications` | MerchantApplicationsList | Adopted `PageHeader` with subtitle; consistent `space-y-6` | PASS |
| `/dashboard/boarding` | BoardingTracker | Adopted `PageHeader`, `DataState`, `ResponsiveTable` with mobile card fallback; demoted Refresh to `variant="outline"` | PASS |
| `/dashboard/merchant-portal` | MerchantPortal | — | PASS (no changes needed) |
| `/dashboard/merchant-health` | MerchantHealth | — | PASS (no changes needed) |
| `/dashboard/chargebacks` | Chargebacks | aria-label on close-detail icon button | PASS |
| `/dashboard/nps` | NpsDashboard | Adopted `PageHeader`, `DataState`; consistent `space-y-6` | PASS |
| `/dashboard/retention-campaigns` | RetentionCampaigns | Swapped bare `deleteMutation.mutate()` to `AlertDialog` confirmation; consistent `space-y-6`; aria-label on delete button | PASS |
| `/dashboard/agent-management` | AgentManagement | — | PASS (no changes needed) |
| `/dashboard/residual-revenue` | ResidualRevenue | — | PASS (no changes needed) |
| `/dashboard/referral-program` | ReferralProgram | — | PASS (no changes needed) |
| `/dashboard/partner-orgs` | PartnerOrgs | — | PASS (no changes needed) |
| `/dashboard/knowledge-base` | KnowledgeBase | — | PASS (no changes needed) |
| `/dashboard/consent-audit` | ConsentAudit | — | PASS (no changes needed) |
| `/dashboard/calendar` | Calendar | aria-label on previous/next month icon buttons | PASS |
| `/dashboard/user-management` | UserManagement | — | PASS (no changes needed) |
| `/dashboard/permissions` | Permissions | Adopted `DataState`; added `overflow-x-auto` wrapper | PASS |
| `/dashboard/security` | SecuritySettings | aria-label on copy-secret icon button | PASS |
| `/dashboard/settings/integrations` | SettingsIntegrations | — | PASS (no changes needed) |
| `/dashboard/forecasting` | Forecasting | — | PASS (no changes needed) |
| `/dashboard/pci-assessment` | PciAssessment | — | PASS (no changes needed) |
| `/dashboard/data-requests` | DataRequests | — | PASS (no changes needed) |
| `/dashboard/blog-generator` | BlogGenerator | aria-label on add-keyword, view, publish, delete icon buttons | PASS |
| `/dashboard/content` | ContentEditor | aria-label on view and edit icon buttons | PASS |
| `/dashboard/social` | SocialComposer | — | PASS (no changes needed) |
| `/dashboard/sdr` | SdrDashboard | — | PASS (no changes needed) |
| `/dashboard/sms-inbox` | SmsInbox | aria-label on back-to-threads icon button | PASS |
| `/dashboard/bin-lookup` | BinLookup | — | PASS (no changes needed) |
| `/dashboard/round-robin` | RoundRobinAdmin | — | PASS (no changes needed) |
| `/dashboard/inbox-health` | InboxHealth | — | PASS (no changes needed) |
| `/dashboard/activation` | ActivationPanel | — | PASS (no changes needed) |
| `/dashboard/operator` | OperatorDashboard | Adopted `PageHeader`; removed duplicate `p-4 md:p-6` (DashboardLayout provides padding) | PASS |
| `/dashboard/seo-health` | SeoHealth | — | PASS (no changes needed) |
| `/dashboard/training` | Training | — | PASS (no changes needed) |
| `/dashboard/leaderboard` | Leaderboard | aria-label on settings icon button | PASS |
| `/dashboard/my-day` | SalesRepHome | — | PASS (no changes needed) |
| `/dashboard/live-chat` | LiveChatDashboard | aria-label on refresh-sessions icon button | PASS |
| `/dashboard/document-vault` | DocumentVault | Removed duplicate `p-4 md:p-6 max-w-7xl mx-auto`; aria-label on view merchant, download, delete icon buttons | PASS |
| `/dashboard/virtual-terminal` | VirtualTerminal | — | PASS (no changes needed) |

---

## Components Audited

| Component | Changes |
|---|---|
| `DashboardLayout.tsx` | Added `aria-label` to compose-email icon button |
| `ThemeToggle.tsx` | Already has dynamic `aria-label` — no change |
| `Navbar.tsx` | Already has `aria-label` on mobile menu — no change |
| `UniversalSearch.tsx` | Added `aria-label` to advanced search and close icon buttons |
| `HelpCenter.tsx` | Added `aria-label` to send icon button |
| `StickyMobileCTA.tsx` | Verified — proper `safe-area-pb`, `md:hidden`, fixed positioning |
| `sidebar.tsx` | Verified — Sheet/drawer on mobile via `useIsMobile` hook at 768px breakpoint |

## Destructive Action Audit

| Page | Before | After |
|---|---|---|
| `RetentionCampaigns.tsx` | Delete called `deleteMutation.mutate()` directly without confirmation | Wrapped in `AlertDialog` with title, description, Cancel/Delete actions |
| `DocumentVault.tsx` | Already uses `Dialog` confirmation for delete | Verified — no change needed |
| No `window.confirm()` calls found | — | — |

## ResponsiveTable Adoption

| Page | Status | Notes |
|---|---|---|
| `BoardingTracker.tsx` | Converted | Full ResponsiveTable with mobile card fallback showing merchant, status badge, app ID, MID, days pending, latest log, and Open Contact button |
| Other table-heavy pages | Not converted | Tasks/Tickets/Contacts have complex table features (bulk checkboxes, inline editing, colSpan empty states) that don't map cleanly to ResponsiveTable; kept existing `overflow-x-auto` tables |

## Accessibility Summary

- All `size="icon"` buttons across dashboard pages now have `aria-label` attributes
- `data-testid` attributes maintained on all interactive and display elements
- No changes to color contrast or focus ring behavior (already handled by shadcn defaults)

## Density & Button Hierarchy

- `BoardingTracker` Refresh button demoted from default to `variant="outline"` (secondary action)
- `Tasks` AI Generate button demoted to `variant="outline"`, New Task remains primary
- `Tickets` Export button uses `variant="outline"`, New Ticket remains primary
- Primary CTAs ("New Task", "New Ticket", etc.) remain `variant="default"`
- Consistent `space-y-6` gap on refactored pages

## Not Changed (Out of Scope)

- No package.json modifications
- No backend/schema changes
- No brand color changes
- No new features or routes added
- Existing table structures preserved where ResponsiveTable adoption would require large refactors (bulk selection, colSpan, inline editing)
