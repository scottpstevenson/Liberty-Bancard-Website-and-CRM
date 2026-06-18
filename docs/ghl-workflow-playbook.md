# Liberty Bancard — GHL Workflow Playbook
### Step-by-Step Build Guide + AI Copy Prompts

**How to use this document:**
1. Build each workflow in GHL (Automation → Workflows → + New Workflow)
2. Copy the Workflow ID from the GHL URL (e.g., `abc123def456`)
3. Paste that ID into Replit at `/dashboard/integrations` → GHL Workflow Manager → the matching row
4. The platform will automatically trigger the right workflow at the right moment

**Total workflows to build: 22**

---

## BEFORE YOU START — GHL Setup Checklist

- [ ] A2P 10DLC registration approved (required for SMS — takes 3–7 business days)
- [ ] At least one phone number purchased and assigned in GHL
- [ ] Email sending domain verified (Settings → Email Services → Domain)
- [ ] Custom values configured: `{{business_name}}`, `{{owner_name}}`, `{{booking_link}}`, `{{portal_link}}`
- [ ] Calendar created for sales appointments (used in booking workflows)
- [ ] Voicemail drops recorded (30–45 second MP3, warm and professional tone)

---

## CATEGORY 1: INBOUND LEADS
*Triggered when someone fills out a form on the Liberty Bancard website*

---

### WORKFLOW 1 — Inbound Lead Confirmation
**Env Key to paste in Replit:** `GHL_WORKFLOW_INBOUND_LEAD`
**Trigger:** Contact created via web form (Replit fires this on any new lead form submission)

**What it does:** Immediately confirms receipt, delivers booking link, follows up if no appointment is booked within 24 hours.

#### GHL Build Steps:
1. Go to **Automation → Workflows → + New Workflow → Start from Scratch**
2. Name it: `LB — Inbound Lead Confirmation`
3. **Trigger:** Select "Contact Created" — no filter needed (Replit only fires this for real lead submissions)
4. **Step 1 — Send Email (Immediate)**
   - Subject: `Quick question about your processing, {{contact.first_name}}`
   - Body: *(use AI prompt below)*
5. **Step 2 — Send SMS (Immediate, +2 min delay)**
   - Message: *(use AI prompt below)*
6. **Step 3 — Wait 24 hours**
7. **Step 4 — IF/ELSE: Has appointment been booked?**
   - Condition: Tag does NOT contain "appointment_booked"
   - YES branch → End
   - NO branch → continue
8. **Step 5 — Send SMS (follow-up)**
   - Message: *(use AI prompt below)*
9. **Step 6 — Create Task** for sales rep: "Call {{contact.first_name}} — no booking yet"
10. Click **Save & Publish** → copy the Workflow ID from the URL

#### AI Copy Prompt:
```
You are writing messaging for Liberty Bancard, a payment processing ISO based in Florida.
Tone: Direct, professional, no hype. Never use "revolutionary" or "game-changing."
The contact just submitted a lead form expressing interest in lower payment processing rates.

Write three pieces of copy:

1. CONFIRMATION EMAIL (Subject: "Quick question about your processing, [First Name]")
   - 4–6 sentences
   - Acknowledge their inquiry
   - Mention we specialize in restaurants, retail, medical, and service businesses in Florida
   - Include their booking link: https://api.leadconnectorhq.com/widget/bookings/libertybancard
   - Close with a direct CTA to book a 15-minute call
   - Signed: Scott, Liberty Bancard

2. IMMEDIATE SMS (under 160 characters)
   - Confirm we got their request
   - Include booking link
   - No emojis

3. 24-HOUR FOLLOW-UP SMS (under 160 characters)
   - Reference that we haven't connected yet
   - Soft urgency — rates change quarterly
   - Include booking link
```

---

### WORKFLOW 2 — Statement Review Follow-Up
**Env Key to paste in Replit:** `GHL_WORKFLOW_STATEMENT_REVIEW`
**Trigger:** Fired by Replit when a merchant uploads a processing statement

**What it does:** Confirms statement received, sets expectation for 24-hour AI review, follows up with rep.

