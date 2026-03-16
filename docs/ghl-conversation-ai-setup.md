# GHL Conversation AI & Chat Widget Setup Guide

## Overview
This document describes how to configure GoHighLevel (GHL) Conversation AI with the Liberty Bancard AI SDR system. The integration enables AI-powered chat on the Liberty Bancard website, intelligent SMS/email thread handling, and automatic lead qualification.

## Prerequisites
- GHL Sub-Account with Conversation AI enabled
- GHL Private Integration Token (set as `GHL_PRIVATE_INTEGRATION_TOKEN` env var)
- GHL Location ID (set as `GHL_LOCATION_ID` env var)
- GHL Webhook Secret (set as `GHL_WEBHOOK_SECRET` env var)
- GHL Chat Widget ID (set as `VITE_GHL_CHAT_WIDGET_ID` env var for frontend)

---

## 1. GHL Chat Widget Configuration

### Step 1: Create Chat Widget in GHL
1. Go to **Sites → Chat Widget** in your GHL sub-account
2. Create a new chat widget named "Liberty Bancard AI Chat"
3. Configure appearance:
   - Primary color: `#1e3a5f` (Liberty Bancard blue)
   - Widget position: Bottom-right
   - Welcome message: "Hi! Welcome to Liberty Bancard. How can I help you save on payment processing today?"
   - Agent name: "Liberty AI Assistant"
4. Copy the **Widget ID** from the embed code

### Step 2: Set Environment Variables
```
VITE_GHL_CHAT_WIDGET_ID=<your-widget-id>
```

The chat widget component (`client/src/components/ChatWidget.tsx`) automatically loads on all public pages and passes the current page URL to GHL for context-aware routing.

---

## 2. Conversation AI Training

### Value Propositions (Train AI with these)
- Save up to 40% on processing fees
- No long-term contracts required
- Next-day funding available
- Free terminal and POS equipment
- 24/7 US-based customer support
- Transparent pricing with no hidden fees
- Interchange-plus and zero-percent processing options

### Pricing Guidelines (CRITICAL)
**NEVER quote specific rates or prices.** Train the AI with these rules:
- When asked about rates: "We tailor pricing to each business based on their volume, industry, and needs"
- When pressed for numbers: "Our specialists can provide a personalized quote — would you like a free savings analysis?"
- When comparing to competitors: "We typically save merchants 20-40% compared to their current processor"
- When asked about fees: "Our pricing is fully transparent — no hidden fees, no surprises. Let's do a free analysis of your current statement."

### Compliance Disclaimers (Required)
All conversations must include when collecting information:
- "By providing your information, you consent to being contacted by Liberty Bancard regarding payment processing services."
- Do not make guarantees about savings amounts
- Do not discuss specific interchange rates
- Do not discuss PCI compliance requirements in detail — refer to specialist

### Booking Goals
The AI should guide conversations toward:
1. Capturing contact information (business name, contact name, email, phone)
2. Offering a free savings analysis / statement review
3. Booking a call with a payment processing specialist

---

## 3. Bot Contexts (System Prompts)

Three bot contexts are configured in `server/services/sdr/conversation-ai.ts`:

### Context 1: Homepage Bot (`homepage_general`)
- **Trigger:** Visitor on homepage or non-industry pages
- **Goal:** General qualification + contact capture
- **Behavior:** Greet, identify business type, ask about current processing, offer savings review

### Context 2: Vertical Page Bots (4 variants)
- **Restaurant** (`vertical_restaurant`): Triggered by `/industry/restaurant` pages
  - Talks about POS integration, tip management, online ordering
- **MedSpa** (`vertical_medspa`): Triggered by `/industry/medspa` pages
  - Talks about HIPAA, recurring billing, high-ticket transactions
- **Dental** (`vertical_dental`): Triggered by `/industry/dental` pages
  - Talks about practice management software, patient financing
- **Auto** (`vertical_auto`): Triggered by `/industry/auto` pages
  - Talks about high-ticket repairs, fleet billing, mobile payments

### Context 3: Existing Lead Bot (`existing_lead`)
- **Trigger:** Returning visitor with existing merchant record
- **Goal:** Continue conversation, handle objections, push toward booking
- **Behavior:** Reference previous interaction, address common objections, encourage scheduling

### How Context Routing Works
When a new conversation is created via webhook:
1. The system checks if the GHL contact already exists as an SDR merchant
2. If existing → uses `existing_lead` context
3. If new → checks the `pageUrl` from the webhook payload
4. Matches URL patterns to select the appropriate vertical context
5. Falls back to `homepage_general` if no match
6. The selected context ID is pushed to GHL via the `lb_last_ai_outcome` custom field

---

## 4. Webhook Configuration

### Required GHL Webhooks
Configure these webhooks in GHL → Settings → Webhooks:

| Event | Webhook URL | Purpose |
|-------|-------------|---------|
| Conversation Created | `/api/webhooks/ghl/conversation-created` | Creates merchant + lead state |
| Chat Message | `/api/webhooks/ghl/chat-message` | AI reply + handoff detection |
| Chat Booking | `/api/webhooks/ghl/chat-booking` | Updates lead to MEETING_SET |
| SMS Received | `/api/webhooks/ghl/sms-thread` | AI SMS conversation handling |
| Email Received | `/api/webhooks/ghl/email-thread` | AI email thread handling |
| Contact Updated | `/api/webhooks/ghl/contact-updated` | Syncs contact changes |
| Appointment Booked | `/api/webhooks/ghl/appointment-booked` | Updates meeting status |

### Webhook Security
All webhooks validate the `x-ghl-signature` header using HMAC-SHA256 with the `GHL_WEBHOOK_SECRET`. In development, signature validation is skipped if the secret is not set.

---

## 5. Handoff Controls

### Automatic Handoff Triggers
The system automatically hands off to a human when it detects:

1. **Explicit Request:** Visitor says "talk to a real person", "speak with a human", etc.
2. **Angry Intent:** Profanity, threats, or escalation language (confirmed by pattern in current + prior messages)
3. **Complex Pricing:** Multiple detailed pricing questions in a single message (interchange, BPS, assessment fees, etc.)
4. **Low Confidence:** Visitor repeatedly expresses confusion or dissatisfaction with AI responses

### What Happens on Handoff
1. `ownerType` is set to `human` in `sdr_lead_state` (prevents further AI replies from our system)
2. GHL contact is tagged with `LB-HUMAN-HANDOFF` and `LB-CHAT-HANDOFF`
3. GHL custom field `lb_owner_type` is set to `human`
4. GHL Conversation AI is disabled via `PUT /conversations/ai/toggle` (primary); if that endpoint is unavailable, DND is enabled on the contact as a fallback to suppress all automated messaging
5. Internal notification is created alerting reps to take over
6. Event is logged to `sdr_lead_events` as `chat_handoff`

**Note:** The GHL API endpoint for Conversation AI toggling may vary by account tier. Verify in staging that the handoff correctly pauses both our AI replies (via `ownerType=human`) and GHL-native AI replies (via the toggle or DND fallback). If neither approach works in your account, configure a GHL Workflow trigger on the `LB-CHAT-HANDOFF` tag to disable Conversation AI.

### Re-enabling AI
To re-enable AI on a handoff thread:
1. Update `sdr_lead_state.ownerType` back to `ai`
2. Remove the `LB-HUMAN-HANDOFF` tag in GHL
3. Re-enable Conversation AI on the contact in GHL

---

## 6. Chat Analytics

The SDR Dashboard includes a "Chat AI" tab showing today's metrics:
- **Chats Initiated:** Number of new conversations started
- **Messages:** Total chat messages exchanged
- **Leads Captured:** New merchants created from chat
- **Bookings:** Appointments booked through chat
- **Handoffs:** AI-to-human transfers
- **Handoff Rate:** Percentage of chats that required human intervention
- **Conversion Rate:** Percentage of chats that captured a lead

API endpoint: `GET /api/sdr/dashboard/chat-analytics`

---

## 7. Custom Fields & Tags

### Required Custom Fields (auto-bootstrapped)
- `lb_merchant_id` — Internal merchant ID
- `lb_current_stage` — SDR pipeline stage
- `lb_last_ai_outcome` — Last AI decision (includes bot context)
- `lb_owner_type` — `ai` or `human`
- Plus scoring fields: `lb_fit_score`, `lb_revenue_score`, `lb_reachability_score`, `lb_priority_score`

### Required Tags (auto-bootstrapped)
- `LB-AI-SDR` — Managed by AI SDR system
- `LB-CHAT-LEAD` — Originated from chat widget
- `LB-CHAT-HANDOFF` — Chat was handed off to human
- `LB-HUMAN-HANDOFF` — Contact requires human attention

---

## 8. Testing

### Test Webhook Flow
```bash
# Create a new chat lead
curl -X POST /api/webhooks/ghl/conversation-created \
  -H "Content-Type: application/json" \
  -d '{"contactId":"test123","firstName":"John","email":"john@test.com","pageUrl":"https://libertybancard.com/industry/restaurant"}'

# Send a chat message (should get AI reply)
curl -X POST /api/webhooks/ghl/chat-message \
  -H "Content-Type: application/json" \
  -d '{"contactId":"test123","body":"I am interested in payment processing","direction":"inbound"}'

# Test handoff detection
curl -X POST /api/webhooks/ghl/chat-message \
  -H "Content-Type: application/json" \
  -d '{"contactId":"test123","body":"I want to speak with a real person","direction":"inbound"}'
```

### Verify Bot Context Resolution
```bash
curl -X POST /api/sdr/bot-context/resolve \
  -H "Content-Type: application/json" \
  -d '{"ghlContactId":"test123","pageUrl":"https://libertybancard.com/industry/dental"}'
```