#### GHL Build Steps:
1. **+ New Workflow → Start from Scratch**
2. Name it: `LB — Statement Upload Confirmation`
3. **Trigger:** "Contact Tag Added" → Tag = `statement_uploaded`
4. **Step 1 — Send Email (Immediate)**
   - Subject: `We received your statement, {{contact.first_name}} — review in progress`
5. **Step 2 — Send SMS (+5 min delay)**
6. **Step 3 — Create Internal Task** (assign to contact owner): "Review AI analysis for {{contact.first_name}} — {{contact.company_name}}"
7. **Step 4 — Wait 48 hours**
8. **Step 5 — IF/ELSE:** Tag does NOT contain "proposal_sent"
   - NO branch: Send SMS nudge + create urgent task
9. Save & Publish

#### AI Copy Prompt:
```
Write messaging for Liberty Bancard confirming a merchant's processing statement was received.

Context: The merchant uploaded their statement to get a free rate analysis. Our AI is analyzing it.
Tone: Confident, efficient, professional. No fluff.

Write:

1. CONFIRMATION EMAIL
   - Subject: "We received your statement, [First Name] — review in progress"
   - Tell them their statement is being analyzed
   - Expected turnaround: within 24 hours
   - What they'll receive: side-by-side comparison of their current rates vs. what we can offer
   - No obligation to switch
   - Signed: Scott, Liberty Bancard

2. CONFIRMATION SMS (under 160 characters)
   - Statement received, analysis underway, we'll be in touch within 24 hours

3. 48-HOUR NUDGE SMS (if no proposal sent yet, under 160 characters)
   - Analysis complete, trying to reach them
   - Ask if they have 10 minutes to review findings
```

---

### WORKFLOW 3 — Callback Request
**Env Key to paste in Replit:** `GHL_WORKFLOW_CALLBACK`
**Trigger:** Fired when someone submits the callback request form

#### GHL Build Steps:
1. **+ New Workflow**
2. Name: `LB — Callback Request`
3. **Trigger:** Contact Tag Added → `callback_requested`
4. **Step 1 — Send SMS (Immediate):** Confirm we'll call within 1 business hour
5. **Step 2 — Create Task (Immediate):** "CALL NOW — {{contact.first_name}} requested callback" (high priority, assign to owner)
6. **Step 3 — Send Email (+5 min):** Confirmation email with booking link as alternative
7. Save & Publish

#### AI Copy Prompt:
```
Write messaging for Liberty Bancard responding to a callback request.
The contact asked us to call them — they haven't booked a calendar appointment.

Write:

1. IMMEDIATE SMS — confirm we received their callback request, will call within 1 business hour
   - Under 160 characters
   - Include "Reply STOP to opt out"

2. CONFIRMATION EMAIL
   - 3–4 sentences
   - Confirm callback request received
   - Offer booking link as an alternative if they prefer to schedule: https://api.leadconnectorhq.com/widget/bookings/libertybancard
   - Signed: Scott, Liberty Bancard
```

---

## CATEGORY 2: SCHEDULING
*Appointment booking, reminders, and no-show recovery*

---

### WORKFLOW 4 — Appointment Booking Confirmation
**Env Key to paste in Replit:** `GHL_WORKFLOW_BOOKING_CONFIRM`
**Trigger:** Appointment booked via GHL calendar

#### GHL Build Steps:
1. **+ New Workflow**
2. Name: `LB — Booking Confirmation`
3. **Trigger:** "Appointment" → "Appointment Status Changed" → Status = Confirmed
4. **Step 1 — Send Email (Immediate):** Calendar confirmation with Zoom/call details
5. **Step 2 — Send SMS (Immediate):** Short confirmation with date/time
6. **Step 3 — Add Tag:** `appointment_booked`
7. **Step 4 — Wait until 24 hours before appointment**
8. **Step 5 — Send SMS:** 24-hour reminder
9. **Step 6 — Send Email:** 24-hour reminder with agenda
10. **Step 7 — Wait until 1 hour before appointment**
11. **Step 8 — Send SMS:** 1-hour reminder
12. Save & Publish

#### AI Copy Prompt:
```
Write appointment confirmation and reminder messaging for Liberty Bancard.
The prospect has booked a 15-minute discovery call to discuss their payment processing rates.

Write:

1. BOOKING CONFIRMATION EMAIL
   - Confirm the appointment (date/time will be dynamically inserted by GHL: {{appointment.start_time}})
   - What to expect: 15-minute call, we'll review their current rates and show the savings potential
   - What to bring (optional): a recent processing statement if they have one
   - Signed: Scott, Liberty Bancard

2. BOOKING CONFIRMATION SMS (under 160 characters)
   - Confirm booked, include date/time placeholder {{appointment.start_time}}

3. 24-HOUR REMINDER EMAIL
   - Brief, just the reminder + what to expect
   - Attach the agenda: we'll review rates, calculate savings, answer questions

4. 24-HOUR REMINDER SMS (under 160 characters)

5. 1-HOUR REMINDER SMS (under 160 characters)
   - Ultra brief. Just the reminder + call-in info placeholder.
```

---

### WORKFLOW 5 — 24h Appointment Reminder
**Env Key to paste in Replit:** `GHL_WORKFLOW_REMINDER`
**Note:** This is a standalone reminder workflow for cases where GHL calendar doesn't auto-trigger Workflow 4. Build identically to Steps 4–6 of Workflow 4 above as a standalone flow.

---

### WORKFLOW 6 — No-Show Reschedule
**Env Key to paste in Replit:** `GHL_WORKFLOW_NO_SHOW`
**Trigger:** Appointment status changed to "No-Show"

#### GHL Build Steps:
1. **+ New Workflow**
2. Name: `LB — No-Show Recovery`
3. **Trigger:** Appointment Status Changed → No-Show
4. **Step 1 — Wait 30 minutes** (give them a grace period)
5. **Step 2 — Send SMS:** Missed connection, reschedule link
6. **Step 3 — Wait 2 hours**
7. **Step 4 — Send Email:** Reschedule email
8. **Step 5 — Wait 24 hours**
9. **Step 6 — Send SMS:** Final reschedule attempt
10. **Step 7 — Add Tag:** `no_show`
11. **Step 8 — Create Task:** "No-show recovery — {{contact.first_name}}" 
12. Save & Publish

#### AI Copy Prompt:
```
Write no-show recovery messaging for Liberty Bancard.
The prospect booked a call and didn't show up. We want to recover the appointment without being pushy.

Write:

1. IMMEDIATE SMS (+30 min after no-show, under 160 characters)
   - Casual tone, missed connection, offer reschedule link
   - Booking link: https://api.leadconnectorhq.com/widget/bookings/libertybancard

2. 2-HOUR EMAIL
   - Subject: "Missed you today, [First Name]"
   - 3–4 sentences, no guilt-tripping
   - Restate the value (free rate analysis, no obligation)
   - Reschedule link

3. 24-HOUR FINAL SMS (under 160 characters)
   - Last attempt, acknowledge they might be busy
   - Leave the door open
```

---

## CATEGORY 3: NURTURE & SALES PIPELINE
*Post-call follow-up, proposal tracking, long-term nurture*

---

### WORKFLOW 7 — Post-Call Follow-Up
**Env Key to paste in Replit:** `GHL_WORKFLOW_POST_CALL`
**Trigger:** Fired by Replit when deal moves to "Call Booked" → "Proposal Sent" stage

#### GHL Build Steps:
1. **+ New Workflow**
2. Name: `LB — Post-Call Follow-Up`
3. **Trigger:** Contact Tag Added → `post_call`
4. **Step 1 — Send Email (Immediate):** Recap + next steps
5. **Step 2 — Send SMS (+1 hour):** Quick follow-up
6. **Step 3 — Wait 24 hours**
7. **Step 4 — Send Email:** Proposal ready / what to expect
8. **Step 5 — Create Task:** "Send proposal to {{contact.first_name}}"
9. Save & Publish

#### AI Copy Prompt:
```
Write post-call follow-up messaging for Liberty Bancard.
We just finished a discovery call with a prospect. The call went well — we identified savings potential.

Write:

1. IMMEDIATE POST-CALL EMAIL
   - Subject: "Great talking with you, [First Name] — next steps"
   - Thank them for their time
   - Summarize what we discussed (use placeholders — keep it general)
   - Tell them what comes next: personalized proposal within 24 hours
   - Signed: Scott, Liberty Bancard

2. 1-HOUR SMS (under 160 characters)
   - Quick follow-up, reference the call, say proposal is coming

3. 24-HOUR PROPOSAL READY EMAIL
   - Subject: "Your custom rate proposal is ready, [First Name]"
   - 4–5 sentences
   - Their proposal is attached / will be sent separately
   - Highlight: side-by-side comparison, no setup fees, no long-term contract
```

---

### WORKFLOW 8 — Proposal Follow-Up
**Env Key to paste in Replit:** `GHL_WORKFLOW_PROPOSAL_FOLLOWUP`
**Trigger:** Fired by Replit when a proposal is sent (deal stage → "Proposal Sent")

#### GHL Build Steps:
1. **+ New Workflow**
2. Name: `LB — Proposal Follow-Up`
3. **Trigger:** Contact Tag Added → `proposal_sent`
4. **Step 1 — Wait 24 hours**
5. **Step 2 — Send Email:** Day 1 check-in
6. **Step 3 — Send SMS (+15 min):** Day 1 SMS nudge
7. **Step 4 — Wait 48 hours**
8. **Step 5 — Send Email:** Day 3 value reinforcement
9. **Step 6 — Wait 4 days**
10. **Step 7 — Send Email:** Day 7 urgency / limited-time offer
11. **Step 8 — Send SMS (+30 min):** Day 7 SMS
12. **Step 9 — Create Task:** "Manual follow-up — {{contact.first_name}} hasn't responded in 7 days"
13. Save & Publish

#### AI Copy Prompt:
```
Write a 3-touch proposal follow-up sequence for Liberty Bancard.
We sent a merchant a custom rate proposal. We need to follow up over 7 days without being aggressive.

Write:

1. DAY 1 EMAIL — Subject: "Did you get a chance to look at the proposal?"
   - 3–4 sentences, casual check-in
   - Offer to answer any questions on a quick 10-minute call
   - Booking link: https://api.leadconnectorhq.com/widget/bookings/libertybancard

2. DAY 1 SMS (under 160 characters)
   - Checking in on the proposal, happy to answer questions

3. DAY 3 EMAIL — Subject: "A few things worth knowing, [First Name]"
   - Reinforce 2–3 specific advantages: no cancellation fees, same-day funding, dedicated rep
   - Soft call to action

4. DAY 7 EMAIL — Subject: "Last check-in on your proposal"
   - Create light urgency (rates are reviewed quarterly, current offer may not last)
   - Make it easy to say yes or schedule a call
   - Don't beg — be confident

5. DAY 7 SMS (under 160 characters)
   - Final follow-up, keep the door open
```

---

### WORKFLOW 9 — Long-Term Nurture
**Env Key to paste in Replit:** `GHL_WORKFLOW_LONG_NURTURE`
**Trigger:** Fired by Replit when deal moves to "Nurture / Not Now" stage

#### GHL Build Steps:
1. **+ New Workflow**
2. Name: `LB — Long-Term Nurture`
3. **Trigger:** Contact Tag Added → `nurture`
4. **Step 1 — Wait 30 days**
5. **Step 2 — Send Email:** Month 1 educational content
6. **Step 3 — Wait 30 days**
7. **Step 4 — Send Email:** Month 2 — industry insight
8. **Step 5 — Wait 30 days**
9. **Step 6 — Send Email:** Month 3 — "Has anything changed?"
10. **Step 7 — Send SMS:** Month 3 SMS
11. **Step 8 — Create Task:** "Re-engage {{contact.first_name}} — 90-day nurture complete"
12. Repeat or end based on your preference
13. Save & Publish

#### AI Copy Prompt:
```
Write a 3-month nurture email sequence for Liberty Bancard.
These are merchants who were interested but said "not right now." We want to stay top of mind.
Tone: Educational, not salesy. No pitching in months 1–2.

Write:

1. MONTH 1 EMAIL — Subject: "The hidden fees processors don't talk about"
   - 400–500 words
   - Educate on interchange-plus vs. flat rate pricing
   - No direct pitch — just value
   - PS: "When you're ready to review your rates, here's my calendar" + booking link

2. MONTH 2 EMAIL — Subject: "What Square and Stripe don't tell you"
   - 400–500 words
   - Compare Square/Stripe/Toast to a true merchant account
   - Highlight: next-day funding, no volume caps, PCI support
   - Soft CTA at the end

3. MONTH 3 EMAIL — Subject: "Still processing with [Current Processor]?"
   - More direct — "Has anything changed since we last spoke?"
   - Reference that Q[X] rate reviews are coming up
   - Strong CTA with booking link

4. MONTH 3 SMS (under 160 characters)
   - "Checking back in — rates reviewed quarterly. 10 min to compare?" + booking link
```

---

## CATEGORY 4: SDR COLD OUTBOUND
*These are the high-volume outreach workflows — 1,000/day lives here*

**IMPORTANT:** All SDR workflows follow the same structure. Build Workflow 10 first as your master template, then duplicate it for each vertical and change only the messaging.

---

### WORKFLOW 10 — SDR Cold Outbound (Default / Master Template)
**Env Key to paste in Replit:** `GHL_WORKFLOW_SDR_DEFAULT`
**Trigger:** Fired by Replit SDR engine when a new contact is enrolled in outreach

#### GHL Build Steps:
1. **+ New Workflow**
2. Name: `LB — SDR Cold Outbound — Default`
3. **Trigger:** Contact Tag Added → `sdr_enrolled`
4. **Step 1 — Send Email (Immediate):** Touch 1 — cold intro
5. **Step 2 — Wait 1 day**
6. **Step 3 — Send SMS:** Touch 2 — SMS intro
7. **Step 4 — Wait 2 days**
8. **Step 5 — Send Email:** Touch 3 — different angle
9. **Step 6 — Wait 2 days**
10. **Step 7 — Voicemail Drop:** Touch 4 — recorded voicemail
11. **Step 8 — Wait 3 days**
12. **Step 9 — Send Email:** Touch 5 — social proof / case study
13. **Step 10 — Wait 3 days**
14. **Step 11 — Send SMS:** Touch 6 — final SMS
15. **Step 12 — Wait 2 days**
16. **Step 13 — Send Email:** Touch 7 — break-up email
17. **Step 14 — Add Tag:** `sdr_sequence_complete`
18. **Step 15 — Remove Tag:** `sdr_enrolled`
19. Save & Publish → copy Workflow ID → paste as `GHL_WORKFLOW_SDR_DEFAULT` in Replit

**Then duplicate this workflow 6 times** (one per vertical below), changing only the email/SMS copy.

---

### WORKFLOW 11 — SDR Cold Outbound — Restaurant
**Env Key:** `GHL_WORKFLOW_SDR_RESTAURANT`
Duplicate Workflow 10. Name it `LB — SDR Cold Outbound — Restaurant`. Replace copy using prompt below.

### WORKFLOW 12 — SDR Cold Outbound — Retail
**Env Key:** `GHL_WORKFLOW_SDR_RETAIL`
Duplicate Workflow 10. Name it `LB — SDR Cold Outbound — Retail`.

### WORKFLOW 13 — SDR Cold Outbound — Medical/Dental
**Env Key:** `GHL_WORKFLOW_SDR_MEDICAL`
Duplicate Workflow 10. Name it `LB — SDR Cold Outbound — Medical/Dental`.

### WORKFLOW 14 — SDR Cold Outbound — Med Spa
**Env Key:** `GHL_WORKFLOW_SDR_MEDSPA`
Duplicate Workflow 10. Name it `LB — SDR Cold Outbound — Med Spa`.

### WORKFLOW 15 — SDR Cold Outbound — Automotive
**Env Key:** `GHL_WORKFLOW_SDR_AUTO`
Duplicate Workflow 10. Name it `LB — SDR Cold Outbound — Automotive`.

### WORKFLOW 16 — SDR Cold Outbound — Construction
**Env Key:** `GHL_WORKFLOW_SDR_CONSTRUCTION`
Duplicate Workflow 10. Name it `LB — SDR Cold Outbound — Construction`.

---

#### AI Copy Prompt — SDR Cold Outbound (run once per vertical, change VERTICAL each time):

```
You are writing a 7-touch cold outreach sequence for Liberty Bancard, a payment processing ISO.
Target vertical: [INSERT VERTICAL: Restaurant / Retail / Medical-Dental / Med Spa / Automotive / Construction]

Liberty Bancard's offer:
- Lower processing rates than Square, Toast, Stripe (typically 0.3–1.2% lower)
- No cancellation fees, no long-term contract
- Same-day or next-day funding
- Dedicated local rep
- Free statement analysis — no obligation

Rules:
- Never use "revolutionary," "game-changing," "disruptive," or "cutting-edge"
- No more than 3 sentences per email body (above the signature)
- SMS under 155 characters (leave room for opt-out)
- Every email and SMS must include the booking link: https://api.leadconnectorhq.com/widget/bookings/libertybancard
- Use vertical-specific pain points (see below)
- Vary the angle on each touch — don't repeat the same hook

VERTICAL PAIN POINTS:
- Restaurant: high card-present volume, Toast/Square markup, tips processing fees, weekend volume spikes
- Retail: seasonal volume, chargeback risk, keyed-in transactions, inventory systems
- Medical/Dental: insurance co-pays, HIPAA-compliant processing, high-ticket transactions, recurring billing
- Med Spa: luxury ticket size, card-not-present risk, membership billing, Square dependency
- Automotive: high-ticket repairs, parts invoices, Fleet cards, service agreement billing
- Construction: job deposits, progress billing, B2B invoicing, contractor payment timing

Write all 7 touches:

TOUCH 1 — EMAIL (cold intro, subject line + body)
TOUCH 2 — SMS (day 1, intro angle)
TOUCH 3 — EMAIL (day 3, different angle — ROI/savings focus)
TOUCH 4 — VOICEMAIL SCRIPT (day 5, 30–45 seconds, warm and direct — this will be recorded)
TOUCH 5 — EMAIL (day 8, social proof angle — "other [vertical] owners in Florida...")
TOUCH 6 — SMS (day 11, final nudge)
TOUCH 7 — EMAIL (day 13, break-up email — "last one, I promise")

Format each touch with:
TOUCH [N] — [TYPE]
Subject (if email): ...
Body: ...
```

---

### WORKFLOW 17 — SDR Statement Audit Follow-Up
**Env Key:** `GHL_WORKFLOW_SDR_STATEMENT`
**Trigger:** Contact Tag Added → `sdr_statement_audit`
**Purpose:** Outreach specifically leading with the "free statement audit" angle, not a generic cold intro.

Duplicate Workflow 10 structure but use this prompt:

#### AI Copy Prompt:
```
Write a 5-touch outreach sequence for Liberty Bancard leading with a free processing statement audit.
The prospect has NOT submitted a statement yet — this outreach is designed to get them to upload one.
Booking link: https://api.leadconnectorhq.com/widget/bookings/libertybancard
Statement upload link: https://libertybancard.com/upload-statement

TOUCH 1 — EMAIL: Lead with "Are you overpaying?" — offer the free audit
TOUCH 2 — SMS: Quick prompt to upload statement for free analysis
TOUCH 3 — EMAIL: Show what the audit reveals (effective rate, hidden fees, savings estimate)
TOUCH 4 — EMAIL: Urgency — "Most businesses we audit find at least $300/month in overcharges"
TOUCH 5 — EMAIL: Break-up — "Last chance for your free audit"

Same rules as above: short emails (3 sentences max above signature), vary angles.
```

---

## CATEGORY 5: ONBOARDING
*After a deal closes — merchant gets onboarded*

---

### WORKFLOW 18 — Merchant Application Received
**Env Key:** `GHL_WORKFLOW_MERCHANT_APP`
**Trigger:** Fired by Replit when merchant submits the application at `/apply`

#### GHL Build Steps:
1. **+ New Workflow**
2. Name: `LB — Merchant Application Received`
3. **Trigger:** Contact Tag Added → `merchant_app_submitted`
4. **Step 1 — Send Email (Immediate):** Application confirmation
5. **Step 2 — Send SMS (+5 min):** SMS confirmation
6. **Step 3 — Create Task:** "Review application — {{contact.company_name}}" (assign to underwriting)
7. **Step 4 — Wait 24 hours**
8. **Step 5 — IF/ELSE:** Tag does NOT contain `merchant_approved`
   - NO branch: Send "still processing" email + create follow-up task
9. Save & Publish

#### AI Copy Prompt:
```
Write messaging confirming a merchant's application was received by Liberty Bancard.
They have completed the multi-step merchant application form and are awaiting approval.

Write:

1. APPLICATION CONFIRMATION EMAIL
   - Subject: "Application received — what happens next"
   - Confirm application received
   - Timeline: review within 1–2 business days
   - What they need to have ready: voided check, business bank statement (last 3 months)
   - Contact if questions: [phone/email]
   - Signed: Liberty Bancard Onboarding Team

2. CONFIRMATION SMS (under 160 characters)

3. 24-HOUR "STILL IN REVIEW" EMAIL (if not yet approved)
   - Reassure them the application is still being processed
   - Typical timeline, no action needed from them
```

---

### WORKFLOW 19 — Merchant Approved — Portal Welcome
**Env Key:** `GHL_WORKFLOW_MERCHANT_APPROVED`
**Trigger:** Fired by Replit when a merchant is approved and their MID is provisioned

#### GHL Build Steps:
1. **+ New Workflow**
2. Name: `LB — Merchant Approved Welcome`
3. **Trigger:** Contact Tag Added → `merchant_approved`
4. **Step 1 — Send Email (Immediate):** Welcome + portal access
5. **Step 2 — Send SMS (+15 min):** Portal link SMS
6. **Step 3 — Wait 2 days**
7. **Step 4 — Send Email:** "Getting started" guide
8. **Step 5 — Wait 5 days**
9. **Step 6 — Send Email:** Week 1 check-in
10. **Step 7 — Add Tag:** `active_merchant`
11. Save & Publish

#### AI Copy Prompt:
```
Write a merchant welcome sequence for Liberty Bancard. The merchant has been approved and their account is active.
Tone: Celebratory but professional. They made a good decision.

Write:

1. WELCOME EMAIL
   - Subject: "You're approved — welcome to Liberty Bancard"
   - Congratulate them
   - Their merchant portal link: {{custom.portal_link}} (GHL custom value)
   - Their account rep will reach out to schedule terminal setup
   - Support contact info
   - Signed: Liberty Bancard Team

2. WELCOME SMS (under 160 characters)
   - Approved, portal link, rep will be in touch

3. DAY 2 GETTING STARTED EMAIL
   - Subject: "Your quick-start guide"
   - 5–7 bullet points covering: how to read your statement, funding schedule, how to reach support, how to order additional terminals

4. WEEK 1 CHECK-IN EMAIL
   - Subject: "How's everything going, [First Name]?"
   - Check in, make sure terminal is working, offer to review first settlement
```

---

### WORKFLOW 20 — Equipment Order Confirmation
**Env Key:** `GHL_WORKFLOW_EQUIPMENT_ORDER`
**Trigger:** Fired by Replit when an equipment order is created

#### GHL Build Steps:
1. **+ New Workflow**
2. Name: `LB — Equipment Order`
3. **Trigger:** Contact Tag Added → `equipment_ordered`
4. **Step 1 — Send Email (Immediate):** Order confirmation with tracking timeline
5. **Step 2 — Send SMS (+10 min):** Short confirmation
6. **Step 3 — Wait 3 days**
7. **Step 4 — Send Email:** "Equipment should arrive in 2–3 days" with setup instructions
8. **Step 5 — Wait 5 days**
9. **Step 6 — Create Task:** "Confirm equipment received and working — {{contact.company_name}}"
10. Save & Publish

---

## CATEGORY 6: PARTNERS & AFFILIATES

---

### WORKFLOW 21 — Partner Welcome
**Env Key:** `GHL_WORKFLOW_PARTNER_WELCOME`
**Trigger:** Fired by Replit when a partner application is approved

#### GHL Build Steps:
1. **+ New Workflow**
2. Name: `LB — Partner Welcome`
3. **Trigger:** Contact Tag Added → `partner_approved`
4. **Step 1 — Send Email (Immediate):** Welcome + portal access + referral instructions
5. **Step 2 — Send SMS (+30 min):** Portal link
6. **Step 3 — Wait 3 days**
7. **Step 4 — Send Email:** "How to refer your first merchant"
8. **Step 5 — Wait 7 days**
9. **Step 6 — Send Email:** Commission tier breakdown
10. Save & Publish

---

### WORKFLOW 22 — Affiliate Welcome
**Env Key:** `GHL_WORKFLOW_AFFILIATE_WELCOME`
**Trigger:** Fired by Replit when an affiliate signs up

Build identically to Workflow 21 but with affiliate-specific copy (referral codes, cookie attribution, commission structure).

---

## AFTER BUILDING ALL WORKFLOWS

### Map Workflow IDs in Replit

1. Go to `/dashboard/integrations` → **GHL Workflow Manager**
2. For each row, paste the corresponding GHL Workflow ID (found in the GHL URL when viewing the workflow, e.g., `5f3a2c1d-8b4e-...`)
3. Click Save on each row

| Replit Label | Env Key | GHL Workflow Name You Built |
|---|---|---|
| Inbound Lead Confirmation | `GHL_WORKFLOW_INBOUND_LEAD` | LB — Inbound Lead Confirmation |
| Statement Review Follow-Up | `GHL_WORKFLOW_STATEMENT_REVIEW` | LB — Statement Upload Confirmation |
| Merchant Application Received | `GHL_WORKFLOW_MERCHANT_APP` | LB — Merchant Application Received |
| Support Ticket Created | `GHL_WORKFLOW_SUPPORT_TICKET` | LB — Support Ticket |
| Affiliate Welcome | `GHL_WORKFLOW_AFFILIATE_WELCOME` | LB — Affiliate Welcome |
| Callback Request | `GHL_WORKFLOW_CALLBACK` | LB — Callback Request |
| Equipment Order | `GHL_WORKFLOW_EQUIPMENT_ORDER` | LB — Equipment Order |
| Booking Confirmation | `GHL_WORKFLOW_BOOKING_CONFIRM` | LB — Booking Confirmation |
| 24h Reminder | `GHL_WORKFLOW_REMINDER` | LB — 24h Appointment Reminder |
| No-Show Reschedule | `GHL_WORKFLOW_NO_SHOW` | LB — No-Show Recovery |
| Post-Call Follow-Up | `GHL_WORKFLOW_POST_CALL` | LB — Post-Call Follow-Up |
| Proposal Follow-Up | `GHL_WORKFLOW_PROPOSAL_FOLLOWUP` | LB — Proposal Follow-Up |
| Long-Term Nurture | `GHL_WORKFLOW_LONG_NURTURE` | LB — Long-Term Nurture |
| SDR Default | `GHL_WORKFLOW_SDR_DEFAULT` | LB — SDR Cold Outbound — Default |
| SDR Automotive | `GHL_WORKFLOW_SDR_AUTO` | LB — SDR Cold Outbound — Automotive |
| SDR Med Spa | `GHL_WORKFLOW_SDR_MEDSPA` | LB — SDR Cold Outbound — Med Spa |
| SDR Medical/Dental | `GHL_WORKFLOW_SDR_MEDICAL` | LB — SDR Cold Outbound — Medical/Dental |
| SDR Restaurant | `GHL_WORKFLOW_SDR_RESTAURANT` | LB — SDR Cold Outbound — Restaurant |
| SDR Retail | `GHL_WORKFLOW_SDR_RETAIL` | LB — SDR Cold Outbound — Retail |
| SDR Construction | `GHL_WORKFLOW_SDR_CONSTRUCTION` | LB — SDR Cold Outbound — Construction |
| SDR Statement Audit | `GHL_WORKFLOW_SDR_STATEMENT` | LB — SDR Statement Audit |
| Merchant Approved | `GHL_WORKFLOW_MERCHANT_APPROVED` | LB — Merchant Approved Welcome |
| Partner Welcome | `GHL_WORKFLOW_PARTNER_WELCOME` | LB — Partner Welcome |

### Final Go-Live Check
After mapping all IDs, visit `/dashboard/activation` → Readiness section to confirm all 10 checks pass.
